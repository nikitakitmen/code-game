/**
 * Presentation layer of a simulation run: request traces (Request Inspector / Trace Viewer),
 * structured logs (Logs app, Terminal `tail`), alerts (Monitoring). Generated from the
 * numeric results with seeded randomness, so they always agree with the metrics.
 */
import { maybeComponent } from '../catalog';
import { createRng, type Rng } from '../rng';
import type { ArchNode, ContentBundle, EndpointDef, GameState, RegionId } from '../types';
import { clamp, round } from '../util';
import type { ErrorCode, FiredAlert, LogLine, RequestTrace, SimResult, StageTrace } from './types';
import { ERROR_STATUS } from './types';

const ERROR_LOG: Record<ErrorCode, { level: LogLine['level']; source: 'proxy' | 'backend' | 'database' | 'cache' | 'worker' | 'client' | 'kernel'; msg: string }> = {
  CONNECTION_REFUSED: { level: 'ERROR', source: 'client', msg: 'connect() failed (111: Connection refused)' },
  CONNECTION_TIMEOUT: { level: 'ERROR', source: 'client', msg: 'connect() timed out (110: Connection timed out)' },
  DNS_NXDOMAIN: { level: 'ERROR', source: 'client', msg: 'getaddrinfo ENOTFOUND (NXDOMAIN)' },
  DNS_MISMATCH: { level: 'ERROR', source: 'client', msg: 'resolved to a host that does not serve this site' },
  TLS_EXPIRED: { level: 'ERROR', source: 'client', msg: 'SSL certificate problem: certificate has expired' },
  MIXED_CONTENT: { level: 'ERROR', source: 'client', msg: 'Mixed Content: page loaded over HTTPS requested an insecure resource http://…' },
  CORS_BLOCKED: { level: 'ERROR', source: 'client', msg: "blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present" },
  NOT_FOUND: { level: 'WARN', source: 'proxy', msg: 'open() failed (2: No such file or directory)' },
  METHOD_NOT_ALLOWED: { level: 'WARN', source: 'proxy', msg: '405 Not Allowed' },
  NO_ROUTE: { level: 'ERROR', source: 'proxy', msg: 'no route to an upstream for this location' },
  UPSTREAM_DOWN: { level: 'ERROR', source: 'proxy', msg: 'no live upstreams while connecting to upstream' },
  OVERLOAD: { level: 'ERROR', source: 'proxy', msg: 'upstream server temporarily disabled: 503 Service Unavailable (all workers busy)' },
  GATEWAY_TIMEOUT: { level: 'ERROR', source: 'proxy', msg: 'upstream timed out (110: Connection timed out) while reading response header from upstream' },
  DB_TOO_MANY_CONNECTIONS: { level: 'ERROR', source: 'backend', msg: 'SQLSTATE[HY000] [1040] Too many connections' },
  DB_POOL_TIMEOUT: { level: 'ERROR', source: 'backend', msg: 'Timeout waiting for a free connection in the DB pool' },
  DB_DOWN: { level: 'ERROR', source: 'backend', msg: 'SQLSTATE[HY000] [2002] Connection refused (database)' },
  DB_DEADLOCK: { level: 'ERROR', source: 'backend', msg: 'SQLSTATE[40001]: Deadlock found when trying to get lock; try restarting transaction' },
  DB_LOCK_TIMEOUT: { level: 'ERROR', source: 'backend', msg: 'SQLSTATE[HY000]: Lock wait timeout exceeded' },
  CACHE_OOM: { level: 'ERROR', source: 'backend', msg: "Redis: OOM command not allowed when used memory > 'maxmemory'" },
  CACHE_DOWN: { level: 'ERROR', source: 'backend', msg: 'Redis: Connection refused [tcp://redis:6379]' },
  PROVIDER_TIMEOUT: { level: 'ERROR', source: 'backend', msg: 'cURL error 28: Operation timed out (external provider)' },
  PROVIDER_ERROR: { level: 'ERROR', source: 'backend', msg: 'External provider responded 502 Bad Gateway' },
  CIRCUIT_OPEN: { level: 'WARN', source: 'backend', msg: 'Circuit breaker OPEN: failing fast without calling the provider' },
  SERVICE_UNAVAILABLE: { level: 'ERROR', source: 'backend', msg: 'Internal service call failed: connection refused' },
  SESSION_LOST: { level: 'WARN', source: 'backend', msg: 'Session not found for cookie — user redirected to /login' },
  RATE_LIMITED: { level: 'WARN', source: 'proxy', msg: 'limiting requests, excess: 5.120 by zone "login"' },
  REGION_DOWN: { level: 'FATAL', source: 'client', msg: 'region unreachable' },
  OOM_KILLED: { level: 'FATAL', source: 'kernel', msg: 'Out of memory: Killed process (php-fpm)' },
  STORAGE_MISSING: { level: 'WARN', source: 'backend', msg: 'File not found on this server: storage/uploads/…' },
  DISK_FULL: { level: 'ERROR', source: 'backend', msg: 'fwrite(): write failed: No space left on device' },
  FILE_CORRUPTED: { level: 'ERROR', source: 'backend', msg: 'JSON parse error in products.json: Unexpected end of input' },
  NO_BACKEND: { level: 'ERROR', source: 'client', msg: 'nothing handles this URL' },
  NO_DATABASE: { level: 'ERROR', source: 'backend', msg: 'No database connection configured' },
  BUG: { level: 'ERROR', source: 'backend', msg: 'Unhandled exception' },
};

const SCANNER_PATHS = ['/wp-login.php', '/.env', '/phpmyadmin/', '/.git/config', '/admin.php', '/backup.sql', '/server-status'];

function fakeIp(rng: Rng): string {
  return `${rng.pick(['185.220', '45.95', '91.240', '103.27', '198.51'])}.${rng.int(1, 254)}.${rng.int(1, 254)}`;
}

function roleOf(content: ContentBundle, n: ArchNode | undefined) {
  return n ? maybeComponent(content, n.type)?.role : undefined;
}

export function buildPresentation(state: GameState, content: ContentBundle, sim: SimResult): Pick<SimResult, 'traces' | 'logs' | 'alerts'> {
  const rng = createRng(sim.seed ^ 0x5eed);
  const traces = buildTraces(state, content, sim, rng);
  const logs = buildLogs(state, content, sim, rng, traces);
  const alerts = evaluateAlerts(state, sim);
  return { traces, logs, alerts };
}

/* ------------------------------------------------------------------ */
/* traces                                                              */
/* ------------------------------------------------------------------ */

function newRequestId(rng: Rng): string {
  return `${rng.hex(8)}-${rng.hex(4)}-${rng.hex(4)}`;
}

export function buildTraces(state: GameState, content: ContentBundle, sim: SimResult, rng: Rng): RequestTrace[] {
  const w = state.world;
  const out: RequestTrace[] = [];
  const reqIds = w.app.requestIds === true;
  const eps = w.endpoints.filter((e) => !e.disabled && sim.endpoints[e.id]);
  for (const ep of eps) {
    const s = sim.endpoints[ep.id];
    if (!s) continue;
    const samples: { kind: RequestTrace['sample']; ms: number; err: ErrorCode | null }[] = [];
    if (s.served) {
      samples.push({ kind: 'typical', ms: s.p50, err: null });
      if (s.p95 > s.p50 * 1.3) samples.push({ kind: 'slow', ms: s.p95, err: null });
    }
    const topErr = Object.entries(s.errors).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0];
    if (topErr && (topErr[1] ?? 0) > 0.005) samples.push({ kind: 'error', ms: s.p95, err: topErr[0] as ErrorCode });
    for (const smp of samples) out.push(makeTrace(state, content, sim, ep, smp.kind, smp.ms, smp.err, rng, reqIds));
    // static asset requests of a page
    for (const a of ep.assets ?? []) {
      const file = w.files.find((f) => f.path === `/var/www/html/${a}`);
      out.push(assetTrace(state, ep, a, file?.sizeKb ?? 0, !file, rng));
    }
  }
  return out;
}

function assetTrace(state: GameState, ep: EndpointDef, asset: string, sizeKb: number, missing: boolean, rng: Rng): RequestTrace {
  const id = `${ep.id}:${asset}`;
  const total = missing ? 25 : round(25 + (sizeKb * 8) / 25, 1);
  return {
    id,
    requestId: null,
    traceId: rng.hex(16),
    endpointId: ep.id,
    method: 'GET',
    path: `/${asset}`,
    region: state.world.primaryRegion,
    status: missing ? 404 : 200,
    errorCode: missing ? 'NOT_FOUND' : null,
    totalMs: total,
    tick: 0,
    sample: 'asset',
    request: { headers: { Host: state.company.domain ?? state.world.site.ip, Accept: '*/*', Referer: ep.path } },
    response: {
      headers: missing
        ? { 'Content-Type': 'text/html' }
        : { 'Content-Type': contentType(asset), 'Content-Length': String(Math.round(sizeKb * 1024)) },
      sizeKb: missing ? 0.5 : sizeKb,
    },
    stages: [
      { id: 'net', nodeId: null, nodeType: 'network', layer: 'network', label: 'TCP/HTTP', startMs: 0, durationMs: 20, status: 'ok', details: {} },
      {
        id: 'static',
        nodeId: null,
        nodeType: 'proxy',
        layer: 'infrastructure',
        label: missing ? `open("/var/www/html/${asset}") → ENOENT` : `sendfile /var/www/html/${asset}`,
        startMs: 20,
        durationMs: round(total - 20, 1),
        status: missing ? 'error' : 'ok',
        details: { size: `${round(sizeKb, 1)} KB`, status: missing ? 404 : 200 },
      },
    ],
  };
}

function contentType(path: string): string {
  if (path.endsWith('.css')) return 'text/css';
  if (path.endsWith('.js')) return 'application/javascript';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  return 'text/html; charset=utf-8';
}

function makeTrace(
  state: GameState,
  content: ContentBundle,
  sim: SimResult,
  ep: EndpointDef,
  kind: RequestTrace['sample'],
  targetMs: number,
  err: ErrorCode | null,
  rng: Rng,
  withReqId: boolean,
): RequestTrace {
  const w = state.world;
  const s = sim.endpoints[ep.id];
  const byId = new Map(w.nodes.map((n) => [n.id, n] as const));
  const stages: StageTrace[] = [];
  const region: RegionId = (Object.entries(w.traffic.regionMix).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] as RegionId) ?? 'eu';
  const requestId = withReqId ? newRequestId(rng) : null;
  const push = (st: Omit<StageTrace, 'startMs'>) => stages.push({ ...st, startMs: 0 });

  if (w.dns.domain) push({ id: 'dns', nodeId: null, nodeType: 'dns', layer: 'network', label: `DNS ${w.dns.domain} → A`, durationMs: 3, status: err === 'DNS_NXDOMAIN' ? 'error' : 'ok', details: { cache: 'resolver' } });
  push({ id: 'tcp', nodeId: null, nodeType: 'network', layer: 'network', label: 'TCP handshake', durationMs: 20, status: err === 'CONNECTION_REFUSED' || err === 'CONNECTION_TIMEOUT' ? 'error' : 'ok', details: {} });
  if (w.tls.enabled) push({ id: 'tls', nodeId: null, nodeType: 'network', layer: 'network', label: `TLS ${w.tls.version} handshake`, durationMs: w.tls.version === '1.3' ? 20 : 40, status: err === 'TLS_EXPIRED' ? 'error' : 'ok', details: { cipher: 'TLS_AES_128_GCM_SHA256' } });

  const browserSide: ErrorCode[] = ['CONNECTION_REFUSED', 'CONNECTION_TIMEOUT', 'DNS_NXDOMAIN', 'DNS_MISMATCH', 'TLS_EXPIRED', 'MIXED_CONTENT', 'CORS_BLOCKED', 'REGION_DOWN'];
  const stopsAtBrowser = err && browserSide.includes(err);

  if (!stopsAtBrowser) {
    for (const id of s.path) {
      const n = byId.get(id);
      if (!n) continue;
      const role = roleOf(content, n);
      const ns = sim.nodes[id];
      if (role === 'cdn') {
        const hit = ep.target === 'static' ? rng.chance(0.95) : false;
        push({ id: `n:${id}`, nodeId: id, nodeType: n.type, layer: 'infrastructure', label: `${n.name}: cache ${hit ? 'HIT' : 'MISS'}`, durationMs: 2, status: 'ok', details: { cache: hit ? 'HIT' : 'MISS' } });
        if (hit) break;
      } else if (role === 'waf') {
        push({ id: `n:${id}`, nodeId: id, nodeType: n.type, layer: 'infrastructure', label: `${n.name}: inspect (${String(n.config.mode ?? 'off')})`, durationMs: 2, status: 'ok', details: { rules: String(n.config.mode ?? 'off') } });
      } else if (role === 'lb') {
        push({ id: `n:${id}`, nodeId: id, nodeType: n.type, layer: 'infrastructure', label: `${n.name}: pick upstream (${String(n.config.algorithm ?? 'round_robin')})`, durationMs: 1, status: 'ok', details: {} });
      } else if (role === 'proxy') {
        const isTerm = ep.target === 'static';
        push({
          id: `n:${id}`,
          nodeId: id,
          nodeType: n.type,
          layer: 'infrastructure',
          label: isTerm ? `${n.name}: serve ${ep.path === '/' ? '/index.html' : ep.path}` : `${n.name}: proxy_pass → upstream`,
          durationMs: Math.max(0.5, ns?.latencyMs ?? 1),
          status: err === 'OVERLOAD' || err === 'UPSTREAM_DOWN' || err === 'GATEWAY_TIMEOUT' ? 'error' : 'ok',
          details: { gzip: n.config.gzip === true, http2: n.config.http2 === true },
        });
      } else if (role === 'backend') {
        appStages(state, content, sim, ep, n, push, err, rng, kind === 'slow');
      } else if (role === 'storage') {
        push({ id: `n:${id}`, nodeId: id, nodeType: n.type, layer: 'infrastructure', label: `${n.name}: GET object`, durationMs: 15, status: 'ok', details: {} });
      }
    }
  }

  // scale durations so the trace adds up to the sampled latency
  let total = stages.reduce((a, st) => a + st.durationMs, 0);
  const respKb = ep.responseKb;
  push({ id: 'resp', nodeId: null, nodeType: 'network', layer: 'network', label: 'Response transfer', durationMs: round(Math.max(1, (respKb * 8) / 25), 1), status: 'ok', details: { size: `${respKb} KB` } });
  total = stages.reduce((a, st) => a + st.durationMs, 0);
  const desired = Math.max(total, targetMs);
  if (total > 0 && desired > total) {
    // put the missing time where it really goes: the slowest stage (queueing/saturation)
    const slowest = stages.slice().sort((a, b) => b.durationMs - a.durationMs)[0];
    slowest.durationMs += desired - total;
    if (kind === 'slow') slowest.status = slowest.status === 'error' ? 'error' : 'warn';
  }
  let t = 0;
  for (const st of stages) {
    st.startMs = round(t, 1);
    st.durationMs = round(st.durationMs, 1);
    t += st.durationMs;
  }
  const status = err ? ERROR_STATUS[err] : ep.method === 'POST' && ep.writes ? 201 : 200;
  const host = state.company.domain ?? w.site.ip;
  const reqHeaders: Record<string, string> = {
    Host: host,
    'User-Agent': 'Mozilla/5.0',
    Accept: ep.api ? 'application/json' : 'text/html',
  };
  if (ep.auth !== 'none') {
    const mode = String(w.app.authMode ?? 'none');
    if (mode === 'session') reqHeaders.Cookie = 'session=…';
    if (mode === 'jwt') reqHeaders.Authorization = 'Bearer eyJhbGciOi…';
    if (mode === 'plain-cookie') reqHeaders.Cookie = 'user_id=42';
  }
  if (requestId) reqHeaders['X-Request-ID'] = requestId;
  const resHeaders: Record<string, string> = { 'Content-Type': ep.api ? 'application/json' : 'text/html; charset=utf-8' };
  if (w.tls.hsts && w.tls.enabled) resHeaders['Strict-Transport-Security'] = 'max-age=31536000';
  if (w.app.csp === true) resHeaders['Content-Security-Policy'] = "default-src 'self'";
  if (ep.id === 'login' && String(w.app.authMode) === 'session') {
    resHeaders['Set-Cookie'] = `session=…; Path=/${w.app.cookieHttpOnly === true ? '; HttpOnly' : ''}${w.tls.enabled ? '; Secure' : ''}${String(w.app.csrfProtection) === 'samesite' ? '; SameSite=Lax' : ''}`;
  }
  if (requestId) resHeaders['X-Request-ID'] = requestId;
  const cacheStage = stages.find((x) => x.details.cache === 'HIT' || x.details.cache === 'MISS');
  if (cacheStage) resHeaders['X-Cache'] = String(cacheStage.details.cache);
  return {
    id: `${ep.id}:${kind}`,
    requestId,
    traceId: rng.hex(16),
    endpointId: ep.id,
    method: ep.method,
    path: ep.path,
    region,
    status,
    errorCode: err,
    totalMs: round(t, 1),
    stages,
    tick: rng.int(0, 59),
    sample: kind,
    request: { headers: reqHeaders },
    response: { headers: resHeaders, sizeKb: respKb, body: ep.example !== undefined ? JSON.stringify(ep.example, null, 2) : undefined },
  };
}

function appStages(
  state: GameState,
  content: ContentBundle,
  sim: SimResult,
  ep: EndpointDef,
  backend: ArchNode,
  push: (st: Omit<StageTrace, 'startMs'>) => void,
  err: ErrorCode | null,
  rng: Rng,
  slow: boolean,
) {
  const w = state.world;
  const ns = sim.nodes[backend.id];
  const util = ns?.util ?? 0;
  const handler = ep.handler ?? `${ep.id}Controller@handle`;
  const q = util < 0.97 ? 1 / (1 - Math.min(util, 0.96)) : 30;
  push({ id: `n:${backend.id}`, nodeId: backend.id, nodeType: backend.type, layer: 'application', label: `${backend.name}: ${ep.method} ${ep.path} → ${handler}`, durationMs: Math.max(0.5, ep.cpuMs * 0.4 * q), status: err === 'OVERLOAD' ? 'error' : 'ok', details: { cpu: `${round(util * 100)}%` } });
  if (ep.auth !== 'none') {
    const mode = String(w.app.authMode ?? 'none');
    push({ id: 'auth', nodeId: backend.id, nodeType: 'auth', layer: 'application', label: `Auth: ${mode}${ep.auth === 'admin' ? ' + role check' : ''}`, durationMs: mode === 'session' && String(w.app.sessionStore) === 'redis' ? 1 : 0.3, status: err === 'SESSION_LOST' ? 'error' : 'ok', details: { mode } });
  }
  if (ep.id === 'login' || ep.id === 'register') {
    const ps = String(w.app.passwordStorage ?? 'plaintext');
    push({ id: 'pwd', nodeId: backend.id, nodeType: 'auth', layer: 'application', label: `Password: ${ps}`, durationMs: ps === 'bcrypt' ? 60 : ps === 'argon2id' ? 80 : 0.01, status: 'ok', details: { algorithm: ps } });
  }
  const s = sim.endpoints[ep.id];
  const cacheRule = w.cacheRules.find((r) => r.endpoint === ep.id && r.enabled);
  let hit = false;
  if (cacheRule && s.cacheHitRate !== null) {
    hit = !slow && rng.chance(s.cacheHitRate);
    push({ id: 'cache', nodeId: null, nodeType: 'redis', layer: 'data', label: `Redis GET ${ep.id}:{key} → ${hit ? 'HIT' : 'MISS'}`, durationMs: 0.5, status: err === 'CACHE_DOWN' || err === 'CACHE_OOM' ? 'error' : 'ok', details: { cache: hit ? 'HIT' : 'MISS', ttl: cacheRule.ttl } });
  }
  for (const ex of s.explain) {
    const qd = ep.queries.find((x) => x.id === ex.queryId);
    if (!qd) continue;
    const isRead = qd.op === 'select' && !qd.lockRows && !ep.writes;
    if (hit && isRead) continue;
    const per = qd.perRequest ?? 1;
    const dbNode = w.nodes.find((n) => roleOf(content, n) === 'database');
    const dbUtil = dbNode ? sim.nodes[dbNode.id]?.util ?? 0 : 0;
    const qf = dbUtil < 0.97 ? 1 / (1 - Math.min(dbUtil, 0.96)) : 30;
    push({
      id: `q:${ex.queryId}`,
      nodeId: dbNode?.id ?? null,
      nodeType: 'mysql',
      layer: 'data',
      label: per > 1 ? `${ex.sql} ×${per}` : ex.sql,
      durationMs: Math.max(0.2, ex.costMs * qf * per),
      status: err === 'DB_TOO_MANY_CONNECTIONS' || err === 'DB_POOL_TIMEOUT' || err === 'DB_DOWN' || err === 'DB_DEADLOCK' ? 'error' : ex.costMs > 50 ? 'warn' : 'ok',
      details: { rowsScanned: ex.rows, type: ex.type, key: ex.key ?? 'NULL' },
    });
  }
  for (const job of ep.jobs ?? []) {
    const asyncOn = w.app[job.asyncSetting] === true;
    push({
      id: `job:${job.id}`,
      nodeId: null,
      nodeType: asyncOn ? 'queue' : 'job',
      layer: 'application',
      label: asyncOn ? `Queue::push(${job.id})` : `${job.id} (synchronous)`,
      durationMs: asyncOn ? 2 : job.cpuMs + (job.ioMs ?? 0) + (job.external ? 300 : 0),
      status: 'ok',
      details: { async: asyncOn },
    });
  }
  for (const ext of ep.external ?? []) {
    const retries = Number(w.app.retries ?? 0);
    push({
      id: `ext:${ext.provider}`,
      nodeId: null,
      nodeType: ext.provider,
      layer: 'application',
      label: `HTTPS → ${ext.provider} API`,
      durationMs: ext.latencyMs ?? 300,
      status: err === 'PROVIDER_TIMEOUT' || err === 'PROVIDER_ERROR' || err === 'CIRCUIT_OPEN' ? 'error' : 'ok',
      details: { retries: err ? retries : 0, timeoutMs: Number(w.app.providerTimeoutMs ?? 30000) },
    });
  }
  for (const svc of ep.calls ?? []) {
    push({ id: `svc:${svc}`, nodeId: null, nodeType: 'service', layer: 'application', label: `HTTP → ${svc}-service`, durationMs: 8, status: err === 'SERVICE_UNAVAILABLE' ? 'error' : 'ok', details: { service: svc } });
  }
  for (const b of w.bugs.filter((x) => (x.endpoint === ep.id || !x.endpoint) && !x.fixed && (x.extraLatencyMs ?? 0) > 0)) {
    push({ id: `bug:${b.id}`, nodeId: backend.id, nodeType: 'code', layer: 'application', label: b.logMessage, durationMs: b.extraLatencyMs ?? 0, status: 'warn', details: {} });
  }
  if (err === 'BUG') {
    const bug = w.bugs.find((b) => (b.endpoint === ep.id || !b.endpoint) && !b.fixed && b.errorRate);
    push({ id: 'exception', nodeId: backend.id, nodeType: 'code', layer: 'application', label: bug?.logMessage ?? 'Unhandled exception', durationMs: 0.5, status: 'error', details: { code: bug?.logCode ?? 'BUG' } });
  }
  push({ id: 'render', nodeId: backend.id, nodeType: 'code', layer: 'application', label: ep.api ? 'Serialize JSON' : 'Render template', durationMs: Math.max(0.3, ep.cpuMs * 0.3 * q), status: 'ok', details: {} });
}

/* ------------------------------------------------------------------ */
/* logs                                                                */
/* ------------------------------------------------------------------ */

export function buildLogs(state: GameState, content: ContentBundle, sim: SimResult, rng: Rng, traces: RequestTrace[]): LogLine[] {
  const w = state.world;
  const lines: LogLine[] = [];
  const scale = Math.max(1, w.timeScale || 1);
  const reqIds = w.app.requestIds === true;
  const utc = String(w.app.timezone ?? 'server-local') === 'utc';
  const nodesBy = (role: string) => w.nodes.filter((n) => roleOf(content, n) === role);
  const proxy = nodesBy('proxy')[0] ?? nodesBy('lb')[0];
  const backends = nodesBy('backend');
  const db = nodesBy('database')[0];
  const workers = nodesBy('worker');
  const tzOf = (n: ArchNode | undefined) => (utc || !n ? 0 : Number(n.config.tz ?? 0));
  let seq = 0;
  const add = (l: Omit<LogLine, 'id'>) => {
    lines.push({ ...l, id: `L${++seq}` });
  };
  const minuteAt = (tick: number) => state.clock + tick * scale + rng.next() * scale;

  // access log sample
  for (const ep of w.endpoints.filter((e) => !e.disabled)) {
    const s = sim.endpoints[ep.id];
    if (!s || !s.served || s.rps <= 0) continue;
    const n = Math.min(4, 1 + Math.floor(Math.log10(1 + s.rps * 10)));
    for (let i = 0; i < n; i++) {
      const tick = rng.int(0, sim.ticks.length - 1);
      const src = ep.target === 'static' ? proxy : proxy ?? backends[0];
      add({
        t: minuteAt(tick),
        tz: tzOf(src),
        level: 'INFO',
        source: src?.name ?? 'web',
        sourceType: src?.type ?? 'proxy',
        code: 'ACCESS',
        message: `${ep.method} ${ep.path} ${s.status} ${Math.round(s.p50)}ms`,
        requestId: reqIds ? newRequestId(rng) : undefined,
        endpoint: ep.id,
        status: s.status,
        ms: Math.round(s.p50),
        ip: `${rng.int(5, 220)}.${rng.int(0, 255)}.${rng.int(0, 255)}.${rng.int(1, 254)}`,
      });
    }
    for (const a of s.missingAssets) {
      add({ t: minuteAt(rng.int(0, 59)), tz: tzOf(proxy), level: 'ERROR', source: proxy?.name ?? 'nginx', sourceType: 'proxy', code: 'NOT_FOUND', message: `open() "/var/www/html/${a}" failed (2: No such file or directory), request: "GET /${a}"`, endpoint: ep.id, status: 404 });
    }
  }

  // error lines: correlated across proxy → backend (→ worker) when request IDs exist
  for (const ep of w.endpoints) {
    const s = sim.endpoints[ep.id];
    if (!s) continue;
    for (const [code, rate] of Object.entries(s.errors)) {
      if (!rate || rate < 0.001) continue;
      const info = ERROR_LOG[code as ErrorCode];
      if (!info || info.source === 'client') continue;
      const count = clamp(Math.round(2 + rate * 12 + Math.log10(1 + s.rps * rate * 60) * 2), 2, 14);
      const errTicks = sim.ticks.filter((tk) => tk.errorRate > 0.0005).map((tk) => tk.t);
      for (let i = 0; i < count; i++) {
        const tick = errTicks.length ? rng.pick(errTicks) : rng.int(0, 59);
        const t = minuteAt(tick);
        const rid = reqIds ? newRequestId(rng) : undefined;
        const be = backends.length ? backends[i % backends.length] : undefined;
        let msg = info.msg;
        if (code === 'BUG') {
          const bug = w.bugs.find((b) => (b.endpoint === ep.id || !b.endpoint) && !b.fixed && b.errorRate);
          msg = bug ? bug.logMessage : msg;
          add({ t, tz: tzOf(be), level: 'ERROR', source: be?.name ?? 'app', sourceType: be?.type ?? 'backend', code: bug?.logCode ?? 'BUG', message: `${msg} [${ep.method} ${ep.path}]`, requestId: rid, endpoint: ep.id, status: 500 });
        } else if (info.source === 'proxy' || info.source === 'kernel') {
          add({ t, tz: tzOf(proxy), level: info.level, source: proxy?.name ?? 'nginx', sourceType: proxy?.type ?? 'proxy', code, message: `${msg}, request: "${ep.method} ${ep.path}"`, requestId: rid, endpoint: ep.id, status: ERROR_STATUS[code as ErrorCode] });
        } else {
          add({ t, tz: tzOf(be), level: info.level, source: be?.name ?? 'app', sourceType: be?.type ?? 'backend', code, message: `${msg} [${ep.method} ${ep.path}]`, requestId: rid, endpoint: ep.id, status: ERROR_STATUS[code as ErrorCode] });
          if (proxy && ERROR_STATUS[code as ErrorCode] >= 500) {
            add({ t: t + 0.0005, tz: tzOf(proxy), level: 'WARN', source: proxy.name, sourceType: proxy.type, code: 'UPSTREAM_5XX', message: `"${ep.method} ${ep.path}" ${ERROR_STATUS[code as ErrorCode]} upstream: ${be?.name ?? 'app'}`, requestId: rid, endpoint: ep.id, status: ERROR_STATUS[code as ErrorCode] });
          }
        }
      }
    }
    // slow query log
    for (const ex of s.explain) {
      const qd = ep.queries.find((q) => q.id === ex.queryId);
      if (!qd || !db) continue;
      const dbUtil = sim.nodes[db.id]?.util ?? 0;
      const ms = ex.costMs * (dbUtil < 0.97 ? 1 / (1 - Math.min(dbUtil, 0.96)) : 30);
      if (ms < 100 || s.rps <= 0) continue;
      for (let i = 0; i < 3; i++) {
        add({ t: minuteAt(rng.int(0, 59)), tz: tzOf(db), level: 'WARN', source: db.name, sourceType: db.type, code: 'SLOW_QUERY', message: `# Query_time: ${(ms / 1000).toFixed(3)}  Rows_examined: ${ex.rows}  ${ex.sql}`, endpoint: ep.id, ms: Math.round(ms) });
      }
    }
  }

  // events (OOM, crashes …)
  for (const ev of sim.events) {
    if (ev.key === 'event.oom') {
      add({ t: state.clock + ev.tick * scale, tz: 0, level: 'FATAL', source: String(ev.params?.node ?? 'server'), sourceType: 'kernel', code: 'OOM_KILLED', message: `kernel: Out of memory: Killed process 2741 (php-fpm) total-vm:2097152kB` });
    }
  }

  // queue workers
  for (const q of Object.values(sim.queues)) {
    const wk = workers[0];
    if (q.failedPerHour > 0 || q.dlqPerHour > 0) {
      for (let i = 0; i < 4; i++) add({ t: minuteAt(rng.int(0, 59)), tz: tzOf(wk), level: 'ERROR', source: wk?.name ?? 'worker', sourceType: 'worker', code: 'JOB_FAILED', message: `Job failed after attempts: provider error (queue=${q.name})`, requestId: reqIds ? newRequestId(rng) : undefined });
    }
    if (q.retriesPerHour > 0) add({ t: minuteAt(rng.int(0, 59)), tz: tzOf(wk), level: 'WARN', source: wk?.name ?? 'worker', sourceType: 'worker', code: 'JOB_RETRY', message: `Retrying job (attempt 2) on queue ${q.name}` });
    if (q.duplicatesPerHour > 0.5) add({ t: minuteAt(rng.int(0, 59)), tz: tzOf(wk), level: 'WARN', source: wk?.name ?? 'worker', sourceType: 'worker', code: 'JOB_REDELIVERED', message: `Job exceeded visibility timeout and was delivered again (queue=${q.name})` });
    if (q.backlogEnd > 1000) add({ t: minuteAt(59), tz: tzOf(wk), level: 'WARN', source: 'queue', sourceType: 'queue', code: 'QUEUE_BACKLOG', message: `Queue ${q.name}: ${q.backlogEnd} jobs waiting, oldest ${Math.round(q.waitSec)}s` });
  }

  // anomalies that leave traces in logs
  const anomalyLogs: Record<string, string> = {
    duplicateFulfillments: 'Webhook payment.succeeded processed again for an already fulfilled order',
    doubleCharges: 'Second charge created for the same cart within 3s',
    oversold: 'Stock went negative for product SKU-DROP-1 (stock=-1)',
    deadlocks: 'Deadlock found when trying to get lock (orders ↔ users)',
    lostEvents: 'OrderCreated event not published: broker unavailable after commit',
    staleReads: 'Served cached value older than the latest update',
    crawlerDeletes: 'GET /api/v1/products/…/delete by Googlebot → product deleted',
    corruptedWrites: 'products.json rewritten by two requests at once',
    duplicateJobs: 'Job ran twice for the same order',
    unauthorizedAdminActions: 'PUT /admin/products by user role=customer → 200',
  };
  for (const [id, perHour] of Object.entries(sim.anomalies)) {
    const msg = anomalyLogs[id];
    if (!msg || perHour <= 0) continue;
    const be = backends[0];
    for (let i = 0; i < Math.min(5, 1 + Math.floor(Math.log10(1 + perHour))); i++) {
      add({ t: minuteAt(rng.int(0, 59)), tz: tzOf(be), level: 'WARN', source: be?.name ?? 'app', sourceType: 'backend', code: `ANOMALY_${id.toUpperCase()}`, message: msg, requestId: reqIds ? newRequestId(rng) : undefined });
    }
  }

  // hostile traffic
  for (const inc of w.incidents.filter((i) => i.active)) {
    if (inc.kind === 'scanner') {
      for (let i = 0; i < 6; i++) add({ t: minuteAt(rng.int(0, 59)), tz: tzOf(proxy), level: 'INFO', source: proxy?.name ?? 'nginx', sourceType: 'proxy', code: 'ACCESS', message: `GET ${rng.pick(SCANNER_PATHS)} 404 (User-Agent: masscan/1.3)`, ip: fakeIp(rng), status: 404 });
    }
    if (inc.kind === 'botnet') {
      const limited = (w.app.loginRateLimit === true) || w.nodes.some((n) => roleOf(content, n) === 'proxy' && Number(n.config.rateLimit ?? 0) > 0);
      for (let i = 0; i < 8; i++) add({ t: minuteAt(rng.int(0, 59)), tz: tzOf(proxy), level: limited ? 'WARN' : 'INFO', source: proxy?.name ?? 'nginx', sourceType: 'proxy', code: limited ? 'RATE_LIMITED' : 'ACCESS', message: limited ? 'limiting requests, excess: 12.400 by zone "login", request: "POST /login"' : 'POST /login 401 (user=admin@…)', ip: fakeIp(rng), status: limited ? 429 : 401 });
    }
  }

  // technical debt makes logs noisy (harder diagnosis)
  const noise = Math.round(state.debt / 8);
  const noiseMsgs = [
    'Deprecated: Function utf8_encode() is deprecated',
    'Undefined array key "discount" in OrderService.php:214',
    'Slow template render: product_card (debug=true)',
    'Retrying connection to legacy-sms (attempt 3)',
    'TODO(lev): remove after migration',
  ];
  for (let i = 0; i < noise; i++) {
    const be = backends[i % Math.max(1, backends.length)];
    add({ t: minuteAt(rng.int(0, 59)), tz: tzOf(be), level: 'WARN', source: be?.name ?? 'app', sourceType: 'backend', code: 'NOISE', message: rng.pick(noiseMsgs) });
  }

  // attach trace ids of error samples to one log line each (Trace Viewer ↔ Logs)
  for (const tr of traces.filter((x) => x.sample === 'error' && x.requestId)) {
    const match = lines.find((l) => l.endpoint === tr.endpointId && l.code !== 'ACCESS' && !l.traceId);
    if (match) {
      match.traceId = tr.traceId;
      match.requestId = tr.requestId ?? match.requestId;
    }
  }

  lines.sort((a, b) => a.t - b.t);
  return lines.slice(0, 400);
}

/* ------------------------------------------------------------------ */
/* alerts                                                              */
/* ------------------------------------------------------------------ */

export function alertMetricAt(state: GameState, sim: SimResult, metric: string, tick: number): number {
  const tk = sim.ticks[tick];
  const w = state.world;
  if (!tk) return 0;
  const backendIds = w.nodes.filter((n) => n.type === 'backend' || String(n.type).startsWith('backend')).map((n) => n.id);
  const dbIds = w.nodes.filter((n) => n.type === 'mysql').map((n) => n.id);
  switch (metric) {
    case 'errorRate':
      return tk.errorRate * 100;
    case 'p95':
      return tk.p95;
    case 'availability':
      return (1 - tk.errorRate) * 100;
    case 'cpu.backend':
      return Math.max(0, ...backendIds.map((id) => tk.nodes[id]?.cpu ?? 0));
    case 'cpu.database':
      return Math.max(0, ...dbIds.map((id) => tk.nodes[id]?.cpu ?? 0));
    case 'ram.backend':
      return Math.max(0, ...backendIds.map((id) => tk.nodes[id]?.ram ?? 0));
    case 'queue.backlog':
      return tk.queueBacklog;
    case 'db.connections':
      return sim.summary.maxConnections ? (tk.dbConnections / sim.summary.maxConnections) * 100 : 0;
    case 'disk':
      return Number(w.flags.diskUsedPct ?? 40);
    case 'slo.burn': {
      const slo = w.observability.slo;
      const budget = slo ? 1 - slo.availability : 0.001;
      return budget > 0 ? tk.errorRate / budget : 0;
    }
    case 'uptime':
      return tk.errorRate > 0.5 ? 0 : 1;
    default:
      return 0;
  }
}

export function evaluateAlerts(state: GameState, sim: SimResult): FiredAlert[] {
  const w = state.world;
  const scale = Math.max(1, w.timeScale || 1);
  const out: FiredAlert[] = [];
  const sloLatency = w.observability.slo?.latencyMs ?? 1500;
  const hurt = (tick: number) => {
    const tk = sim.ticks[tick];
    return !!tk && (tk.errorRate > 0.01 || tk.p95 > sloLatency);
  };
  for (const rule of w.observability.alertRules.filter((r) => r.enabled)) {
    const need = Math.max(1, Math.ceil(rule.forMinutes / scale));
    let run = 0;
    let start = -1;
    let peak = 0;
    const flush = (end: number) => {
      if (run >= need) {
        let actionable = false;
        for (let i = start; i <= end; i++) if (hurt(i)) actionable = true;
        out.push({ id: `${rule.id}@${start}`, ruleId: rule.id, metric: rule.metric, severity: rule.severity, startTick: start, endTick: end, peak: round(peak, 2), threshold: rule.threshold, actionable });
      }
      run = 0;
      start = -1;
      peak = 0;
    };
    for (let t = 0; t < sim.ticks.length; t++) {
      const v = alertMetricAt(state, sim, rule.metric, t);
      const firing = rule.op === '>' ? v > rule.threshold : v < rule.threshold;
      if (firing) {
        if (start < 0) start = t;
        run++;
        peak = rule.op === '>' ? Math.max(peak, v) : start === t ? v : Math.min(peak, v);
      } else if (start >= 0) {
        flush(t - 1);
      }
    }
    if (start >= 0) flush(sim.ticks.length - 1);
  }
  return out;
}
