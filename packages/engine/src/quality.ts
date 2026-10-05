import { maybeComponent, nodeCost } from './catalog';
import { computeVulns, knownVulns, SEVERITY_WEIGHT, vulnDef } from './security';
import type { SimResult } from './sim/types';
import type { ContentBundle, GameState, MetricsSnapshot, QualityReason, QualityScores } from './types';
import { clamp, round } from './util';

/** Monthly revenue in game money: users × ARPU, reduced by unavailability. */
export function revenuePerMonth(state: GameState, availability = 1): number {
  const arpu = 0.5;
  return Math.round(state.world.traffic.users * arpu * clamp(availability, 0, 1) ** 4);
}

export function costBreakdown(state: GameState, content: ContentBundle, sim?: SimResult) {
  const breakdown: { id: string; label: string; amount: number }[] = [];
  for (const n of state.world.nodes) {
    const def = maybeComponent(content, n.type);
    if (!def || def.role === 'client') continue;
    const amount = nodeCost(content, n) * (sim?.nodes[n.id]?.instances ?? 1);
    if (amount > 0) breakdown.push({ id: n.id, label: n.name, amount });
  }
  // origin egress: static not served by a CDN is paid at origin prices
  if (sim) {
    let gbOrigin = 0;
    for (const ep of state.world.endpoints) {
      const s = sim.endpoints[ep.id];
      if (!s) continue;
      const kb = ep.target === 'static' ? (s.pageWeightKb ?? ep.responseKb) : ep.responseKb;
      const viaCdn = s.path.some((id) => maybeComponent(content, state.world.nodes.find((n) => n.id === id)?.type ?? '')?.role === 'cdn');
      const gb = (s.rps * kb * 2_592_000) / 1_048_576;
      gbOrigin += viaCdn ? gb * 0.05 : gb;
    }
    const egress = Math.round(gbOrigin * 0.05);
    if (egress > 0) breakdown.push({ id: 'egress', label: 'Traffic (egress)', amount: egress });
  }
  if (state.company.domain) breakdown.push({ id: 'domain', label: 'Domain', amount: 1 });
  const total = breakdown.reduce((a, b) => a + b.amount, 0);
  return { total, breakdown };
}

function latencyScore(p95: number): number {
  if (p95 <= 200) return 100;
  if (p95 >= 5000) return 0;
  return 100 - (100 * Math.log(p95 / 200)) / Math.log(25);
}

function pageScore(ms: number): number {
  if (ms <= 1200) return 100;
  if (ms >= 12000) return 0;
  return 100 - (100 * Math.log(ms / 1200)) / Math.log(10);
}

function availabilityScore(a: number): number {
  const nines = -Math.log10(Math.max(1e-6, 1 - a));
  return clamp((nines / 4) * 100, 0, 100);
}

export function computeQuality(state: GameState, content: ContentBundle, sim: SimResult): { scores: QualityScores; reasons: QualityReason[]; vulns: string[] } {
  const w = state.world;
  const reasons: QualityReason[] = [];
  const role = (type: string) => maybeComponent(content, type)?.role;
  const count = (r: string) => w.nodes.filter((n) => role(n.type) === r && !n.offline).length;
  const features = new Set(state.unlocks.features);

  // performance
  const dyn = Object.values(sim.endpoints).filter((e) => e.served && e.rps > 0);
  const p95 = dyn.length ? sim.summary.p95 : 0;
  let performance = latencyScore(p95);
  if (p95 > 200) reasons.push({ metric: 'performance', delta: round(performance - 100), key: 'q.perf.latency', params: { p95: Math.round(p95) } });
  if (sim.summary.pageLoadMs !== null) {
    const ps = pageScore(sim.summary.pageLoadMs);
    if (ps < 100) reasons.push({ metric: 'performance', delta: round((ps - 100) * 0.4), key: 'q.perf.page', params: { ms: Math.round(sim.summary.pageLoadMs) } });
    performance = performance * 0.6 + ps * 0.4;
  }

  // reliability
  let reliability = availabilityScore(sim.summary.availability);
  if (reliability < 100) reasons.push({ metric: 'reliability', delta: round(reliability - 100), key: 'q.rel.availability', params: { pct: round(sim.summary.availability * 100, 3) } });
  if (features.has('backups') && count('database') > 0 && count('backup') === 0) {
    reliability -= 10;
    reasons.push({ metric: 'reliability', delta: -10, key: 'q.rel.noBackup' });
  }
  if (features.has('monitoring') && count('monitoring') === 0) {
    reliability -= 5;
    reasons.push({ metric: 'reliability', delta: -5, key: 'q.rel.noMonitoring' });
  }
  if (features.has('spof')) {
    if (count('backend') < 2 && !w.nodes.some((n) => role(n.type) === 'backend' && n.config.autoscale === true)) {
      reliability -= 8;
      reasons.push({ metric: 'reliability', delta: -8, key: 'q.rel.spofBackend' });
    }
    if (count('database') > 0 && count('replica') === 0) {
      reliability -= 5;
      reasons.push({ metric: 'reliability', delta: -5, key: 'q.rel.spofDatabase' });
    }
  }
  if (features.has('regions') && w.regions.length < 2) {
    reliability -= 5;
    reasons.push({ metric: 'reliability', delta: -5, key: 'q.rel.singleRegion' });
  }
  reliability = clamp(reliability, 0, 100);

  // security
  const vulns = computeVulns(w, content);
  const known = new Set(knownVulns(state, vulns));
  let security = 100;
  for (const id of vulns) {
    const def = vulnDef(id)!;
    const weight = SEVERITY_WEIGHT[def.severity];
    security -= weight;
    reasons.push({ metric: 'security', delta: -weight, key: known.has(id) ? `q.sec.vuln.${id}` : 'q.sec.unknown' });
  }
  if (w.tls.enabled && w.tls.hsts) security += 2;
  if (w.app.csp === true) security += 2;
  security = clamp(security, 0, 100);

  // maintainability
  let maintainability = 100 - state.debt * 0.6;
  if (state.debt > 0) reasons.push({ metric: 'maintainability', delta: round(-state.debt * 0.6), key: 'q.maint.debt', params: { debt: state.debt } });
  const nodes = w.nodes.filter((n) => role(n.type) !== 'client').length;
  if (nodes > 14) {
    const p = Math.min(20, nodes - 14);
    maintainability -= p;
    reasons.push({ metric: 'maintainability', delta: -p, key: 'q.maint.complexity', params: { nodes } });
  }
  const openBugs = w.bugs.filter((b) => !b.fixed).length;
  if (openBugs) {
    maintainability -= openBugs * 3;
    reasons.push({ metric: 'maintainability', delta: -openBugs * 3, key: 'q.maint.bugs', params: { bugs: openBugs } });
  }
  if (w.ci.enabled && w.ci.stages.unit) {
    maintainability += 5;
    reasons.push({ metric: 'maintainability', delta: 5, key: 'q.maint.ci' });
  }
  const rb = Math.min(6, w.observability.runbooks.length * 2);
  if (rb) {
    maintainability += rb;
    reasons.push({ metric: 'maintainability', delta: rb, key: 'q.maint.runbooks' });
  }
  maintainability = clamp(maintainability, 0, 100);

  // cost (relative to revenue)
  const cost = costBreakdown(state, content, sim);
  const revenue = Math.max(1, revenuePerMonth(state, sim.summary.availability));
  const ratio = cost.total / revenue;
  const costScore = clamp(100 - Math.max(0, ratio - 0.2) * 125, 0, 100);
  if (costScore < 100) reasons.push({ metric: 'cost', delta: round(costScore - 100), key: 'q.cost.ratio', params: { cost: cost.total, revenue } });

  return {
    scores: {
      performance: Math.round(clamp(performance, 0, 100)),
      reliability: Math.round(reliability),
      security: Math.round(security),
      maintainability: Math.round(maintainability),
      cost: Math.round(costScore),
    },
    reasons,
    vulns,
  };
}

export function snapshotOf(state: GameState, sim: SimResult): MetricsSnapshot {
  return {
    p50: sim.summary.p50,
    p95: sim.summary.p95,
    errorRate: sim.summary.errorRate,
    availability: sim.summary.availability,
    rps: sim.summary.rps,
    costPerMonth: sim.cost.total,
    cacheHitRate: sim.summary.cacheHitRate,
    queueBacklog: sim.summary.queueBacklog,
    dbUtil: sim.summary.dbUtil,
    pageLoadMs: sim.summary.pageLoadMs,
    quality: sim.quality,
    debt: state.debt,
    anomalies: { ...sim.anomalies },
  };
}
