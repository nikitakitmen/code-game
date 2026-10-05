/**
 * Facts: a flat dictionary describing the world and the latest simulation.
 * Mission objectives, solutions, consequences, achievements and attacks are
 * conditions over these facts (see conditions.ts). Keep names stable — content uses them.
 */
import { maybeComponent, SIZE_FACTOR } from './catalog';
import type { Facts } from './conditions';
import { compareVersions, computeVulns } from './security';
import { tableIndexes } from './sim/db';
import { ERROR_STATUS } from './sim/types';
import type { SimResult } from './sim/types';
import type { ContentBundle, FactValue, GameState, KnowledgeLevel } from './types';
import { KNOWLEDGE_LEVELS } from './types';
import { clockParts, weekday } from './util';

const SIZE_INDEX = { s: 1, m: 2, l: 3, xl: 4, '2xl': 5 } as const;

export function computeFacts(state: GameState, content: ContentBundle, sim: SimResult | null): Facts {
  const f: Facts = {};
  const w = state.world;
  const set = (k: string, v: FactValue | undefined) => {
    if (v !== undefined) f[k] = v;
  };
  const role = (type: string) => maybeComponent(content, type)?.role;

  // company & clock
  set('company.named', !!state.company.name && state.company.name.trim().length >= 2);
  set('company.domain', state.company.domain);
  set('clock', state.clock);
  set('clock.weekday', weekday(state.clock));
  set('clock.hour', clockParts(state.clock).hh);
  set('clock.friday', weekday(state.clock) === 4);
  set('debt', state.debt);
  set('cash', Math.round(state.budget.cash));
  set('users', w.traffic.users);
  for (const [k, v] of Object.entries(state.stats)) set(`stats.${k}`, v);

  // mail & apps
  for (const m of state.mail) set(`mail.read.${m.id}`, m.read);
  for (const a of state.openedApps) set(`app.opened.${a}`, true);
  for (const a of state.unlocks.apps) set(`unlocked.app.${a}`, true);
  for (const ft of state.unlocks.features) set(`feature.${ft}`, true);

  // architecture
  const counts: Record<string, number> = {};
  const online: Record<string, number> = {};
  const roles: Record<string, number> = {};
  for (const n of w.nodes) {
    counts[n.type] = (counts[n.type] ?? 0) + 1;
    if (!n.offline) online[n.type] = (online[n.type] ?? 0) + 1;
    const r = role(n.type);
    if (r && !n.offline) roles[r] = (roles[r] ?? 0) + 1;
    set(`nodeId.${n.id}.offline`, !!n.offline);
    set(`nodeId.${n.id}.size`, SIZE_INDEX[n.size]);
    for (const [k, v] of Object.entries(n.config)) set(`nodeId.${n.id}.${k}`, v);
    for (const p of n.publicPorts) set(`public.${n.type}.${p}`, true);
    for (const p of n.ports) set(`listen.${n.type}.${p}`, true);
    for (const p of n.publicPorts) set(`publicRole.${r}.${p}`, true);
    set(`nodeId.${n.id}.region`, n.region);
  }
  for (const c of content.components) {
    set(`count.${c.type}`, counts[c.type] ?? 0);
    set(`online.${c.type}`, online[c.type] ?? 0);
  }
  for (const r of ['client', 'dns', 'cdn', 'waf', 'lb', 'proxy', 'backend', 'worker', 'database', 'replica', 'cache', 'queue', 'storage', 'provider', 'monitoring', 'logs', 'backup']) {
    set(`role.${r}`, roles[r] ?? 0);
  }
  // first node of each type: config & size
  const seen = new Set<string>();
  for (const n of w.nodes) {
    if (seen.has(n.type)) {
      // max size across nodes of a type
      const prev = Number(f[`size.${n.type}`] ?? 0);
      set(`size.${n.type}`, Math.max(prev, SIZE_INDEX[n.size]));
      continue;
    }
    seen.add(n.type);
    set(`size.${n.type}`, SIZE_INDEX[n.size]);
    for (const [k, v] of Object.entries(n.config)) set(`node.${n.type}.${k}`, v);
  }
  // capacity of backends in "s units" (vertical + horizontal)
  let backendUnits = 0;
  for (const n of w.nodes) if (role(n.type) === 'backend' && !n.offline) backendUnits += SIZE_FACTOR[n.size] * (n.config.autoscale === true ? Number(n.config.maxInstances ?? 4) : 1);
  set('backend.units', backendUnits);

  for (const e of w.edges) {
    const a = w.nodes.find((n) => n.id === e.from);
    const b = w.nodes.find((n) => n.id === e.to);
    if (!a || !b) continue;
    set(`edge.${a.type}>${b.type}`, true);
    set(`edgeRole.${role(a.type)}>${role(b.type)}`, true);
    set(`edgeId.${a.id}>${b.id}`, true);
  }
  // services
  const services = new Set(w.nodes.filter((n) => role(n.type) === 'backend').map((n) => String(n.config.service ?? 'monolith')));
  set('services.count', services.size);
  for (const s of services) set(`service.${s}`, true);
  const dbOwners = new Map<string, Set<string>>();
  for (const n of w.nodes.filter((x) => role(x.type) === 'backend')) {
    for (const e of w.edges.filter((x) => x.from === n.id)) {
      const t = w.nodes.find((x) => x.id === e.to);
      if (t && role(t.type) === 'database') {
        const set2 = dbOwners.get(t.id) ?? new Set<string>();
        set2.add(String(n.config.service ?? 'monolith'));
        dbOwners.set(t.id, set2);
      }
    }
  }
  set('services.sharedDb', [...dbOwners.values()].some((s) => s.size > 1));

  // regions
  set('regions', w.regions.length);
  for (const r of w.regions) set(`region.${r}`, true);
  for (const r of w.regions) {
    set(`regionNodes.${r}.backend`, w.nodes.filter((n) => n.region === r && role(n.type) === 'backend').length);
    set(`regionNodes.${r}.replica`, w.nodes.filter((n) => n.region === r && role(n.type) === 'replica').length);
    set(`regionNodes.${r}.database`, w.nodes.filter((n) => n.region === r && role(n.type) === 'database').length);
    set(`regionNodes.${r}.proxy`, w.nodes.filter((n) => n.region === r && (role(n.type) === 'proxy' || role(n.type) === 'lb')).length);
  }

  // app (live) and pending code changes
  for (const [k, v] of Object.entries(w.app)) set(`app.${k}`, v);
  for (const [k, v] of Object.entries(w.deploy.pending)) set(`pending.${k}`, v);
  set('pending.count', Object.keys(w.deploy.pending).length + w.deploy.pendingFixes.length);
  for (const r of w.cacheRules) {
    set(`cache.${r.endpoint}.enabled`, r.enabled);
    set(`cache.${r.endpoint}.ttl`, r.ttl);
  }

  // endpoints & data
  for (const ep of w.endpoints) {
    set(`endpoint.${ep.id}`, !ep.disabled);
    set(`endpoint.${ep.id}.version`, ep.version ?? null);
    set(`endpoint.${ep.id}.method`, ep.method);
    for (const q of ep.queries) set(`query.${ep.id}.${q.id}.perRequest`, q.perRequest ?? 1);
    if (ep.calls) set(`endpoint.${ep.id}.calls`, ep.calls.length);
  }
  for (const t of w.tables) {
    set(`table.${t.name}`, true);
    set(`rows.${t.name}`, t.rows);
    for (const c of t.columns) {
      set(`column.${t.name}.${c.name}`, true);
      if (c.unique || c.pk) set(`unique.${t.name}.${c.name}`, true);
      if (c.pk) set(`pk.${t.name}`, c.name);
      if (c.fk) set(`fk.${t.name}.${c.name}`, c.fk);
    }
    for (const idx of tableIndexes(t)) {
      set(`idx.${t.name}.${idx.columns.join(',')}`, true);
      set(`idxlead.${t.name}.${idx.columns[0]}`, true);
    }
    set(`indexes.${t.name}`, t.indexes.length);
  }
  for (const b of w.bugs) set(`bug.${b.id}`, !b.fixed);
  set('bugs.open', w.bugs.filter((b) => !b.fixed).length);
  for (const fl of w.files) {
    set(`file.${fl.path}`, true);
    if (fl.optimized) set(`fileOpt.${fl.path}`, true);
    if (fl.lazy) set(`fileLazy.${fl.path}`, true);
  }
  set('files.publicSql', w.files.some((x) => x.path.startsWith('/var/www/html/') && x.kind === 'sql'));
  set('files.imagesUnoptimized', w.files.filter((x) => x.path.startsWith('/var/www/html/') && x.kind === 'image' && !x.optimized && x.sizeKb > 300).length);
  set('site.port', w.site.port);

  // dns & tls
  set('dns.domain', w.dns.domain);
  for (const r of w.dns.records) {
    set(`dns.${r.name}.${r.type}`, r.value);
    set(`dns.ttl.${r.name}.${r.type}`, r.ttl);
  }
  set('dns.geo', w.dns.geoRouting);
  set('dns.failover', w.dns.failover);
  set('tls.enabled', w.tls.enabled);
  set('tls.issuer', w.tls.issuer);
  set('tls.autoRenew', w.tls.autoRenew);
  set('tls.redirect', w.tls.redirectHttp);
  set('tls.hsts', w.tls.hsts);
  set('tls.version', w.tls.version);
  set('tls.resumption', w.tls.sessionResumption);
  set('tls.daysLeft', w.tls.expiresAt === null ? null : Math.floor((w.tls.expiresAt - state.clock) / 1440));

  // security
  set('sec.admins', w.security.employees.filter((e) => e.role === 'admin').length);
  for (const e of w.security.employees) set(`sec.employee.${e.id}.role`, e.role);
  for (const s of w.security.secrets) {
    set(`sec.secret.${s.id}.rotated`, s.rotatedAt !== null);
    set(`sec.secret.${s.id}.leaked`, s.leaked);
    set(`sec.secret.${s.id}.history`, s.inGitHistory);
  }
  for (const d of w.security.deps) {
    set(`sec.dep.${d.name}`, d.version);
    if (d.cve) set(`sec.dep.${d.name}.vulnerable`, compareVersions(d.version, d.cve.fixedIn) < 0);
  }
  for (const r of w.security.roles) set(`sec.role.${r.id}`, r.permissions.join(','));
  const vulns = sim?.vulns ?? computeVulns(w, content);
  set('vulns', vulns.length);
  for (const v of vulns) set(`vuln.${v}`, true);
  for (const [id, r] of Object.entries(state.attackResults)) {
    set(`attack.${id}.run`, true);
    set(`attack.${id}.blocked`, !r.success);
    set(`attack.${id}.fresh`, r.seq === state.seq);
  }

  // git / ci / deploy
  const g = w.git;
  set('git.initialized', g.initialized);
  set('git.commits', g.commits.length);
  set('git.branches', Object.keys(g.branches).length);
  set('git.merges', g.commits.filter((c) => c.parents.length > 1).length);
  set('git.requirePr', g.protection.requirePr);
  set('git.requireChecks', g.protection.requireChecks);
  set('git.requireReview', g.protection.requireReview);
  set('git.conflict', g.conflict !== null);
  set('git.historyRewritten', g.historyRewritten);
  set('git.gitignoreEnv', g.gitignore.includes('.env'));
  for (const pr of g.prs) {
    set(`pr.${pr.id}.status`, pr.status);
    set(`pr.${pr.id}.checks`, pr.checks);
  }
  set('ci.enabled', w.ci.enabled);
  for (const [k, v] of Object.entries(w.ci.stages)) set(`ci.${k}`, v && w.ci.enabled);
  for (const tst of w.ci.tests) set(`ci.test.${tst.id}`, true);
  set('ci.tests', w.ci.tests.length);
  const lastRun = w.ci.runs[w.ci.runs.length - 1];
  set('ci.lastStatus', lastRun?.status ?? null);
  set('deploy.version', w.deploy.version);
  set('deploy.count', w.deploy.deployCount);
  set('deploy.canary', w.deploy.canary?.percent ?? 0);
  set('deploy.requireDeploy', w.deploy.requireDeploy);
  const lastRel = w.deploy.releases[w.deploy.releases.length - 1];
  set('deploy.lastStatus', lastRel?.status ?? null);
  set('deploy.rolledBack', w.deploy.releases.some((r) => r.status === 'rolled-back'));
  for (const fl of w.deploy.flags) {
    set(`flag.${fl.id}.enabled`, fl.enabled);
    set(`flag.${fl.id}.rollout`, fl.enabled ? fl.rollout : 0);
  }

  // observability
  const obs = w.observability;
  set('obs.alerts', obs.alertRules.filter((r) => r.enabled).length);
  for (const r of obs.alertRules.filter((x) => x.enabled)) {
    set(`obs.alert.${r.metric}`, true);
    set(`obs.alert.${r.metric}.threshold`, r.threshold);
    set(`obs.alert.${r.metric}.for`, r.forMinutes);
    set(`obs.alert.${r.metric}.severity`, r.severity);
  }
  set('obs.runbooks', obs.runbooks.length);
  for (const rb of obs.runbooks) {
    set(`obs.runbook.${rb.trigger}`, true);
    set(`obs.runbook.${rb.trigger}.steps`, rb.steps.join(','));
  }
  set('obs.slo', obs.slo !== null);
  set('obs.slo.availability', obs.slo?.availability ?? null);
  set('obs.slo.latency', obs.slo?.latencyMs ?? null);
  set('obs.sla', obs.slo?.slaAvailability ?? null);
  set('obs.freeze', obs.slo?.freezeOnBudgetExhausted ?? false);
  for (const inc of obs.incidents) {
    set(`incident.${inc.id}.declared`, inc.declaredAt !== null);
    set(`incident.${inc.id}.severity`, inc.severity);
    set(`incident.${inc.id}.status`, inc.status);
    set(`incident.${inc.id}.utc`, inc.utcView);
    const sorted = inc.events.slice().sort((a, b) => utcMinutes(a.raw, a.tz) - utcMinutes(b.raw, b.tz)).map((e) => e.id);
    set(`incident.${inc.id}.ordered`, inc.order.length === sorted.length && inc.order.every((id, i) => id === sorted[i]));
  }
  for (const pm of obs.postmortems) {
    set(`postmortem.${pm.incidentId}.submitted`, pm.submitted);
    for (const [k, v] of Object.entries(pm.answers)) set(`postmortem.${pm.incidentId}.${k}`, Array.isArray(v) ? v.join(',') : v);
  }
  for (const inc of w.incidents) {
    set(`worldIncident.${inc.id}`, inc.active);
  }
  set('incidents.active', w.incidents.filter((i) => i.active).length);
  for (const [k, v] of Object.entries(w.flags)) set(`wflag.${k}`, v);

  // campaign
  for (const [id, s] of Object.entries(state.campaign.completed)) {
    set(`completed.${id}`, true);
    set(`solution.${id}`, s.solutionId);
    set(`solutionKind.${id}`, s.solutionKind);
  }
  set('completed', state.campaign.completedOrder.length);
  set('campaignFinished', state.campaign.finished);
  set('stats.firstTryHypotheses', firstTryHypotheses(state));
  set('stats.compares', state.stats.restores);
  const a = state.campaign.active;
  if (a) {
    set('mission.id', a.id);
    set('mission.evidence', a.evidence.length);
    set('mission.pins', a.pinned.length);
    set('mission.hypothesis', a.hypothesis);
    set('mission.wrongHypotheses', a.wrongHypotheses.length);
    for (const [d, c] of Object.entries(a.choices)) set(`mission.choice.${d}`, c);
    for (const o of a.ops) set(`mission.op.${o}`, true);
    for (const e of a.evidence) set(`mission.evidence.${e}`, true);
    set('mission.actions', a.actions);
    set('sim.fresh', a.lastSimSeq === state.seq && a.simRuns > 0);
    set('mission.simRuns', a.simRuns);
  }
  for (const [id, k] of Object.entries(state.knowledge)) set(`know.${id}`, KNOWLEDGE_LEVELS.indexOf(k.state as KnowledgeLevel));
  for (const id of Object.keys(state.achievements)) set(`achievement.${id}`, true);

  // simulation
  if (sim) {
    const s = sim.summary;
    set('m.rps', s.rps);
    set('m.p50', s.p50);
    set('m.p95', s.p95);
    set('m.p99', s.p99);
    set('m.errorRate', s.errorRate);
    set('m.availability', s.availability);
    set('m.cacheHit', s.cacheHitRate);
    set('m.queueBacklog', s.queueBacklog);
    set('m.dbUtil', s.dbUtil);
    set('m.dbConns', s.dbConnections);
    set('m.maxConns', s.maxConnections);
    set('m.replicaLag', s.replicaLagMs);
    set('m.pageLoad', s.pageLoadMs);
    set('m.pageWeight', s.pageWeightKb);
    set('m.amplification', s.providerAmplification);
    set('m.errorBudgetUsed', s.errorBudgetUsed);
    set('m.cost', sim.cost.total);
    for (const [r, v] of Object.entries(s.regionP95)) set(`m.p95.${r}`, v ?? null);
    for (const [k, v] of Object.entries(sim.quality)) set(`q.${k}`, v);
    for (const [id, e] of Object.entries(sim.endpoints)) {
      set(`ep.${id}.p50`, e.p50);
      set(`ep.${id}.p95`, e.p95);
      set(`ep.${id}.errorRate`, e.errorRate);
      set(`ep.${id}.status`, e.status);
      set(`ep.${id}.served`, e.served);
      set(`ep.${id}.ok`, e.served && e.errorRate < 0.01);
      set(`ep.${id}.cacheHit`, e.cacheHitRate);
      set(`ep.${id}.rows`, e.rowsScanned);
      set(`ep.${id}.dbMs`, e.dbMs);
      set(`ep.${id}.pageLoad`, e.pageLoadMs);
      set(`ep.${id}.pageWeight`, e.pageWeightKb);
      set(`ep.${id}.missingAssets`, e.missingAssets.length);
      for (const code of Object.keys(ERROR_STATUS)) set(`ep.${id}.err.${code}`, 0);
      for (const [code, rate] of Object.entries(e.errors)) set(`ep.${id}.err.${code}`, rate ?? 0);
      const entry = w.nodes.find((n) => n.id === e.entry);
      set(`ep.${id}.entryRole`, entry ? role(entry.type) ?? null : null);
      for (const nid of e.path) {
        const n = w.nodes.find((x) => x.id === nid);
        if (n) {
          set(`ep.${id}.via.${role(n.type)}`, true);
          set(`ep.${id}.viaId.${n.id}`, true);
        }
      }
    }
    for (const [id, ns] of Object.entries(sim.nodes)) {
      set(`nodeId.${id}.util`, ns.utilMax);
      set(`nodeId.${id}.status`, ns.status);
      const n = w.nodes.find((x) => x.id === id);
      if (n) {
        const k = `type.${n.type}.utilMax`;
        set(k, Math.max(Number(f[k] ?? 0), ns.utilMax));
        const r = role(n.type);
        const kr = `roleUtil.${r}`;
        set(kr, Math.max(Number(f[kr] ?? 0), ns.utilMax));
        if (ns.status === 'error' || ns.status === 'offline') set(`type.${n.type}.failing`, true);
      }
    }
    for (const [name, q] of Object.entries(sim.queues)) {
      set(`queue.${name}.backlog`, q.backlogEnd);
      set(`queue.${name}.wait`, Number.isFinite(q.waitSec) ? q.waitSec : 1e9);
      set(`queue.${name}.dlq`, q.dlqPerHour);
      set(`queue.${name}.failed`, q.failedPerHour);
      set(`queue.${name}.dup`, q.duplicatesPerHour);
    }
    set('queue.any.backlog', Math.max(0, ...Object.values(sim.queues).map((q) => q.backlogEnd)));
    set('queue.maxWait', Math.max(0, ...Object.values(sim.queues).map((q) => (Number.isFinite(q.waitSec) ? q.waitSec : 1e9))));
    const anomalyIds = ['staleReads', 'doubleCharges', 'duplicateJobs', 'duplicateFulfillments', 'oversold', 'deadlocks', 'lostEvents', 'corruptedWrites', 'crawlerDeletes', 'invalidRecords', 'misreportedErrors', 'unauthorizedAdminActions', 'lostEmails', 'accountsCompromised', 'lockedOutUsers', 'degradedResponses', 'partnerErrors', 'providerRateLimited', 'blankPages', 'wrongTax', 'discountTwice'];
    for (const id of anomalyIds) set(`anomaly.${id}`, 0);
    for (const [id, v] of Object.entries(sim.anomalies)) set(`anomaly.${id}`, v);
    const pages = sim.alerts.filter((x) => x.severity === 'page');
    set('alerts.fired', sim.alerts.length);
    set('alerts.pages', pages.length);
    set('alerts.falsePages', pages.filter((x) => !x.actionable).length);
    set('alerts.truePages', pages.filter((x) => x.actionable).length);
    // user-hurting minutes not covered by any page
    const hurtTicks = sim.ticks.filter((tk) => tk.errorRate > 0.05).map((tk) => tk.t);
    const covered = (t: number) => pages.some((p) => t >= p.startTick && t <= p.endTick + 2);
    set('alerts.missedOutage', hurtTicks.length > 0 && !hurtTicks.some(covered));
  }
  return f;
}

/** "HH:MM" with a timezone offset → minutes since midnight UTC (may be negative / >1440). */
export function utcMinutes(raw: string, tz: number): number {
  const [hh, mm] = raw.split(':').map((x) => parseInt(x, 10));
  return (hh || 0) * 60 + (mm || 0) - tz * 60;
}

/** Completed incident/security missions solved with the correct hypothesis on the first try. */
function firstTryHypotheses(state: GameState): number {
  let n = 0;
  for (const s of Object.values(state.campaign.completed)) {
    if (s.hypothesisCorrect === true && s.wrongHypotheses === 0) n++;
  }
  return n;
}
