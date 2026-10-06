/**
 * Deterministic analytical simulation of the player's production system.
 *
 * One run covers 60 ticks (1 tick = world.timeScale game minutes). For every tick we
 *  1. resolve DNS / ports / TLS at the entry and route each endpoint through the graph,
 *  2. accumulate load on every node (rps, CPU-ms, DB-ms, cache ops, jobs, provider calls),
 *  3. turn utilisation into latency (queueing) and errors (saturation, failures, bugs),
 *  4. advance stateful models (queue backlog, memory growth, cache warm-up),
 * and finally aggregate per endpoint / node / queue plus presentation data
 * (traces, logs, alerts) in ./presentation.ts.
 */
import { componentDef, maybeComponent, nodeCost, SIZE_FACTOR, sizeFactor } from '../catalog';
import { combineSeed } from '../rng';
import type {
  ArchNode,
  ComponentDef,
  ContentBundle,
  EndpointDef,
  GameState,
  JobDef,
  NodeRole,
  RegionId,
  World,
  WorldIncident,
} from '../types';
import { clamp, round, sum, weightedPercentile } from '../util';
import { explainQuery, type ExplainRow } from './db';
import { routeEndpoint, type Route } from './graph';
import { dcRtt, DESKTOP, MOBILE, requestNetworkMs, rtt } from './network';
import type {
  EndpointSummary,
  ErrorCode,
  NodeSummary,
  NodeTick,
  QueueSummary,
  SimEvent,
  SimResult,
  TickMetrics,
} from './types';
import { ERROR_STATUS } from './types';

export const SIM_TICKS = 60;
const TIMEOUT_MS = 30000;

export interface SimOptions {
  ticks?: number;
  /** extra seed salt (Time Machine compare uses the same salt for both sides) */
  salt?: string;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/** Queueing factor: latency multiplier for utilisation ρ (M/M/1-like, capped). */
export function queueFactor(rho: number): number {
  if (rho < 0.97) return 1 / (1 - rho);
  return 35;
}

/** Fraction of requests dropped when ρ > 1. */
export function overloadErrors(rho: number): number {
  return rho > 1 ? 1 - 1 / rho : 0;
}

/** Hit ratio of a TTL cache for one key with Poisson arrivals at λ req/s and TTL T s. */
export function ttlHitRatio(lambdaPerKey: number, ttlSec: number): number {
  const x = lambdaPerKey * ttlSec;
  return x / (1 + x);
}

/** Fraction of hits that return data older than the latest write (TTL-only invalidation). */
export function staleFraction(writesPerSecPerKey: number, ttlSec: number): number {
  const x = writesPerSecPerKey * ttlSec;
  if (x <= 0) return 0;
  return clamp(1 - (1 - Math.exp(-x)) / x, 0, 1);
}

function combine(errs: Partial<Record<ErrorCode, number>>): number {
  let ok = 1;
  for (const v of Object.values(errs)) ok *= 1 - clamp(v ?? 0, 0, 1);
  return 1 - ok;
}

function addErr(errs: Partial<Record<ErrorCode, number>>, code: ErrorCode, p: number) {
  if (p <= 0) return;
  const prev = errs[code] ?? 0;
  errs[code] = 1 - (1 - prev) * (1 - clamp(p, 0, 1));
}

type Ctx = {
  state: GameState;
  content: ContentBundle;
  w: World;
  defs: Map<string, ComponentDef>;
  byId: Map<string, ArchNode>;
  scale: number;
  events: SimEvent[];
  /** memo: entry node health per endpoint and offline set */
  entryHealth: Map<string, boolean>;
};

const roleOfNode = (ctx: Ctx, n: ArchNode | undefined): NodeRole | undefined => (n ? ctx.defs.get(n.type)?.role : undefined);

function nodesOfRole(ctx: Ctx, role: NodeRole): ArchNode[] {
  return ctx.w.nodes.filter((n) => roleOfNode(ctx, n) === role);
}

function edgeExists(ctx: Ctx, from: string, to: string): boolean {
  return ctx.w.edges.some((e) => e.from === from && e.to === to);
}

function neighborsOfRole(ctx: Ctx, from: string, role: NodeRole): ArchNode[] {
  return ctx.w.edges
    .filter((e) => e.from === from)
    .map((e) => ctx.byId.get(e.to))
    .filter((n): n is ArchNode => !!n && roleOfNode(ctx, n) === role);
}

function appStr(w: World, key: string, dflt: string): string {
  const v = w.app[key];
  return v === undefined ? dflt : String(v);
}
function appBool(w: World, key: string): boolean {
  return w.app[key] === true;
}
function appNum(w: World, key: string, dflt: number): number {
  const v = w.app[key];
  return typeof v === 'number' ? v : dflt;
}

function trafficAt(w: World, t: number, ticks: number): number {
  const tr = w.traffic;
  const base = tr.baseRps;
  switch (tr.pattern) {
    case 'spike': {
      const s = tr.spikeStart ?? 20;
      const e = tr.spikeEnd ?? 40;
      return t >= s && t < e ? base * (tr.spikeMultiplier ?? 5) : base;
    }
    case 'wave':
      return base * (1 + 0.35 * Math.sin((t / ticks) * Math.PI * 2));
    case 'growth':
      return base + ((tr.growthTo ?? base * 3) - base) * (t / Math.max(1, ticks - 1));
    case 'daily': {
      // 60 ticks spanning a day: quiet night, peak in the afternoon
      const hour = (t / ticks) * 24;
      const day = hour >= 6 ? Math.sin((Math.PI * (hour - 6)) / 18) : 0;
      return base * (0.3 + 0.9 * Math.max(0, day));
    }
    default:
      return base;
  }
}

function incidentActive(inc: WorldIncident, t: number): boolean {
  if (!inc.active) return false;
  const s = inc.startTick ?? 0;
  const e = inc.endTick ?? Infinity;
  return t >= s && t < e;
}

function flagShare(w: World, flag?: string): number {
  if (!flag) return 1;
  const f = w.deploy.flags.find((x) => x.id === flag);
  if (!f || !f.enabled) return 0;
  return clamp(f.rollout / 100, 0, 1);
}

/** Share of traffic exposed to a bug (canary releases and feature flags limit the blast radius). */
export function bugShare(w: World, bug: { version?: number; fixed?: boolean; flag?: string }): number {
  if (bug.fixed) return 0;
  let share = 1;
  if (bug.version !== undefined && w.deploy.canary && bug.version === w.deploy.canary.version) {
    share = clamp(w.deploy.canary.percent / 100, 0, 1);
  } else if (bug.version !== undefined && bug.version > w.deploy.version) {
    share = 0;
  }
  if (bug.flag) share *= flagShare(w, bug.flag);
  return share;
}

function passwordCpuMs(w: World): number {
  switch (appStr(w, 'passwordStorage', 'plaintext')) {
    case 'bcrypt':
      return 60;
    case 'argon2id':
      return 80;
    case 'md5':
    case 'sha256':
      return 0.01;
    default:
      return 0;
  }
}

function isPasswordEndpoint(ep: EndpointDef): boolean {
  return ep.id === 'login' || ep.id === 'register';
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

interface Flow {
  ep: EndpointDef;
  region: RegionId;
  rps: number;
  path: string[];
  failed: ErrorCode | null;
  entryErr: Partial<Record<ErrorCode, number>>;
  route: Route;
}

interface EpAccum {
  points: { v: number; w: number }[];
  rps: number;
  errW: Partial<Record<ErrorCode, number>>;
  totalW: number;
  hitW: number;
  hitDen: number;
  dbMsW: number;
  extMsW: number;
  paths: Map<string, number>;
  entry: string | null;
  served: boolean;
}

export function simulateCore(state: GameState, content: ContentBundle, opts: SimOptions = {}): SimResult {
  const w = state.world;
  const ticks = opts.ticks ?? SIM_TICKS;
  const scale = Math.max(1, w.timeScale || 1);
  const seed = simSeed(state, opts);
  const defs = new Map(content.components.map((c) => [c.type, c] as const));
  const byId = new Map(w.nodes.map((n) => [n.id, n] as const));
  const ctx: Ctx = { state, content, w, defs, byId, scale, events: [], entryHealth: new Map() };

  const endpoints = w.endpoints.filter((e) => !e.disabled && flagShare(w, e.flag) > 0);
  const totalWeight = sum(endpoints.map((e) => e.weight * flagShare(w, e.flag))) || 1;
  const regionMix = normaliseMix(w);
  const mobileShare = clamp(w.traffic.mobileShare ?? 0.3, 0, 1);

  // explain plans don't change during a run
  const explains = new Map<string, ExplainRow[]>();
  for (const ep of w.endpoints) explains.set(ep.id, ep.queries.map((q) => explainQuery(q, w.tables)));

  // stateful models
  const ram = new Map<string, number>(); // MB used
  const crashedUntil = new Map<string, number>();
  const backlog = new Map<string, number>();
  const tickMetrics: TickMetrics[] = [];
  const epAcc = new Map<string, EpAccum>();
  const nodeTicks = new Map<string, NodeTick[]>();
  const edgeLoad = new Map<string, { rps: number; err: number; n: number }>();
  const anomalies: Record<string, number> = {};
  const queueAcc = new Map<string, { inRate: number[]; thr: number[]; backlog: number[]; failed: number; dlq: number; dup: number; retries: number; workers: number }>();
  const nodeConnections = new Map<string, number>();
  const instancesMax = new Map<string, number>();
  let providerAmplification = 1;
  const regionPoints = new Map<RegionId, { v: number; w: number }[]>();
  let replicaLagMax = 0;
  let maxConnectionsSeen = 0;
  let connectionsSeen = 0;

  const addAnomaly = (id: string, perHour: number) => {
    if (perHour <= 0) return;
    anomalies[id] = (anomalies[id] ?? 0) + perHour / ticks;
  };

  // initial RAM for compute nodes (a leaking process may already be close to the limit)
  for (const n of w.nodes) {
    const def = defs.get(n.type);
    if (!def) continue;
    if (def.role === 'backend' || def.role === 'worker') {
      const leak = w.incidents.find((i) => i.active && i.kind === 'memoryLeak' && (i.target === n.id || i.target === n.type));
      const pct = leak ? Number(leak.params?.startPct ?? 35) : 35;
      ram.set(n.id, def.ramMb * sizeFactor(n, def) * (pct / 100));
    }
  }

  const routeCache = new Map<string, Route>();

  for (let t = 0; t < ticks; t++) {
    const minute = state.clock + t * scale;
    const active = w.incidents.filter((i) => incidentActive(i, t));

    /* ---------- 1. offline set ---------- */
    const offline = new Set<string>();
    for (const n of w.nodes) {
      if (n.offline) offline.add(n.id);
      const until = crashedUntil.get(n.id);
      if (until !== undefined && t < until) offline.add(n.id);
    }
    for (const inc of active) {
      if (inc.kind === 'nodeDown' && inc.target) {
        for (const n of w.nodes) if (n.id === inc.target || n.type === inc.target) offline.add(n.id);
      }
      if (inc.kind === 'regionDown' && inc.target) {
        for (const n of w.nodes) if (n.region === inc.target && !defs.get(n.type)?.external && roleOfNode(ctx, n) !== 'client') offline.add(n.id);
      }
      if (inc.kind === 'serviceDown' && inc.target) {
        for (const n of w.nodes) if (roleOfNode(ctx, n) === 'backend' && n.config.service === inc.target) offline.add(n.id);
      }
    }
    const regionDownSince = new Map<string, number>();
    for (const inc of w.incidents) if (inc.active && inc.kind === 'regionDown' && inc.target) regionDownSince.set(inc.target, inc.startTick ?? 0);

    /* ---------- 2. traffic & flows ---------- */
    let rpsTotal = trafficAt(w, t, ticks);
    for (const inc of active) if (inc.kind === 'trafficSpike') rpsTotal *= Number(inc.params?.multiplier ?? 3);

    const flows: Flow[] = [];
    const offlineKey = [...offline].sort().join(',');

    for (const ep of endpoints) {
      const epRps = (rpsTotal * ep.weight * flagShare(w, ep.flag)) / totalWeight;
      for (const [region, share] of regionMix) {
        if (share <= 0) continue;
        const rps = epRps * share;
        const entry = resolveEntry(ctx, ep, region, offline, t, regionDownSince);
        for (const part of entry) {
          const key = `${ep.id}|${region}|${offlineKey}|${part.filter ? [...part.filter].join(',') : '*'}`;
          let route = routeCache.get(key);
          if (!route) {
            route = routeEndpoint({ content, world: w, offline, entryFilter: part.filter ?? undefined, userRegion: region }, ep);
            routeCache.set(key, route);
          }
          if (part.error) {
            flows.push({ ep, region, rps: rps * part.share, path: [], failed: part.error, entryErr: {}, route });
            continue;
          }
          if (route.error || !route.paths.length) {
            flows.push({ ep, region, rps: rps * part.share, path: [], failed: ep.target === 'backend' && !nodesOfRole(ctx, 'backend').length ? 'NO_BACKEND' : 'NO_ROUTE', entryErr: {}, route });
            continue;
          }
          const entryErr = entryChecks(ctx, ep, route, minute);
          for (const p of route.paths) {
            flows.push({ ep, region, rps: rps * part.share * p.share, path: p.nodes, failed: p.failed ?? null, entryErr, route });
          }
        }
      }
    }

    // botnet / scanners add hostile traffic
    const botnet = active.find((i) => i.kind === 'botnet');
    const loginEp = w.endpoints.find((e) => e.id === 'login' && !e.disabled);
    let botRps = 0;
    let botBlocked = 0;
    if (botnet && loginEp) {
      botRps = Number(botnet.params?.rps ?? 50);
      botBlocked = rateLimitBlocks(ctx);
      const route = routeEndpoint({ content, world: w, offline }, loginEp);
      const passing = botRps * (1 - botBlocked);
      if (route.paths.length && passing > 0) {
        for (const p of route.paths) flows.push({ ep: loginEp, region: 'eu', rps: passing * p.share, path: p.nodes, failed: p.failed ?? null, entryErr: {}, route });
      }
      const lockout = appStr(w, 'lockout', 'none');
      const hashFactor = ['bcrypt', 'argon2id'].includes(appStr(w, 'passwordStorage', 'plaintext')) ? 0.2 : 1;
      if (lockout === 'none') addAnomaly('accountsCompromised', passing * 3600 * 0.00005 * hashFactor);
      addAnomaly('bruteForceAttempts', botRps * 3600);
      if (lockout === 'permanent') addAnomaly('lockedOutUsers', 40);
    }

    /* ---------- 3. node loads ---------- */
    const load = new Map<string, number>(); // rps through node
    const cpuDemand = new Map<string, number>(); // CPU-ms per second on compute nodes
    const dbDemand = new Map<string, number>(); // query-ms per second on databases
    const cacheOps = new Map<string, number>();
    const jobIn = new Map<string, { rate: number; ms: number; ext: string | null; dur: number }[]>();
    const providerCalls = new Map<string, number>();
    const flowInfo = new Map<Flow, FlowInfo>();
    const epTotals = new Map<string, number>();
    for (const f of flows) epTotals.set(f.ep.id, (epTotals.get(f.ep.id) ?? 0) + f.rps);

    for (const f of flows) {
      if (f.failed || !f.path.length) continue;
      const info = analyseFlow(ctx, f, t, active, explains.get(f.ep.id) ?? [], offline, epTotals.get(f.ep.id) ?? f.rps);
      flowInfo.set(f, info);
      // rps through forwarding hops (a CDN absorbs its hits)
      let r = f.rps;
      for (let i = 0; i < f.path.length; i++) {
        const id = f.path[i];
        load.set(id, (load.get(id) ?? 0) + r);
        if (i > 0) bumpEdge(edgeLoad, f.path[i - 1], id, r);
        const node = byId.get(id);
        if (roleOfNode(ctx, node) === 'cdn') r *= 1 - info.cdnHit;
        if (roleOfNode(ctx, node) === 'waf') r *= 1 - info.wafBlocked;
      }
      bumpEdge(edgeLoad, clientId(ctx), f.path[0], f.rps);
      const term = info.terminal;
      if (!term) continue;
      const termRps = r;
      cpuDemand.set(term, (cpuDemand.get(term) ?? 0) + termRps * info.cpuMs);
      for (const q of info.dbCalls) {
        // cache hits answer reads without touching the database
        const qRps = termRps * q.rate * dbShare(info, q);
        dbDemand.set(q.db, (dbDemand.get(q.db) ?? 0) + qRps * q.costMs);
        load.set(q.db, (load.get(q.db) ?? 0) + qRps);
        bumpEdge(edgeLoad, term, q.db, qRps);
      }
      if (info.cache) {
        cacheOps.set(info.cache, (cacheOps.get(info.cache) ?? 0) + termRps * info.cacheOpsPerReq);
        load.set(info.cache, (load.get(info.cache) ?? 0) + termRps * info.cacheOpsPerReq);
        bumpEdge(edgeLoad, term, info.cache, termRps);
      }
      for (const j of info.asyncJobs) {
        const list = jobIn.get(j.queueName) ?? [];
        list.push({ rate: termRps * (j.job.perRequest ?? 1), ms: j.job.cpuMs, ext: j.job.external ?? null, dur: j.durMs });
        jobIn.set(j.queueName, list);
        if (j.queueNode) {
          load.set(j.queueNode, (load.get(j.queueNode) ?? 0) + termRps);
          bumpEdge(edgeLoad, term, j.queueNode, termRps);
        }
      }
      for (const p of info.providers) {
        providerCalls.set(p, (providerCalls.get(p) ?? 0) + termRps);
        const pn = ctx.w.nodes.find((n) => n.type === p || n.id === p);
        if (pn) bumpEdge(edgeLoad, term, pn.id, termRps);
      }
      for (const s of info.serviceCalls) {
        cpuDemand.set(s, (cpuDemand.get(s) ?? 0) + termRps * 4);
        bumpEdge(edgeLoad, term, s, termRps);
      }
    }

    // incidents adding load
    for (const inc of active) {
      if (inc.kind === 'backupAtPeak') {
        const src = String(inc.params?.source ?? 'primary');
        const dbs = nodesOfRole(ctx, src === 'replica' ? 'replica' : 'database');
        for (const db of dbs.slice(0, 1)) dbDemand.set(db.id, (dbDemand.get(db.id) ?? 0) + Number(inc.params?.cpuMs ?? 900));
      }
      if (inc.kind === 'nightlyJob') {
        for (const b of nodesOfRole(ctx, 'backend')) cpuDemand.set(b.id, (cpuDemand.get(b.id) ?? 0) + Number(inc.params?.cpuMs ?? 700));
      }
      if (inc.kind === 'bulkJobs' && t === (inc.startTick ?? 0)) {
        const q = String(inc.params?.queue ?? 'bulk');
        const qName = appBool(w, 'queueSeparation') ? q : 'default';
        backlog.set(qName, (backlog.get(qName) ?? 0) + Number(inc.params?.jobs ?? 100000));
      }
    }

    /* ---------- 4. utilisation ---------- */
    const util = new Map<string, number>();
    const instances = new Map<string, number>();
    for (const n of w.nodes) {
      const def = defs.get(n.type);
      if (!def || offline.has(n.id)) continue;
      let cap = def.capacity * sizeFactor(n, def);
      for (const inc of active) {
        if (inc.kind === 'cpuSteal' && (inc.target === n.id || inc.target === n.type)) cap *= Number(inc.params?.factor ?? 0.5);
      }
      let demand = 0;
      switch (def.role) {
        case 'backend':
        case 'worker':
          demand = cpuDemand.get(n.id) ?? 0;
          if (def.role === 'backend' && n.config.autoscale === true) {
            const maxI = Number(n.config.maxInstances ?? 4);
            const need = clamp(Math.ceil(demand / (cap * 0.6)), 1, maxI);
            instances.set(n.id, need);
            instancesMax.set(n.id, Math.max(instancesMax.get(n.id) ?? 1, need));
            cap *= need;
          }
          break;
        case 'database':
        case 'replica':
          demand = dbDemand.get(n.id) ?? 0;
          break;
        case 'cache':
          demand = (cacheOps.get(n.id) ?? 0) / 50; // capacity is MB; ops are cheap
          cap = 1000;
          break;
        default:
          demand = load.get(n.id) ?? 0;
      }
      util.set(n.id, cap > 0 ? demand / cap : 0);
    }

    /* ---------- 5. queues ---------- */
    const queueThroughput = new Map<string, number>();
    const workers = nodesOfRole(ctx, 'worker').filter((n) => !offline.has(n.id));
    const queueNames = new Set<string>([...jobIn.keys(), ...backlog.keys()]);
    let backlogTotal = 0;
    for (const qName of queueNames) {
      const arrivals = jobIn.get(qName) ?? [];
      let inRate = sum(arrivals.map((a) => a.rate));
      const avgMs = arrivals.length ? sum(arrivals.map((a) => a.rate * a.dur)) / Math.max(1e-9, inRate) : 1000;
      // workers serving this queue
      const serving = workers.filter((wk) => {
        const qs = String(wk.config.queues ?? 'all');
        return qs === 'all' || qs === qName || qName === 'default';
      });
      let throughput = 0;
      for (const wk of serving) {
        const def = defs.get(wk.type)!;
        const conc = Number(wk.config.concurrency ?? 2) * (SIZE_FACTOR[wk.size] ?? 1);
        const shareOfWorker = String(wk.config.queues ?? 'all') === 'all' ? 1 / Math.max(1, queueNames.size) : 1;
        throughput += ((conc * 1000) / Math.max(1, avgMs)) * shareOfWorker;
        cpuDemand.set(wk.id, (cpuDemand.get(wk.id) ?? 0) + inRate * Math.min(avgMs, 400) * shareOfWorker);
        util.set(wk.id, (util.get(wk.id) ?? 0) + clamp((inRate * shareOfWorker) / Math.max(1e-9, (conc * 1000) / Math.max(1, avgMs)), 0, 5));
        void def;
      }
      // provider failures → retries (amplify arrivals) / DLQ
      const extFail = Math.max(0, ...arrivals.map((a) => providerFailure(ctx, a.ext, active)));
      const policy = appStr(w, 'retryPolicy', 'none');
      const maxRetries = appNum(w, 'maxRetries', 3);
      let failedPerSec = 0;
      let retriesPerSec = 0;
      let dlqPerSec = 0;
      if (extFail > 0) {
        if (policy === 'none') {
          failedPerSec = inRate * extFail;
        } else if (policy === 'immediate') {
          // hammering a failing provider: every failure is retried at once, forever
          retriesPerSec = inRate * (extFail / Math.max(0.05, 1 - extFail)) * 3;
          inRate += retriesPerSec;
          addAnomaly('providerRateLimited', retriesPerSec * 3600 * 0.5);
        } else {
          const finalFail = extFail ** (maxRetries + 1);
          retriesPerSec = inRate * ((1 - extFail ** (maxRetries + 1)) / (1 - extFail) - 1);
          inRate += retriesPerSec * 0.3; // backoff spreads retries over time
          dlqPerSec = inRate * finalFail;
          failedPerSec = appBool(w, 'deadLetterQueue') ? 0 : dlqPerSec;
        }
      }
      // at-least-once delivery: jobs running longer than the visibility timeout are delivered twice
      const queueNode = nodesOfRole(ctx, 'queue')[0];
      const vis = Number(queueNode?.config.visibilityTimeoutSec ?? 60) * 1000;
      let dupPerSec = 0;
      for (const a of arrivals) {
        const pOver = clamp((1.5 * a.dur - vis) / Math.max(1, a.dur), 0, 1);
        dupPerSec += a.rate * pOver;
      }
      const prev = backlog.get(qName) ?? 0;
      const next = serving.length ? Math.max(0, prev + (inRate - throughput) * 60 * scale) : prev + inRate * 60 * scale;
      backlog.set(qName, next);
      queueThroughput.set(qName, throughput);
      backlogTotal += next;
      const acc = queueAcc.get(qName) ?? { inRate: [], thr: [], backlog: [], failed: 0, dlq: 0, dup: 0, retries: 0, workers: serving.length };
      acc.inRate.push(inRate);
      acc.thr.push(throughput);
      acc.backlog.push(next);
      acc.failed += (failedPerSec * 3600) / ticks;
      acc.dlq += (dlqPerSec * 3600) / ticks;
      acc.dup += (dupPerSec * 3600) / ticks;
      acc.retries += (retriesPerSec * 3600) / ticks;
      acc.workers = serving.length;
      queueAcc.set(qName, acc);
      if (failedPerSec > 0) addAnomaly('lostEmails', failedPerSec * 3600);
      if (!appBool(w, 'jobIdempotency')) addAnomaly('duplicateJobs', dupPerSec * 3600);
    }

    /* ---------- 6. per-flow latency & errors ---------- */
    // databases: connections opened by pools vs max_connections
    const dbNodes = [...nodesOfRole(ctx, 'database'), ...nodesOfRole(ctx, 'replica')];
    const tooMany = new Map<string, number>();
    let conns = 0;
    let maxConns = 0;
    for (const db of dbNodes) {
      const clients = w.edges.filter((e) => e.to === db.id).map((e) => byId.get(e.from)).filter((n): n is ArchNode => !!n);
      let opened = 0;
      for (const c of clients) {
        const r = roleOfNode(ctx, c);
        if (r === 'backend' && !offline.has(c.id)) opened += Number(c.config.poolSize ?? 10) * (instances.get(c.id) ?? 1);
        if (r === 'worker' && !offline.has(c.id)) opened += Number(c.config.concurrency ?? 2) * (SIZE_FACTOR[c.size] ?? 1);
      }
      if (isPooled(ctx, db)) opened = Math.min(opened, Number(db.config.maxConnections ?? 151) * 0.6);
      const mx = Number(db.config.maxConnections ?? 151);
      if (opened > mx) tooMany.set(db.id, (opened - mx) / opened);
      nodeConnections.set(db.id, Math.max(nodeConnections.get(db.id) ?? 0, Math.min(opened, mx)));
      if (roleOfNode(ctx, db) === 'database') {
        conns += Math.min(opened, mx);
        maxConns += mx;
      }
    }
    connectionsSeen = Math.max(connectionsSeen, conns);
    maxConnectionsSeen = Math.max(maxConnectionsSeen, maxConns);

    // replication lag grows with primary write load
    let lag = 0;
    for (const rep of nodesOfRole(ctx, 'replica')) {
      const src = w.edges.find((e) => e.to === rep.id && roleOfNode(ctx, byId.get(e.from)) === 'database');
      if (!src) continue;
      const pu = util.get(src.from) ?? 0;
      const ru = util.get(rep.id) ?? 0;
      const regionDelay = dcRtt(byId.get(src.from)!.region, rep.region);
      lag = Math.max(lag, 30 + regionDelay + pu * 400 + Math.max(0, ru - 0.8) * 3000);
    }
    replicaLagMax = Math.max(replicaLagMax, lag);

    // per-backend pool pressure (Little's law: concurrency = rate × time in DB)
    const poolNeed = new Map<string, number>();
    for (const [f, info] of flowInfo) {
      if (!info.terminal) continue;
      const dbMs = sum(info.dbCalls.map((q) => q.rate * dbShare(info, q) * (q.costMs * queueFactor(Math.min(0.97, util.get(q.db) ?? 0)) + q.netMs)));
      poolNeed.set(info.terminal, (poolNeed.get(info.terminal) ?? 0) + (f.rps * dbMs) / 1000);
    }

    const tickPoints: { v: number; w: number }[] = [];
    let tickErrW = 0;
    let tickW = 0;
    let hitW = 0;
    let hitDen = 0;

    for (const f of flows) {
      const acc = epAccum(epAcc, f.ep.id);
      acc.rps += f.rps / ticks;
      const errs: Partial<Record<ErrorCode, number>> = { ...f.entryErr };
      if (f.failed) {
        addErr(errs, f.failed, 1);
      }
      const info = flowInfo.get(f);
      let okMs = 0;
      let hit = 0;
      let missExtraMs = 0;
      const net = networkMs(ctx, f, info);
      if (info && !f.failed) {
        acc.paths.set(f.path.join('>'), (acc.paths.get(f.path.join('>')) ?? 0) + f.rps);
        acc.entry = acc.entry ?? f.path[0];
        acc.served = true;
        // forwarding hops
        let hopsMs = 0;
        for (const id of f.path) {
          const node = byId.get(id)!;
          const def = defs.get(node.type)!;
          if (def.role === 'backend' || id === info.terminal) continue;
          const u = util.get(id) ?? 0;
          hopsMs += def.baseLatencyMs * queueFactor(Math.min(u, 0.97));
          addErr(errs, 'OVERLOAD', overloadErrors(u));
        }
        // terminal (backend or static server)
        const term = info.terminal ? byId.get(info.terminal) : undefined;
        const termDef = term ? defs.get(term.type) : undefined;
        const tu = info.terminal ? util.get(info.terminal) ?? 0 : 0;
        let termMs = 0;
        if (term && termDef) {
          termMs = (termDef.role === 'backend' ? info.cpuMs : termDef.baseLatencyMs) * queueFactor(Math.min(tu, 0.97));
          addErr(errs, 'OVERLOAD', overloadErrors(tu));
          if (tu > 1) termMs = Math.min(TIMEOUT_MS, termMs * 3);
        }
        // database work
        let dbMs = 0;
        for (const q of info.dbCalls) {
          const dbn = byId.get(q.db);
          if (!dbn || offline.has(q.db)) {
            addErr(errs, 'DB_DOWN', q.rate > 0 ? 1 : 0);
            continue;
          }
          const u = util.get(q.db) ?? 0;
          dbMs += q.rate * (q.costMs * queueFactor(Math.min(u, 0.97)) + q.netMs);
          addErr(errs, 'GATEWAY_TIMEOUT', overloadErrors(u) * 0.8);
          addErr(errs, 'DB_TOO_MANY_CONNECTIONS', tooMany.get(q.db) ?? 0);
        }
        if (info.dbCalls.length && info.terminal) {
          const pool = Number(term?.config.poolSize ?? 10) * (instances.get(info.terminal) ?? 1);
          const need = poolNeed.get(info.terminal) ?? 0;
          const rho = need / Math.max(1, pool);
          if (rho >= 1) {
            addErr(errs, 'DB_POOL_TIMEOUT', 1 - 1 / rho);
            dbMs += 3000 * Math.min(1, rho - 1 + 0.2);
          } else {
            dbMs *= 1 + (rho * rho) / (1 - rho) * 0.5;
          }
        }
        // cache: hits skip read queries
        hit = info.hitRate;
        if (info.cache) {
          if (offline.has(info.cache)) {
            hit = 0;
            if (!appBool(w, 'cacheFailOpen')) addErr(errs, 'CACHE_DOWN', 1);
          }
          addErr(errs, 'CACHE_OOM', info.cacheOomErr);
        }
        missExtraMs = dbMs * info.readShareOfDb;
        const writeDbMs = dbMs * (1 - info.readShareOfDb);
        // external providers (synchronous)
        let extMs = 0;
        for (const p of info.syncProviders) {
          const res = providerCall(ctx, p.provider, active, p.latencyMs);
          extMs += res.ms;
          if (res.ampl > providerAmplification) providerAmplification = res.ampl;
          if (res.circuitOpen) addErr(errs, p.critical ? 'CIRCUIT_OPEN' : 'CIRCUIT_OPEN', p.critical ? res.fail : 0);
          else addErr(errs, res.timeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR', p.critical ? res.fail : 0);
        }
        // synchronous service calls
        for (const svc of info.serviceCalls) {
          const sn = byId.get(svc);
          const su = util.get(svc) ?? 0;
          const down = !sn || offline.has(svc);
          extMs += down ? (appBool(w, 'circuitBreaker') ? 5 : Math.min(appNum(w, 'providerTimeoutMs', TIMEOUT_MS), TIMEOUT_MS)) : 2 + 4 * queueFactor(Math.min(su, 0.97));
          const failP = down ? 1 : overloadErrors(su);
          if (!appBool(w, 'fallbacks')) addErr(errs, 'SERVICE_UNAVAILABLE', failP);
          else if (failP > 0) addAnomaly('degradedResponses', f.rps * failP * 3600);
        }
        for (const svcName of info.missingServices) {
          if (!appBool(w, 'fallbacks')) addErr(errs, 'SERVICE_UNAVAILABLE', 1);
          else addAnomaly('degradedResponses', f.rps * 3600);
        }
        extMs += info.syncJobMs;
        for (const e of info.syncJobErr) addErr(errs, e.code, e.p);
        // bugs
        for (const b of info.bugs) {
          if (b.errorRate) addErr(errs, 'BUG', b.errorRate * b.share);
        }
        // sessions on several instances without a shared store
        if (info.sessionLoss > 0) addErr(errs, 'SESSION_LOST', info.sessionLoss);
        if (info.storageMissing > 0) addErr(errs, 'STORAGE_MISSING', info.storageMissing);
        for (const e of info.extraErrors) addErr(errs, e.code, e.p);
        // locks & deadlocks
        dbMs += info.lockWaitMs;
        addErr(errs, 'DB_DEADLOCK', info.deadlockErr);

        okMs = net + hopsMs + termMs + writeDbMs + extMs + info.extraLatencyMs + info.cacheMs;
        acc.dbMsW += f.rps * (writeDbMs + missExtraMs * (1 - hit));
        acc.extMsW += f.rps * extMs;
      } else {
        okMs = net;
      }

      const errRate = combine(errs);
      for (const [code, p] of Object.entries(errs)) acc.errW[code as ErrorCode] = (acc.errW[code as ErrorCode] ?? 0) + f.rps * (p ?? 0);
      acc.totalW += f.rps;
      tickErrW += f.rps * errRate;
      tickW += f.rps;
      if (info && info.cacheable) {
        acc.hitW += f.rps * hit;
        acc.hitDen += f.rps;
        hitW += f.rps * hit;
        hitDen += f.rps;
      }

      // latency distribution (served requests): cache hit / miss branches × jitter, desktop/mobile
      const errMs = f.failed && ['CONNECTION_TIMEOUT', 'GATEWAY_TIMEOUT', 'PROVIDER_TIMEOUT'].includes(f.failed) ? TIMEOUT_MS : okMs;
      const branches: { ms: number; p: number }[] = [];
      const served = 1 - errRate;
      if (served > 0) {
        if (hit > 0) branches.push({ ms: okMs, p: served * hit });
        branches.push({ ms: okMs + missExtraMs, p: served * (1 - hit) });
      }
      if (errRate > 0) branches.push({ ms: Math.min(TIMEOUT_MS, errMs), p: errRate });
      for (const br of branches) {
        for (const [mult, jw] of JITTER) {
          for (const [mob, mw] of [
            [false, 1 - mobileShare],
            [true, mobileShare],
          ] as const) {
            if (mw <= 0) continue;
            const v = Math.min(TIMEOUT_MS, br.ms * mult + (mob ? net * (MOBILE.rttMult - 1) : 0));
            const weight = f.rps * br.p * jw * mw;
            acc.points.push({ v, w: weight });
            tickPoints.push({ v, w: weight });
            const rp = regionPoints.get(f.region) ?? [];
            rp.push({ v, w: weight });
            regionPoints.set(f.region, rp);
          }
        }
      }
      // edge error accounting (animation colours)
      if (f.path.length) {
        const e = edgeLoad.get(`${clientId(ctx)}>${f.path[0]}`);
        if (e) e.err += f.rps * errRate;
      }
    }

    /* ---------- 7. memory, crashes ---------- */
    for (const n of w.nodes) {
      const def = defs.get(n.type);
      if (!def || (def.role !== 'backend' && def.role !== 'worker')) continue;
      const capMb = def.ramMb * sizeFactor(n, def);
      let used = ram.get(n.id) ?? capMb * 0.35;
      const leak = active.filter((i) => i.kind === 'memoryLeak' && (i.target === n.id || i.target === n.type));
      const bugLeak = w.bugs.filter((b) => !b.fixed && b.memoryLeakMbPerMin).reduce((a, b) => a + (b.memoryLeakMbPerMin ?? 0) * bugShare(w, b), 0);
      if (!offline.has(n.id)) {
        used += (sum(leak.map((i) => Number(i.params?.mbPerMin ?? 5))) + (def.role === 'backend' ? bugLeak : 0)) * scale;
        used = Math.max(used, capMb * (0.3 + 0.25 * Math.min(1, util.get(n.id) ?? 0)));
      }
      if (used >= capMb && !offline.has(n.id)) {
        const restart = n.config.autoRestart === true || appBool(w, 'autoRestart');
        crashedUntil.set(n.id, restart ? t + 2 : ticks + 1);
        ctx.events.push({ tick: t, key: 'event.oom', params: { node: n.name }, level: 'error' });
        used = capMb * 0.3;
      }
      ram.set(n.id, used);
    }

    /* ---------- 8. record tick ---------- */
    const nodesTick: Record<string, NodeTick> = {};
    for (const n of w.nodes) {
      const def = defs.get(n.type);
      if (!def) continue;
      const u = util.get(n.id) ?? 0;
      const capMb = def.ramMb * sizeFactor(n, def);
      const nt: NodeTick = {
        util: round(u, 3),
        rps: round(load.get(n.id) ?? 0, 2),
        latencyMs: round(def.baseLatencyMs * queueFactor(Math.min(u, 0.97)), 2),
        errorRate: round(overloadErrors(u), 4),
        cpu: round(clamp(u, 0, 1) * 100, 1),
        ram: round(clamp((ram.get(n.id) ?? capMb * (0.25 + 0.4 * clamp(u, 0, 1))) / Math.max(1, capMb), 0, 1) * 100, 1),
        offline: offline.has(n.id),
      };
      if (def.role === 'cache') {
        nt.ram = round(clamp(cacheMemoryUse(ctx, n) / Math.max(1, Number(n.config.memoryMb ?? def.capacity)), 0, 1) * 100, 1);
      }
      nodesTick[n.id] = nt;
      const arr = nodeTicks.get(n.id) ?? [];
      arr.push(nt);
      nodeTicks.set(n.id, arr);
    }
    const dbUtil = Math.max(0, ...nodesOfRole(ctx, 'database').map((n) => util.get(n.id) ?? 0));
    tickMetrics.push({
      t,
      minute,
      rps: round(rpsTotal + botRps, 2),
      p50: round(weightedPercentile(tickPoints, 0.5), 1),
      p95: round(weightedPercentile(tickPoints, 0.95), 1),
      errorRate: round(tickW ? tickErrW / tickW : 0, 5),
      cacheHitRate: hitDen ? round(hitW / hitDen, 4) : null,
      queueBacklog: Math.round(backlogTotal),
      dbConnections: conns,
      dbUtil: round(dbUtil, 3),
      replicaLagMs: Math.round(lag),
      nodes: nodesTick,
    });

    // correctness anomalies driven by per-flow analysis
    for (const [f, info] of flowInfo) {
      for (const a of info.anomalies) addAnomaly(a.id, f.rps * a.perReq * 3600);
      for (const a of info.anomaliesPerHour) addAnomaly(a.id, a.perHour * (f.rps / Math.max(1e-9, totalRpsOf(flows, f.ep.id))));
    }
    if (lag > 0) {
      for (const [f, info] of flowInfo) {
        if (f.ep.readAfterWrite && info.readsFromReplica && appStr(w, 'readRouting', 'primary') !== 'read-your-writes') {
          addAnomaly('staleReads', f.rps * 3600 * clamp(lag / 2000, 0, 1));
        }
      }
    }
  }

  /* ---------- aggregate ---------- */
  const endpointSummaries: Record<string, EndpointSummary> = {};
  const allPoints: { v: number; w: number }[] = [];
  let errW = 0;
  let totW = 0;
  for (const ep of w.endpoints) {
    const acc = epAcc.get(ep.id);
    const explain = explains.get(ep.id) ?? [];
    const page = ep.assets?.length ? pageLoad(ctx, ep) : null;
    if (!acc) {
      endpointSummaries[ep.id] = {
        id: ep.id, rps: 0, p50: 0, p95: 0, p99: 0, errorRate: 0, errors: {}, status: 0, path: [], entry: null,
        cacheHitRate: null, dbMs: 0, rowsScanned: Math.max(0, ...explain.map((x) => x.rows)), explain, externalMs: 0,
        pageLoadMs: page?.ms ?? null, missingAssets: page?.missing ?? [], pageWeightKb: page?.weightKb ?? null, bugCodes: [], served: false,
      };
      continue;
    }
    allPoints.push(...acc.points);
    const errors: Partial<Record<ErrorCode, number>> = {};
    for (const [k, v] of Object.entries(acc.errW)) errors[k as ErrorCode] = round((v ?? 0) / Math.max(1e-9, acc.totalW), 5);
    const errorRate = combine(errors);
    errW += errorRate * acc.totalW;
    totW += acc.totalW;
    const dominant = Object.entries(errors).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0];
    const status = errorRate > 0.5 && dominant ? ERROR_STATUS[dominant[0] as ErrorCode] : ep.method === 'POST' && ep.writes ? 201 : 200;
    const mainPath = [...acc.paths.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]?.split('>') ?? [];
    endpointSummaries[ep.id] = {
      id: ep.id,
      rps: round(acc.rps, 3),
      p50: round(weightedPercentile(acc.points, 0.5), 1),
      p95: round(weightedPercentile(acc.points, 0.95), 1),
      p99: round(weightedPercentile(acc.points, 0.99), 1),
      errorRate: round(errorRate, 5),
      errors,
      status,
      path: mainPath,
      entry: acc.entry,
      cacheHitRate: acc.hitDen ? round(acc.hitW / acc.hitDen, 4) : null,
      dbMs: round(acc.dbMsW / Math.max(1e-9, acc.totalW), 2),
      rowsScanned: Math.max(0, ...explain.map((x) => x.rows * (ep.queries.find((q) => q.id === x.queryId)?.perRequest ?? 1))),
      explain,
      externalMs: round(acc.extMsW / Math.max(1e-9, acc.totalW), 1),
      pageLoadMs: page?.ms ?? null,
      missingAssets: page?.missing ?? [],
      pageWeightKb: page?.weightKb ?? null,
      bugCodes: w.bugs.filter((b) => b.endpoint === ep.id && bugShare(w, b) > 0).map((b) => b.logCode),
      served: acc.served,
    };
  }

  const nodeSummaries: Record<string, NodeSummary> = {};
  for (const n of w.nodes) {
    const arr = nodeTicks.get(n.id) ?? [];
    const def = defs.get(n.type);
    const utilAvg = arr.length ? sum(arr.map((x) => x.util)) / arr.length : 0;
    const utilMax = Math.max(0, ...arr.map((x) => x.util));
    const offTicks = arr.filter((x) => x.offline).length;
    const errAvg = arr.length ? sum(arr.map((x) => x.errorRate)) / arr.length : 0;
    const ramMax = Math.max(0, ...arr.map((x) => x.ram));
    const reasons: string[] = [];
    let status: NodeSummary['status'] = 'ok';
    if (n.offline || offTicks > arr.length / 2) {
      status = 'offline';
      reasons.push('offline');
    } else if (offTicks > 0) {
      status = 'error';
      reasons.push('crashed');
    } else if (utilMax > 1 || errAvg > 0.05) {
      status = 'error';
      reasons.push('overloaded');
    } else if (utilMax > 0.8 || ramMax > 85) {
      status = 'warn';
      reasons.push(utilMax > 0.8 ? 'hot' : 'memory');
    }
    if (def?.role === 'database' && (nodeConnections.get(n.id) ?? 0) >= Number(n.config.maxConnections ?? 151)) {
      if (status === 'ok') status = 'warn';
      reasons.push('connections');
    }
    nodeSummaries[n.id] = {
      id: n.id,
      rps: round(arr.length ? sum(arr.map((x) => x.rps)) / arr.length : 0, 2),
      util: round(utilAvg, 3),
      utilMax: round(utilMax, 3),
      latencyMs: round(arr.length ? sum(arr.map((x) => x.latencyMs)) / arr.length : 0, 2),
      errorRate: round(errAvg, 4),
      cpu: round(clamp(utilAvg, 0, 1) * 100, 1),
      ram: round(ramMax, 1),
      status,
      reasons,
      costPerMonth: def ? nodeCost(content, n) : 0,
      connections: def && (def.role === 'database' || def.role === 'replica') ? nodeConnections.get(n.id) ?? 0 : undefined,
      maxConnections: def && (def.role === 'database' || def.role === 'replica') ? Number(n.config.maxConnections ?? 151) : undefined,
      memoryUsedMb: def?.role === 'cache' ? round(cacheMemoryUse(ctx, n), 1) : undefined,
      memoryMb: def?.role === 'cache' ? Number(n.config.memoryMb ?? def.capacity) : undefined,
      instances: instancesMax.get(n.id),
    };
  }

  const queues: Record<string, QueueSummary> = {};
  for (const [name, acc] of queueAcc) {
    const thr = sum(acc.thr) / Math.max(1, acc.thr.length);
    const end = acc.backlog[acc.backlog.length - 1] ?? 0;
    queues[name] = {
      name,
      inRate: round(sum(acc.inRate) / Math.max(1, acc.inRate.length), 3),
      throughput: round(thr, 3),
      backlogEnd: Math.round(end),
      backlogMax: Math.round(Math.max(0, ...acc.backlog)),
      waitSec: round(thr > 0 ? end / thr : end > 0 ? Infinity : 0, 1),
      failedPerHour: round(acc.failed, 1),
      dlqPerHour: round(acc.dlq, 1),
      duplicatesPerHour: round(acc.dup, 1),
      retriesPerHour: round(acc.retries, 1),
      workers: acc.workers,
    };
  }

  const edges: Record<string, { rps: number; errorRate: number }> = {};
  for (const e of w.edges) {
    const l = edgeLoad.get(`${e.from}>${e.to}`);
    edges[e.id] = { rps: l ? round(l.rps / ticks, 3) : 0, errorRate: l && l.rps > 0 ? round(l.err / l.rps, 4) : 0 };
  }

  const errorRate = totW ? errW / totW : 0;
  const hitAll = Object.values(endpointSummaries).filter((e) => e.cacheHitRate !== null);
  const homePage = Object.values(endpointSummaries).find((e) => e.pageLoadMs !== null);
  const regionP95: Partial<Record<RegionId, number>> = {};
  for (const [r, pts] of regionPoints) regionP95[r] = round(weightedPercentile(pts, 0.95), 1);
  const backlogs = Object.values(queues);

  const summary = {
    rps: round(sum(tickMetrics.map((x) => x.rps)) / Math.max(1, ticks), 2),
    p50: round(weightedPercentile(allPoints, 0.5), 1),
    p95: round(weightedPercentile(allPoints, 0.95), 1),
    p99: round(weightedPercentile(allPoints, 0.99), 1),
    errorRate: round(errorRate, 5),
    availability: round(1 - errorRate, 5),
    cacheHitRate: hitAll.length ? round(sum(hitAll.map((e) => (e.cacheHitRate ?? 0) * e.rps)) / Math.max(1e-9, sum(hitAll.map((e) => e.rps))), 4) : null,
    queueBacklog: backlogs.length ? sum(backlogs.map((q) => q.backlogEnd)) : null,
    dbUtil: nodesOfRole(ctx, 'database').length ? round(Math.max(0, ...nodesOfRole(ctx, 'database').map((n) => nodeSummaries[n.id]?.utilMax ?? 0)), 3) : null,
    dbConnections: connectionsSeen,
    maxConnections: maxConnectionsSeen,
    replicaLagMs: Math.round(replicaLagMax),
    pageLoadMs: homePage?.pageLoadMs ?? null,
    pageWeightKb: homePage?.pageWeightKb ?? null,
    regionP95,
    errorBudgetUsed: null as number | null,
    providerAmplification: round(providerAmplification, 2),
  };
  const slo = w.observability.slo;
  if (slo) {
    const budget = 1 - slo.availability;
    summary.errorBudgetUsed = budget > 0 ? round(errorRate / budget, 3) : null;
  }

  for (const k of Object.keys(anomalies)) anomalies[k] = round(anomalies[k], 1);

  return {
    seq: state.seq,
    seed,
    clock: state.clock,
    ticks: tickMetrics,
    summary,
    endpoints: endpointSummaries,
    nodes: nodeSummaries,
    edges,
    queues,
    anomalies,
    traces: [],
    logs: [],
    alerts: [],
    events: ctx.events,
    vulns: [],
    cost: { total: 0, breakdown: [] },
    quality: { performance: 0, reliability: 0, security: 0, maintainability: 0, cost: 0 },
    qualityReasons: [],
    snapshot: null as never,
    warnings: [],
  } satisfies SimResult;
}

export function simSeed(state: GameState, opts: SimOptions = {}): number {
  return combineSeed(state.seed, state.campaign.currentMissionId ?? 'free', state.clock, opts.salt ?? '');
}

/* ------------------------------------------------------------------ */
/* flow analysis                                                       */
/* ------------------------------------------------------------------ */

const JITTER: [number, number][] = [
  [0.7, 0.3],
  [1, 0.42],
  [1.45, 0.18],
  [2.4, 0.1],
];

interface FlowInfo {
  terminal: string | null;
  cpuMs: number;
  dbCalls: { db: string; rate: number; costMs: number; netMs: number; read: boolean }[];
  readShareOfDb: number;
  readsFromReplica: boolean;
  cache: string | null;
  cacheable: boolean;
  hitRate: number;
  cacheMs: number;
  cacheOpsPerReq: number;
  cacheOomErr: number;
  cdnHit: number;
  wafBlocked: number;
  asyncJobs: { job: JobDef; queueName: string; queueNode: string | null; durMs: number }[];
  syncJobMs: number;
  syncJobErr: { code: ErrorCode; p: number }[];
  providers: string[];
  syncProviders: { provider: string; latencyMs: number; critical: boolean }[];
  serviceCalls: string[];
  missingServices: string[];
  bugs: { errorRate: number; share: number }[];
  sessionLoss: number;
  storageMissing: number;
  extraErrors: { code: ErrorCode; p: number }[];
  extraLatencyMs: number;
  lockWaitMs: number;
  deadlockErr: number;
  anomalies: { id: string; perReq: number }[];
  anomaliesPerHour: { id: string; perHour: number }[];
}

/** Share of a query's executions that reach the database: reads skip it on a cache hit. */
function dbShare(info: FlowInfo, q: FlowInfo['dbCalls'][number]): number {
  return q.read ? 1 - info.hitRate : 1;
}

function totalRpsOf(flows: Flow[], epId: string): number {
  return sum(flows.filter((f) => f.ep.id === epId).map((f) => f.rps));
}

function clientId(ctx: Ctx): string {
  return ctx.w.nodes.find((n) => roleOfNode(ctx, n) === 'client')?.id ?? 'client';
}

function bumpEdge(map: Map<string, { rps: number; err: number; n: number }>, from: string, to: string, rps: number) {
  const k = `${from}>${to}`;
  const v = map.get(k) ?? { rps: 0, err: 0, n: 0 };
  v.rps += rps;
  v.n++;
  map.set(k, v);
}

function epAccum(map: Map<string, EpAccum>, id: string): EpAccum {
  let a = map.get(id);
  if (!a) {
    a = { points: [], rps: 0, errW: {}, totalW: 0, hitW: 0, hitDen: 0, dbMsW: 0, extMsW: 0, paths: new Map(), entry: null, served: false };
    map.set(id, a);
  }
  return a;
}

function normaliseMix(w: World): [RegionId, number][] {
  const entries = Object.entries(w.traffic.regionMix ?? { eu: 1 }) as [RegionId, number][];
  const total = sum(entries.map(([, v]) => v)) || 1;
  const out = entries.map(([r, v]) => [r, v / total] as [RegionId, number]).filter(([, v]) => v > 0);
  return out.length ? out : [['eu', 1]];
}

function isPooled(ctx: Ctx, db: ArchNode): boolean {
  return db.config.pooler === true && roleOfNode(ctx, db) === 'database';
}

/** DNS resolution & failover: which entry node(s) users of a region reach. */
function resolveEntry(
  ctx: Ctx,
  ep: EndpointDef,
  region: RegionId,
  offline: Set<string>,
  t: number,
  regionDownSince: Map<string, number>,
): { share: number; filter: Set<string> | null; error?: ErrorCode }[] {
  const w = ctx.w;
  const client = w.nodes.find((n) => roleOfNode(ctx, n) === 'client');
  if (!client) return [{ share: 1, filter: null, error: 'NO_ROUTE' }];
  const entries = w.edges.filter((e) => e.from === client.id).map((e) => ctx.byId.get(e.to)).filter((n): n is ArchNode => !!n && roleOfNode(ctx, n) !== 'dns');

  if (!w.dns.domain) return [{ share: 1, filter: null }];

  // users must be able to resolve the name at all
  const apex = w.dns.records.find((r) => r.name === '@' && (r.type === 'A' || r.type === 'CNAME'));
  const wwwShare = 0.25;
  const www = w.dns.records.find((r) => r.name === 'www' && (r.type === 'A' || r.type === 'CNAME'));
  const parts: { share: number; filter: Set<string> | null; error?: ErrorCode }[] = [];
  if (!apex) return [{ share: 1, filter: null, error: 'DNS_NXDOMAIN' }];
  if (!www) parts.push({ share: wwwShare, filter: null, error: 'DNS_NXDOMAIN' });
  const okShare = www ? 1 : 1 - wwwShare;

  // GeoDNS / failover choose an entry per user region
  if (w.dns.geoRouting || w.dns.failover) {
    // an entry is healthy when it is up and still has a live route to a server (a CDN whose
    // origin is down is not)
    const healthy = entries.filter((n) => !offline.has(n.id) && entryServes(ctx, ep, n, offline, region));
    const apexEntries = entries.filter((n) => n.ip === apex.value);
    // GeoDNS answers with an entry in the user's region; elsewhere (or without GeoDNS) the A record
    let candidates = w.dns.geoRouting ? healthy.filter((n) => n.region === region) : [];
    if (!candidates.length) candidates = healthy.filter((n) => apexEntries.includes(n));
    if (!candidates.length && w.dns.failover) {
      // health checks need ~2 ticks to notice an outage; resolvers keep the old answer for the TTL
      const outages = [...regionDownSince.values()].filter((s) => s <= t);
      const downSince = outages.length ? Math.min(...outages) : -Infinity;
      const detect = 2 + Math.ceil((apex.ttl / 60) / ctx.scale);
      if (t - downSince < detect) {
        parts.push({ share: okShare, filter: null, error: 'REGION_DOWN' });
        return parts;
      }
      const home = healthy.filter((n) => n.region === ctx.w.primaryRegion);
      candidates = home.length ? home : healthy;
    }
    if (!candidates.length && !w.dns.failover) candidates = apexEntries;
    if (!candidates.length) {
      parts.push({ share: okShare, filter: null, error: 'REGION_DOWN' });
      return parts;
    }
    parts.push({ share: okShare, filter: new Set(candidates.map((n) => n.id)) });
    return parts;
  }

  // classic single A record (with stale resolvers after a change)
  const resolved: { ip: string; share: number }[] = [];
  const target = apex.type === 'A' ? apex.value : null;
  const change = [...w.dns.changes].reverse().find((c) => c.name === '@' && c.type === 'A');
  const minuteNow = ctx.state.clock + t * ctx.scale;
  if (change && change.oldValue && change.oldValue !== target) {
    const elapsedSec = (minuteNow - change.at) * 60;
    const stale = clamp(1 - elapsedSec / Math.max(1, change.oldTtl), 0, 1);
    if (stale > 0) resolved.push({ ip: change.oldValue, share: stale });
    resolved.push({ ip: target ?? '', share: 1 - stale });
  } else {
    resolved.push({ ip: target ?? '', share: 1 });
  }
  for (const r of resolved) {
    if (r.share <= 0) continue;
    const matching = entries.filter((n) => n.ip === r.ip);
    if (!matching.length) {
      const exists = ctx.w.nodes.some((n) => n.ip === r.ip);
      parts.push({ share: r.share * okShare, filter: null, error: exists ? 'DNS_MISMATCH' : 'CONNECTION_TIMEOUT' });
      continue;
    }
    if (matching.every((n) => offline.has(n.id))) {
      parts.push({ share: r.share * okShare, filter: null, error: 'CONNECTION_TIMEOUT' });
      continue;
    }
    parts.push({ share: r.share * okShare, filter: new Set(matching.map((n) => n.id)) });
  }
  void ep;
  return parts;
}

/** Does traffic entering at this node still reach a server for the endpoint? (DNS health checks) */
function entryServes(ctx: Ctx, ep: EndpointDef, entry: ArchNode, offline: Set<string>, region: RegionId): boolean {
  const key = `${ep.id}|${entry.id}|${[...offline].sort().join(',')}`;
  let ok = ctx.entryHealth.get(key);
  if (ok === undefined) {
    const route = routeEndpoint({ content: ctx.content, world: ctx.w, offline, entryFilter: new Set([entry.id]), userRegion: region }, ep);
    ok = !route.error && route.paths.some((p) => !p.failed);
    ctx.entryHealth.set(key, ok);
  }
  return ok;
}

/** Ports, firewall, TLS, mixed content and CORS at the entry node. */
function entryChecks(ctx: Ctx, ep: EndpointDef, route: Route, minute: number): Partial<Record<ErrorCode, number>> {
  const errs: Partial<Record<ErrorCode, number>> = {};
  const w = ctx.w;
  const entry = route.entry ? ctx.byId.get(route.entry) : undefined;
  if (!entry) return errs;
  const role = roleOfNode(ctx, entry);
  const tls = w.tls.enabled;
  if (role === 'backend') {
    const port = Number(entry.config.port ?? 8000);
    if (!entry.ports.includes(port)) addErr(errs, 'CONNECTION_REFUSED', 1);
    else if (!entry.publicPorts.includes(port)) addErr(errs, 'CONNECTION_TIMEOUT', 1);
    if (tls) {
      // https page → http://ip:8000 : browsers block scripts/API calls (mixed content)
      if (ep.api || ep.browserFetch) addErr(errs, 'MIXED_CONTENT', 1);
    }
    // a different origin (port 8000) than the site: CORS applies to browser JavaScript
    if (ep.browserFetch) {
      const cors = String(w.app.cors ?? 'none');
      if (cors === 'none') addErr(errs, 'CORS_BLOCKED', 1);
      if (cors === 'wildcard' && ep.auth !== 'none') addErr(errs, 'CORS_BLOCKED', 1);
    }
  } else if (role === 'proxy' || role === 'lb' || role === 'waf' || role === 'cdn') {
    const port = tls ? 443 : Number(w.site.port ?? 80);
    const listening = role === 'proxy' ? Number(entry.config.listenPort ?? 80) : 80;
    const listens = tls ? entry.ports.includes(443) || role !== 'proxy' : listening === port || entry.ports.includes(port);
    if (!listens) addErr(errs, 'CONNECTION_REFUSED', 1);
    else if (role === 'proxy' && !entry.publicPorts.includes(port)) addErr(errs, 'CONNECTION_TIMEOUT', 1);
  }
  if (tls && role !== 'backend') {
    if (w.tls.expiresAt !== null && minute >= w.tls.expiresAt) addErr(errs, 'TLS_EXPIRED', 1);
  }
  return errs;
}

function rateLimitBlocks(ctx: Ctx): number {
  const w = ctx.w;
  let blocked = 0;
  if (appBool(w, 'loginRateLimit')) blocked = 0.98;
  for (const n of nodesOfRole(ctx, 'proxy')) if (Number(n.config.rateLimit ?? 0) > 0) blocked = Math.max(blocked, 0.95);
  for (const n of nodesOfRole(ctx, 'waf')) if (n.config.mode === 'block' && n.config.ruleBots === true) blocked = Math.max(blocked, 0.9);
  return blocked;
}

function providerFailure(ctx: Ctx, provider: string | null, active: WorldIncident[]): number {
  if (!provider) return 0;
  let fail = 0;
  for (const inc of active) {
    if (inc.target !== provider) continue;
    if (inc.kind === 'providerDown') fail = 1;
    if (inc.kind === 'providerSlow') fail = Math.max(fail, Number(inc.params?.errorRate ?? 0.05));
  }
  return fail;
}

function providerCall(ctx: Ctx, provider: string, active: WorldIncident[], baseLatency: number) {
  const w = ctx.w;
  let latency = baseLatency;
  let fail = 0;
  for (const inc of active) {
    if (inc.target !== provider) continue;
    if (inc.kind === 'providerSlow') {
      latency = Number(inc.params?.latencyMs ?? latency * 10);
      fail = Math.max(fail, Number(inc.params?.errorRate ?? 0));
    }
    if (inc.kind === 'providerDown') {
      fail = 1;
      latency = Number(inc.params?.latencyMs ?? 10000);
    }
  }
  const timeout = appNum(w, 'providerTimeoutMs', TIMEOUT_MS);
  // provider latency spread ≈ uniform[0.6L, 1.6L]
  const pTimeout = clamp((1.6 * latency - timeout) / Math.max(1, latency), 0, 1);
  const attemptFail = 1 - (1 - fail) * (1 - pTimeout);
  const retries = appNum(w, 'retries', 0);
  const layers = Number(w.flags.retryLayers ?? 1);
  let ampl = 1;
  let finalFail = attemptFail;
  let ms = Math.min(latency, timeout);
  const breaker = appBool(w, 'circuitBreaker');
  if (breaker && attemptFail > 0.5) {
    return { ms: 3, fail: 1, timeout: false, ampl: 1, circuitOpen: true };
  }
  if (retries > 0 && attemptFail > 0) {
    const perLayer = (1 - attemptFail ** (retries + 1)) / Math.max(1e-6, 1 - attemptFail);
    ampl = perLayer ** layers;
    finalFail = attemptFail ** ((retries + 1) * layers);
    const jitter = appBool(w, 'retryJitter') ? 1 : 1.3;
    ms = Math.min(TIMEOUT_MS, ms * Math.min(ampl, 12) * jitter);
    // a degraded provider gets even slower under the retry storm
    if (ampl > 2 && fail > 0) finalFail = Math.max(finalFail, clamp(fail * Math.log2(ampl) * 0.5, 0, 1));
  }
  return { ms, fail: finalFail, timeout: pTimeout > fail, ampl, circuitOpen: false };
}

/** Redis used by a backend for a purpose: a dedicated instance wins over a shared one. */
function cacheNodeFor(ctx: Ctx, backend: ArchNode, purpose: 'cache' | 'sessions'): ArchNode | undefined {
  const caches = neighborsOfRole(ctx, backend.id, 'cache');
  return (
    caches.find((c) => String(c.config.purpose ?? 'both') === purpose) ??
    caches.find((c) => String(c.config.purpose ?? 'both') === 'both') ??
    undefined
  );
}

function cacheMemoryUse(ctx: Ctx, cacheNode: ArchNode): number {
  // working set of cached endpoints (MB) + sessions, depending on what the instance stores
  const purpose = String(cacheNode.config.purpose ?? 'both');
  let mb = 0;
  if (purpose !== 'sessions') {
    for (const ep of ctx.w.endpoints) {
      const rule = ctx.w.cacheRules.find((r) => r.endpoint === ep.id && r.enabled);
      if (!rule || !ep.cache || ep.disabled) continue;
      mb += (ep.cache.cardinality * ep.cache.valueKb) / 1024;
    }
    mb += Number(ctx.w.flags.cacheExtraMb ?? 0);
  }
  if (purpose !== 'cache' && String(ctx.w.app.sessionStore ?? 'memory') === 'redis') mb += (ctx.w.traffic.users * 0.2 * 2) / 1024;
  return mb;
}

function analyseFlow(ctx: Ctx, f: Flow, t: number, active: WorldIncident[], explain: ExplainRow[], offline: Set<string>, epRps: number): FlowInfo {
  const { w } = ctx;
  const ep = f.ep;
  const info: FlowInfo = {
    terminal: null,
    cpuMs: 0,
    dbCalls: [],
    readShareOfDb: 0,
    readsFromReplica: false,
    cache: null,
    cacheable: false,
    hitRate: 0,
    cacheMs: 0,
    cacheOpsPerReq: 0,
    cacheOomErr: 0,
    cdnHit: 0,
    wafBlocked: 0,
    asyncJobs: [],
    syncJobMs: 0,
    syncJobErr: [],
    providers: [],
    syncProviders: [],
    serviceCalls: [],
    missingServices: [],
    bugs: [],
    sessionLoss: 0,
    storageMissing: 0,
    extraErrors: [],
    extraLatencyMs: 0,
    lockWaitMs: 0,
    deadlockErr: 0,
    anomalies: [],
    anomaliesPerHour: [],
  };
  const last = f.path[f.path.length - 1];
  const termNode = ctx.byId.get(last);
  const termRole = roleOfNode(ctx, termNode);
  info.terminal = last;

  // CDN / WAF on the path
  for (const id of f.path) {
    const n = ctx.byId.get(id)!;
    const r = roleOfNode(ctx, n);
    if (r === 'cdn') {
      if (ep.target === 'static' && n.config.cacheStatic !== false) info.cdnHit = 0.95;
      else if (ep.method === 'GET' && n.config.cacheApi === true && ep.cache) info.cdnHit = 0.6;
    }
  }

  if (ep.target === 'static') {
    info.cpuMs = 0.3;
    if (termRole === 'backend') info.cpuMs = 2;
    return info;
  }
  if (termRole !== 'backend' || !termNode) {
    info.extraErrors.push({ code: 'NO_BACKEND', p: 1 });
    return info;
  }

  // ---- CPU on the backend
  let cpu = ep.cpuMs;
  if (isPasswordEndpoint(ep)) cpu += passwordCpuMs(w);
  const bugs = w.bugs.filter((b) => b.endpoint === ep.id || !b.endpoint);
  for (const b of bugs) {
    const share = bugShare(w, b);
    if (share <= 0) continue;
    cpu += (b.extraCpuMs ?? 0) * share;
    info.extraLatencyMs += (b.extraLatencyMs ?? 0) * share;
    if (b.errorRate) info.bugs.push({ errorRate: b.errorRate, share });
    if (b.anomaly) info.anomaliesPerHour.push({ id: b.anomaly.id, perHour: b.anomaly.perHour * share });
  }
  // each query costs some application CPU (ORM hydration) — N+1 shows up here as well
  const queryCount = sum(ep.queries.map((q) => q.perRequest ?? 1));
  cpu += queryCount * 0.15;

  // ---- data source
  const dataSource = String(w.app.dataSource ?? 'mysql');
  const backendDbs = neighborsOfRole(ctx, termNode.id, 'database');
  const replicas = neighborsOfRole(ctx, termNode.id, 'replica').filter((r) => !offline.has(r.id));
  const routing = String(w.app.readRouting ?? 'primary');
  if (ep.queries.length) {
    if (dataSource === 'json-file') {
      const rows = sum(ep.queries.map((q) => w.tables.find((tb) => tb.name === q.table)?.rows ?? 0));
      cpu += rows * 0.002;
      if (ep.writes) {
        // two writers rewriting the same JSON file at once lose one update / corrupt the file
        info.anomalies.push({ id: 'corruptedWrites', perReq: clamp(f.rps * 0.08, 0, 0.5) });
      }
    } else {
      let primary = backendDbs.find((d) => !offline.has(d.id)) ?? null;
      if (!primary) {
        const promoted = replicas.find((r) => r.config.promoteOnFailure === true);
        const downSince = Math.min(...w.incidents.filter((i) => i.active && (i.kind === 'regionDown' || i.kind === 'nodeDown')).map((i) => i.startTick ?? 0), t);
        if (promoted && t - downSince >= 2) primary = promoted;
      }
      if (!backendDbs.length && !primary) {
        info.extraErrors.push({ code: 'NO_DATABASE', p: 1 });
      }
      let readMs = 0;
      let totalMs = 0;
      for (let i = 0; i < ep.queries.length; i++) {
        const q = ep.queries[i];
        const ex = explain[i];
        const isRead = q.op === 'select' && !q.lockRows && !ep.writes;
        // reads routed to replicas are spread across all of them; everything else goes to the primary
        const targets = isRead && routing !== 'primary' && replicas.length ? replicas : primary ? [primary] : [];
        if (targets === replicas) info.readsFromReplica = true;
        if (!targets.length) {
          info.extraErrors.push({ code: 'DB_DOWN', p: 1 });
          continue;
        }
        const rate = (q.perRequest ?? 1) / targets.length;
        const cost = ex?.costMs ?? 0.5;
        for (const target of targets) {
          const netMs = dcRtt(termNode.region, target.region);
          info.dbCalls.push({ db: target.id, rate, costMs: cost, netMs, read: isRead });
          totalMs += rate * (cost + netMs);
          if (isRead) readMs += rate * (cost + netMs);
        }
      }
      info.readShareOfDb = totalMs > 0 ? readMs / totalMs : 0;
    }
  }

  // ---- cache
  const rule = w.cacheRules.find((r) => r.endpoint === ep.id && r.enabled);
  const cacheNode = cacheNodeFor(ctx, termNode, 'cache');
  if (ep.cache && rule && cacheNode) {
    info.cacheable = true;
    info.cache = cacheNode.id;
    info.cacheOpsPerReq = 1;
    info.cacheMs = 0.5 + dcRtt(termNode.region, cacheNode.region);
    const lambdaKey = epRps / Math.max(1, ep.cache.cardinality);
    let hit = ttlHitRatio(lambdaKey, rule.ttl);
    // memory pressure: the working set may not fit
    const memMb = Number(cacheNode.config.memoryMb ?? 256);
    const used = cacheMemoryUse(ctx, cacheNode);
    if (used > memMb) {
      const policy = String(cacheNode.config.maxmemoryPolicy ?? 'noeviction');
      const fit = memMb / used;
      if (policy === 'noeviction') {
        // writes fail with "OOM command not allowed when used memory > 'maxmemory'"
        info.cacheOomErr = clamp((1 - fit) * (1 - hit), 0, 1) * (w.app.cacheFailOpen === true ? 0 : 1);
        hit *= fit;
      } else {
        hit *= Math.pow(fit, 0.6);
        if (policy === 'allkeys-lru' && String(w.app.sessionStore ?? 'memory') === 'redis' && String(cacheNode.config.purpose ?? 'cache') !== 'cache') {
          info.sessionLoss = Math.max(info.sessionLoss, (1 - fit) * 0.3);
        }
      }
    }
    // flushed cache warms up again
    const flush = active.find((i) => i.kind === 'cacheFlush');
    if (flush) {
      const since = t - (flush.startTick ?? 0);
      const warm = Math.max(1, Number(w.app.cacheWarming === true ? 1 : 6));
      hit *= 1 - Math.exp(-since / warm);
    }
    info.hitRate = clamp(hit, 0, 0.995);
    // stale data
    const writes = (ep.cache.writesPerHourPerKey ?? 0) / 3600;
    if (writes > 0 && String(w.app.cacheInvalidation ?? 'ttl') !== 'on-write') {
      info.anomalies.push({ id: 'staleReads', perReq: info.hitRate * staleFraction(writes, rule.ttl) });
    }
    if (offline.has(cacheNode.id)) info.hitRate = 0;
  }

  // ---- jobs (sync vs queued)
  const queueNode = neighborsOfRole(ctx, termNode.id, 'queue')[0];
  const queueHasWorkers = queueNode ? neighborsOfRole(ctx, queueNode.id, 'worker').length > 0 : false;
  for (const job of ep.jobs ?? []) {
    const asyncOn = w.app[job.asyncSetting] === true && !!queueNode && queueHasWorkers && !offline.has(queueNode.id);
    const extLatency = job.external ? providerBase(ctx, job.external) : 0;
    const dur = job.cpuMs + (job.ioMs ?? 0) + extLatency;
    if (asyncOn) {
      const qName = w.app.queueSeparation === true ? job.queue ?? 'critical' : 'default';
      info.asyncJobs.push({ job, queueName: qName, queueNode: queueNode.id, durMs: dur });
      cpu += 1.5;
      info.extraLatencyMs += 2;
    } else {
      cpu += job.cpuMs * (job.perRequest ?? 1);
      info.syncJobMs += ((job.ioMs ?? 0) + (job.external ? providerCall(ctx, job.external, active, extLatency).ms : 0)) * (job.perRequest ?? 1);
      if (job.external) {
        const res = providerCall(ctx, job.external, active, extLatency);
        if (res.fail > 0) info.syncJobErr.push({ code: res.timeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR', p: res.fail });
        info.providers.push(job.external);
      }
    }
  }

  // ---- external providers in the request path
  for (const ext of ep.external ?? []) {
    const providerNode = neighborsOfRole(ctx, termNode.id, 'provider').find((p) => p.type === ext.provider);
    if (!providerNode && ext.provider !== 'fetch') {
      info.extraErrors.push({ code: 'PROVIDER_ERROR', p: 1 });
      continue;
    }
    info.providers.push(ext.provider);
    info.syncProviders.push({ provider: ext.provider, latencyMs: ext.latencyMs ?? providerBase(ctx, ext.provider), critical: true });
  }

  // ---- synchronous service calls
  for (const svc of ep.calls ?? []) {
    const targets = ctx.w.nodes.filter((n) => roleOfNode(ctx, n) === 'backend' && n.config.service === svc);
    const linked = targets.filter((tn) => edgeExists(ctx, termNode.id, tn.id));
    if (!targets.length && (termNode.config.service ?? 'monolith') === 'monolith') continue; // still inside the monolith
    if (!linked.length) {
      info.missingServices.push(svc);
      continue;
    }
    info.serviceCalls.push(linked[t % linked.length].id);
  }

  // ---- auth / sessions
  if (ep.auth !== 'none') {
    const mode = String(w.app.authMode ?? 'none');
    if (mode === 'none') info.extraErrors.push({ code: 'SESSION_LOST', p: 1 });
    if (mode === 'session') {
      const store = String(w.app.sessionStore ?? 'memory');
      const n = totalBackends(ctx, ep);
      const lb = f.path.map((id) => ctx.byId.get(id)!).find((x) => roleOfNode(ctx, x) === 'lb' || roleOfNode(ctx, x) === 'proxy');
      const sticky = lb?.config.sticky === true;
      if (store === 'memory' && n > 1 && !sticky) info.sessionLoss = Math.max(info.sessionLoss, 1 - 1 / n);
      if (store === 'redis') {
        const redis = cacheNodeFor(ctx, termNode, 'sessions');
        if (!redis) info.sessionLoss = Math.max(info.sessionLoss, 1);
        else if (offline.has(redis.id)) info.sessionLoss = 1;
      }
      // in-memory sessions die with a restart
      if (store === 'memory' && w.incidents.some((i) => i.active && i.kind === 'memoryLeak')) info.sessionLoss = Math.max(info.sessionLoss, 0.02);
    }
    if (ep.auth === 'admin' && w.app.adminRoleCheck !== true) {
      info.anomaliesPerHour.push({ id: 'unauthorizedAdminActions', perHour: 6 });
    }
  }

  // ---- uploads & files on local disks
  if (ep.upload || ep.id === 'avatar') {
    const target = String(w.app.uploadsTarget ?? 'local-disk');
    if (target === 'local-disk') {
      const n = totalBackends(ctx, ep);
      if (n > 1) info.storageMissing = 1 - 1 / n;
      if (active.some((i) => i.kind === 'diskFull')) info.extraErrors.push({ code: 'DISK_FULL', p: 0.9 });
    } else if (!neighborsOfRole(ctx, termNode.id, 'storage').length) {
      info.extraErrors.push({ code: 'STORAGE_MISSING', p: 1 });
    }
  }

  // ---- API semantics
  if (ep.api && String(w.app.apiStatusCodes ?? 'proper') === 'always-200') {
    info.anomalies.push({ id: 'misreportedErrors', perReq: 0.04 });
  }
  if (ep.id === 'api_delete' && String(w.app.deleteMethod ?? 'DELETE') === 'GET') {
    info.anomaliesPerHour.push({ id: 'crawlerDeletes', perHour: 30 });
  }
  if (ep.id === 'register' && w.app.inputValidation !== true) {
    info.anomalies.push({ id: 'invalidRecords', perReq: 0.12 });
  }

  // ---- concurrency anomalies
  if (ep.id === 'checkout') {
    const mode = String(w.app.inventoryUpdate ?? 'read-then-write');
    const hot = Number(w.flags.limitedDrop ?? 0);
    if (hot > 0) {
      const lambdaHot = f.rps * hot;
      if (mode === 'read-then-write') info.anomaliesPerHour.push({ id: 'oversold', perHour: lambdaHot * lambdaHot * 0.25 * 3600 * 0.01 });
      if (mode === 'locking') {
        info.lockWaitMs = clamp(lambdaHot * 40, 0, 2000);
        const refunds = w.endpoints.find((e) => e.id === 'refund' && !e.disabled);
        if (refunds && String(w.app.lockOrdering ?? 'inconsistent') === 'inconsistent') {
          const p = clamp(lambdaHot * 0.004, 0, 0.2);
          if (w.app.deadlockRetry === true) info.lockWaitMs += p * 400;
          else info.deadlockErr = p;
          info.anomaliesPerHour.push({ id: 'deadlocks', perHour: p * f.rps * 3600 });
        }
      }
    }
    if (ep.doubleSubmit !== false && w.app.paymentIdempotency !== true) {
      const mobile = clamp(w.traffic.mobileShare ?? 0.3, 0, 1);
      info.anomalies.push({ id: 'doubleCharges', perReq: 0.004 + mobile * 0.01 });
    }
    if (w.flags.eventsViaBroker === true && w.app.outbox !== true) {
      const brokerDown = active.some((i) => i.kind === 'nodeDown' && (i.target === 'queue' || ctx.byId.get(i.target ?? '')?.type === 'queue'));
      info.anomalies.push({ id: 'lostEvents', perReq: brokerDown ? 0.6 : 0.002 });
    }
  }
  if (ep.id === 'webhook') {
    const slow = w.app.webhookAsync === true ? 0.01 : 0.15;
    if (w.app.webhookIdempotency !== true) info.anomalies.push({ id: 'duplicateFulfillments', perReq: slow * 0.3 + 0.01 });
    if (w.app.webhookAsync !== true) info.extraLatencyMs += 2500;
  }

  info.cpuMs = cpu;
  return info;
}

function providerBase(ctx: Ctx, provider: string): number {
  const def = maybeComponent(ctx.content, provider);
  return def?.baseLatencyMs ?? 300;
}

function totalBackends(ctx: Ctx, ep: EndpointDef): number {
  const svc = ep.service ?? 'monolith';
  const all = ctx.w.nodes.filter((n) => roleOfNode(ctx, n) === 'backend' && !n.offline);
  const dedicated = all.filter((n) => (n.config.service ?? 'monolith') === svc);
  const list = dedicated.length ? dedicated : all.filter((n) => (n.config.service ?? 'monolith') === 'monolith');
  return sum(list.map((n) => (n.config.autoscale === true ? Number(n.config.maxInstances ?? 4) / 2 : 1)));
}

/** Network part of a request: user ↔ entry (and CDN ↔ origin) round trips + handshakes. */
function networkMs(ctx: Ctx, f: Flow, info: FlowInfo | undefined): number {
  const w = ctx.w;
  const entry = f.path[0] ? ctx.byId.get(f.path[0]) : undefined;
  const region = entry?.region ?? w.primaryRegion;
  const tls = w.tls.enabled;
  let firstHopRtt = rtt(f.region, region);
  let originRtt = 0;
  if (entry && roleOfNode(ctx, entry) === 'cdn') {
    const edges = String(entry.config.edges ?? region).split(',');
    firstHopRtt = edges.includes(f.region) ? rtt(f.region, f.region) : Math.min(...edges.map((e) => rtt(f.region, e as RegionId)));
    const origin = info?.terminal ? ctx.byId.get(info.terminal) : undefined;
    const missShare = 1 - (info?.cdnHit ?? 0);
    originRtt = origin ? dcRtt(edges.includes(f.region) ? f.region : region, origin.region) * missShare : 0;
  }
  const http2 = ctx.w.nodes.some((n) => roleOfNode(ctx, n) === 'proxy' && n.config.http2 === true);
  return (
    requestNetworkMs({
      rttMs: firstHopRtt,
      tls,
      tlsVersion: w.tls.version,
      resumption: w.tls.sessionResumption,
      responseKb: f.ep.responseKb,
      bandwidthMbps: w.traffic.bandwidthMbps ?? DESKTOP.bandwidthMbps,
      newConnShare: http2 ? 0.15 : 0.3,
    }) +
    originRtt +
    (w.dns.domain ? 3 : 0)
  );
}

/** Page load for endpoints with assets: HTML TTFB + transfer of the initial (non-lazy) assets. */
function pageLoad(ctx: Ctx, ep: EndpointDef): { ms: number; weightKb: number; missing: string[] } {
  const w = ctx.w;
  const proxy = ctx.w.nodes.find((n) => roleOfNode(ctx, n) === 'proxy');
  const gzip = proxy?.config.gzip === true;
  const http2 = proxy?.config.http2 === true;
  const cacheHeaders = proxy?.config.cacheHeaders === true;
  const cdn = ctx.w.nodes.find((n) => roleOfNode(ctx, n) === 'cdn' && n.config.cacheStatic !== false && w.edges.some((e) => e.to === n.id));
  const missing: string[] = [];
  let initialKb = 0;
  let count = 0;
  for (const a of ep.assets ?? []) {
    const file = w.files.find((fl) => fl.path === `/var/www/html/${a}`);
    if (!file) {
      missing.push(a);
      continue;
    }
    if (file.lazy) continue;
    let kb = file.sizeKb;
    if (gzip && ['html', 'css', 'js'].includes(file.kind)) kb *= 0.3;
    if (file.kind === 'image' && file.optimized) kb *= 1;
    initialKb += kb;
    count++;
  }
  const html = w.files.find((fl) => fl.path === '/var/www/html/index.html');
  const htmlKb = html ? html.sizeKb * (gzip ? 0.3 : 1) : 0;
  initialKb += htmlKb;
  const mix = normaliseMix(w);
  const mobile = clamp(w.traffic.mobileShare ?? 0.3, 0, 1);
  let total = 0;
  for (const [region, share] of mix) {
    const serverRegion = w.primaryRegion;
    const edgeRegions = cdn ? String(cdn.config.edges ?? serverRegion).split(',') : [];
    const assetRtt = cdn ? (edgeRegions.includes(region) ? rtt(region, region) : Math.min(...edgeRegions.map((e) => rtt(region, e as RegionId)))) : rtt(region, serverRegion);
    const docRtt = rtt(region, serverRegion);
    for (const [prof, pw] of [
      [DESKTOP, 1 - mobile],
      [MOBILE, mobile],
    ] as const) {
      const rounds = http2 ? 1 : Math.ceil(Math.max(1, count) / 6);
      const tlsRtts = w.tls.enabled ? (w.tls.version === '1.3' ? 1 : 2) : 0;
      const ttfb = docRtt * prof.rttMult * (2 + tlsRtts) + 5;
      const repeatShare = cacheHeaders ? 0.5 : 0;
      const kb = initialKb * (1 - repeatShare) + htmlKb * repeatShare;
      const transfer = ((kb * 8) / (prof.bandwidthMbps * 1000)) * 1000;
      const ms = ttfb + rounds * assetRtt * prof.rttMult + transfer;
      total += ms * share * pw;
    }
  }
  return { ms: Math.round(total), weightKb: Math.round(initialKb), missing };
}
