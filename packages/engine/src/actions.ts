/**
 * Player actions. Every change of the world goes through `reduce` (pure, immer-based)
 * and is recorded in the decision log. Invalid actions are rejected with an error event
 * and leave the state untouched.
 */
import { produce, type Draft } from 'immer';
import { componentDef, maybeComponent } from './catalog';
import { addMail, advanceTime, applyEffects, makeNode, type EngineEvent } from './effects';
import { combineSeed, createRng } from './rng';
import { canConnect } from './sim/graph';
import type {
  AlertRule,
  BugDef,
  ConfigValue,
  ContentBundle,
  DnsRecord,
  EvidenceToken,
  GameState,
  IndexDef,
  RegionId,
  Runbook,
  Size,
  SloConfig,
  TableDef,
  TlsState,
} from './types';
import { SIZES } from './types';
import { clockParts, weekday } from './util';

export type GameAction =
  | { type: 'company.setName'; name: string }
  | { type: 'app.open'; app: string }
  | { type: 'mail.read'; id: string }
  | { type: 'node.add'; nodeType: string; pos?: { x: number; y: number }; region?: RegionId; name?: string }
  | { type: 'node.remove'; id: string }
  | { type: 'node.move'; id: string; pos: { x: number; y: number }; region?: RegionId }
  | { type: 'node.rename'; id: string; name: string }
  | { type: 'node.config'; id: string; key: string; value: ConfigValue }
  | { type: 'node.resize'; id: string; size: Size }
  | { type: 'node.power'; id: string; offline: boolean }
  | { type: 'node.restart'; id: string }
  | { type: 'node.port'; id: string; port: number; open: boolean }
  | { type: 'node.listen'; id: string; port: number; listen: boolean }
  | { type: 'edge.connect'; from: string; to: string }
  | { type: 'edge.disconnect'; from: string; to: string }
  | { type: 'app.set'; key: string; value: ConfigValue }
  | { type: 'cache.rule'; endpoint: string; enabled: boolean; ttl: number }
  | { type: 'db.createIndex'; table: string; columns: string[]; unique?: boolean }
  | { type: 'db.dropIndex'; table: string; name: string }
  | { type: 'db.createTable'; table: TableDef }
  | { type: 'db.setColumn'; table: string; column: string; unique?: boolean; pk?: boolean; nullable?: boolean }
  | { type: 'dns.setDomain'; domain: string }
  | { type: 'dns.setRecord'; record: DnsRecord }
  | { type: 'dns.deleteRecord'; id: string }
  | { type: 'dns.configure'; geoRouting?: boolean; failover?: boolean }
  | { type: 'tls.issue'; issuer: 'letsencrypt' | 'self-signed' }
  | { type: 'tls.configure'; patch: Partial<Pick<TlsState, 'autoRenew' | 'redirectHttp' | 'hsts' | 'version' | 'sessionResumption'>> }
  | { type: 'tls.renew' }
  | { type: 'files.rename'; path: string; newPath: string }
  | { type: 'files.publish'; path: string }
  | { type: 'files.delete'; path: string }
  | { type: 'files.optimize'; path: string }
  | { type: 'files.lazy'; path: string; lazy: boolean }
  | { type: 'git.init' }
  | { type: 'git.branch'; name: string }
  | { type: 'git.checkout'; name: string }
  | { type: 'git.commit'; message: string }
  | { type: 'git.merge'; from: string; into: string }
  | { type: 'git.resolve'; resolution: 'ours' | 'theirs' | 'combined' }
  | { type: 'git.protect'; requirePr?: boolean; requireChecks?: boolean; requireReview?: boolean }
  | { type: 'git.prMerge'; id: number }
  | { type: 'git.prClose'; id: number }
  | { type: 'git.revert'; commitId: string }
  | { type: 'git.rewriteHistory' }
  | { type: 'git.ignore'; entry: string }
  | { type: 'ci.enable'; enabled: boolean }
  | { type: 'ci.stage'; stage: keyof GameState['world']['ci']['stages']; enabled: boolean }
  | { type: 'ci.addTest'; id: string; covers: string; label: { en: string; ru: string } }
  | { type: 'deploy.run'; strategy: 'all' | 'canary'; percent?: number }
  | { type: 'deploy.promote' }
  | { type: 'deploy.rollback' }
  | { type: 'deploy.discard' }
  | { type: 'flag.set'; id: string; enabled: boolean; rollout: number }
  | { type: 'security.setRole'; employee: string; role: string }
  | { type: 'security.rotateSecret'; id: string }
  | { type: 'security.upgradeDep'; name: string }
  | { type: 'alerts.upsert'; rule: AlertRule }
  | { type: 'alerts.delete'; id: string }
  | { type: 'runbook.save'; runbook: Runbook }
  | { type: 'runbook.delete'; id: string }
  | { type: 'slo.set'; slo: SloConfig }
  | { type: 'incident.declare'; id: string; severity: 'SEV1' | 'SEV2' | 'SEV3' }
  | { type: 'incident.order'; id: string; order: string[] }
  | { type: 'incident.utc'; id: string; utc: boolean }
  | { type: 'incident.resolve'; id: string }
  | { type: 'postmortem.answer'; incidentId: string; key: string; value: string | string[] }
  | { type: 'postmortem.submit'; incidentId: string }
  | { type: 'region.add'; region: RegionId }
  | { type: 'mission.pin'; token: EvidenceToken }
  | { type: 'mission.unpin'; index: number }
  | { type: 'time.wait'; minutes: number };

export interface ReduceResult {
  state: GameState;
  events: EngineEvent[];
  ok: boolean;
}

/** Actions that only touch presentation/meta state: they don't make the last simulation stale. */
const NON_WORLD = new Set(['app.open', 'mail.read', 'node.move', 'node.rename', 'mission.pin', 'mission.unpin', 'incident.utc']);

/** False for presentation/meta actions: they leave the simulated world (and the last simulation) unchanged. */
export function isWorldAction(action: GameAction): boolean {
  // moving a node to another region changes latency and failure domains
  if (action.type === 'node.move' && action.region) return true;
  return !NON_WORLD.has(action.type);
}

const reject = (state: GameState, key: string, params?: Record<string, string | number>): ReduceResult => ({
  state,
  events: [{ type: 'error', key, params }],
  ok: false,
});

export function reduce(state: GameState, action: GameAction, content: ContentBundle): ReduceResult {
  const pre = validate(state, action, content);
  if (pre) return reject(state, pre.key, pre.params);
  const events: EngineEvent[] = [];
  const next = produce(state, (d) => {
    apply(d, action, content, events);
    if (isWorldAction(action)) {
      d.seq += 1;
      if (d.campaign.active) d.campaign.active.actions += 1;
      d.decisionLog.push({ seq: d.seq, at: d.clock, missionId: d.campaign.currentMissionId, action: action.type, summary: summarize(action) });
      if (d.decisionLog.length > 2000) d.decisionLog.splice(0, d.decisionLog.length - 2000);
    }
  });
  if (events.some((e) => e.type === 'error')) return { state, events, ok: false };
  return { state: next, events, ok: true };
}

function summarize(a: GameAction): string {
  const { type, ...rest } = a as GameAction & Record<string, unknown>;
  const parts = Object.entries(rest)
    .filter(([, v]) => typeof v !== 'object')
    .map(([k, v]) => `${k}=${String(v)}`);
  return `${type}${parts.length ? ' ' + parts.join(' ') : ''}`;
}

/* ------------------------------------------------------------------ */
/* validation (no mutation)                                            */
/* ------------------------------------------------------------------ */

function validate(state: GameState, a: GameAction, content: ContentBundle): { key: string; params?: Record<string, string | number> } | null {
  const w = state.world;
  const node = (id: string) => w.nodes.find((n) => n.id === id);
  switch (a.type) {
    case 'company.setName': {
      const name = a.name.trim();
      if (name.length < 2 || name.length > 32) return { key: 'err.companyName' };
      return null;
    }
    case 'node.add': {
      const def = maybeComponent(content, a.nodeType);
      if (!def) return { key: 'err.unknownComponent' };
      if (!state.unlocks.components.includes(a.nodeType)) return { key: 'err.locked' };
      if (def.maxCount !== undefined && w.nodes.filter((n) => n.type === a.nodeType).length >= def.maxCount) return { key: 'err.maxCount', params: { max: def.maxCount } };
      if (a.region && !w.regions.includes(a.region)) return { key: 'err.regionInactive' };
      return null;
    }
    case 'node.remove': {
      const n = node(a.id);
      if (!n) return { key: 'err.noNode' };
      if (n.locked) return { key: 'err.nodeLocked' };
      return null;
    }
    case 'node.config': {
      const n = node(a.id);
      if (!n) return { key: 'err.noNode' };
      const def = componentDef(content, n.type);
      const field = def.config.find((c) => c.key === a.key);
      if (!field) return { key: 'err.unknownSetting' };
      if (field.feature && !state.unlocks.features.includes(field.feature)) return { key: 'err.locked' };
      if (field.type === 'enum' && !field.options?.includes(a.value as string | number)) return { key: 'err.badValue' };
      if (field.type === 'number' && (typeof a.value !== 'number' || (field.min !== undefined && a.value < field.min) || (field.max !== undefined && a.value > field.max))) return { key: 'err.badValue' };
      if (field.type === 'bool' && typeof a.value !== 'boolean') return { key: 'err.badValue' };
      return null;
    }
    case 'node.resize': {
      const n = node(a.id);
      if (!n) return { key: 'err.noNode' };
      if (!componentDef(content, n.type).scalable) return { key: 'err.notScalable' };
      if (!SIZES.includes(a.size)) return { key: 'err.badValue' };
      return null;
    }
    case 'node.port':
    case 'node.listen':
    case 'node.power':
    case 'node.restart':
    case 'node.move':
    case 'node.rename':
      return node(a.id) ? null : { key: 'err.noNode' };
    case 'edge.connect': {
      const r = canConnect(content, w, a.from, a.to);
      return r.ok ? null : { key: `err.${r.reason}`, params: r.params };
    }
    case 'app.set': {
      const def = content.settings.find((s) => s.key === a.key);
      if (!def) return { key: 'err.unknownSetting' };
      if (!state.unlocks.settings.includes(a.key)) return { key: 'err.locked' };
      if (def.type === 'enum' && !def.options?.some((o) => o.value === a.value)) return { key: 'err.badValue' };
      if (def.type === 'bool' && typeof a.value !== 'boolean') return { key: 'err.badValue' };
      if (def.type === 'number' && (typeof a.value !== 'number' || (def.min !== undefined && a.value < def.min) || (def.max !== undefined && a.value > def.max))) return { key: 'err.badValue' };
      return null;
    }
    case 'cache.rule': {
      const ep = w.endpoints.find((e) => e.id === a.endpoint);
      if (!ep || !ep.cache) return { key: 'err.notCacheable' };
      if (a.ttl < 1 || a.ttl > 86400 * 7) return { key: 'err.badValue' };
      return null;
    }
    case 'db.createIndex': {
      const t = w.tables.find((x) => x.name === a.table);
      if (!t) return { key: 'err.noTable' };
      if (!a.columns.length || a.columns.some((c) => !t.columns.some((col) => col.name === c))) return { key: 'err.noColumn' };
      if (t.indexes.some((i) => i.columns.join(',') === a.columns.join(','))) return { key: 'err.indexExists' };
      return null;
    }
    case 'db.createTable':
      if (w.tables.some((t) => t.name === a.table.name)) return { key: 'err.tableExists' };
      if (!/^[a-z_][a-z0-9_]*$/.test(a.table.name)) return { key: 'err.badName' };
      return null;
    case 'dns.setDomain':
      if (!/^[a-z0-9-]{2,40}\.[a-z]{2,10}$/.test(a.domain)) return { key: 'err.badDomain' };
      if (!state.unlocks.features.includes('domains')) return { key: 'err.locked' };
      return null;
    case 'dns.setRecord':
      if (!w.dns.domain) return { key: 'err.noDomain' };
      if (a.record.ttl < 30 || a.record.ttl > 604800) return { key: 'err.badTtl' };
      if (a.record.type === 'A' && !/^\d{1,3}(\.\d{1,3}){3}$/.test(a.record.value)) return { key: 'err.badIp' };
      if (a.record.type === 'CNAME' && a.record.name === '@') return { key: 'err.cnameApex' };
      return null;
    case 'tls.issue':
      if (!w.dns.domain && a.issuer === 'letsencrypt') return { key: 'err.tlsNeedsDomain' };
      if (a.issuer === 'letsencrypt' && !w.dns.records.some((r) => r.name === '@')) return { key: 'err.tlsNeedsDns' };
      return null;
    case 'files.rename':
      if (!w.files.some((f) => f.path === a.path)) return { key: 'err.noFile' };
      if (w.files.some((f) => f.path === a.newPath)) return { key: 'err.fileExists' };
      return null;
    case 'files.publish':
    case 'files.delete':
    case 'files.optimize':
    case 'files.lazy':
      return w.files.some((f) => f.path === a.path) ? null : { key: 'err.noFile' };
    case 'git.branch':
      if (!w.git.initialized) return { key: 'err.gitInit' };
      if (!/^[a-z0-9/_-]{1,40}$/.test(a.name)) return { key: 'err.badName' };
      if (w.git.branches[a.name]) return { key: 'err.branchExists' };
      return null;
    case 'git.commit':
    case 'git.checkout':
      if (!w.git.initialized) return { key: 'err.gitInit' };
      if (a.type === 'git.commit' && w.git.current === 'main' && w.git.protection.requirePr) return { key: 'err.mainProtected' };
      return null;
    case 'git.merge':
      if (!w.git.initialized) return { key: 'err.gitInit' };
      if (!w.git.branches[a.from] || !w.git.branches[a.into]) return { key: 'err.noBranch' };
      if (a.into === 'main' && w.git.protection.requirePr) return { key: 'err.mainProtected' };
      return null;
    case 'git.resolve':
      return w.git.conflict ? null : { key: 'err.noConflict' };
    case 'git.prMerge': {
      const pr = w.git.prs.find((p) => p.id === a.id);
      if (!pr || pr.status !== 'open') return { key: 'err.noPr' };
      if (w.git.protection.requireChecks && pr.checks === 'failed') return { key: 'err.checksFailed' };
      if (w.git.protection.requireChecks && pr.checks === 'none' && w.ci.enabled) return { key: 'err.checksFailed' };
      return null;
    }
    case 'deploy.run': {
      if (!state.unlocks.features.includes('release_pipeline')) return { key: 'err.locked' };
      if (w.deploy.canary) return { key: 'err.canaryActive' };
      const nothing = !Object.keys(w.deploy.pending).length && !w.deploy.pendingFixes.length && !w.deploy.pendingBugs.length;
      if (nothing) return { key: 'err.nothingToDeploy' };
      return null;
    }
    case 'deploy.promote':
      return w.deploy.canary ? null : { key: 'err.noCanary' };
    case 'deploy.rollback':
      return w.deploy.releases.length > 1 || w.deploy.canary ? null : { key: 'err.noRollback' };
    case 'flag.set':
      if (!w.deploy.flags.some((f) => f.id === a.id)) return { key: 'err.noFlag' };
      if (a.rollout < 0 || a.rollout > 100) return { key: 'err.badValue' };
      return null;
    case 'security.setRole':
      if (!w.security.employees.some((e) => e.id === a.employee)) return { key: 'err.noEmployee' };
      if (!w.security.roles.some((r) => r.id === a.role)) return { key: 'err.noRole' };
      return null;
    case 'security.rotateSecret':
      return w.security.secrets.some((s) => s.id === a.id) ? null : { key: 'err.noSecret' };
    case 'security.upgradeDep':
      return w.security.deps.some((d) => d.name === a.name) ? null : { key: 'err.noDep' };
    case 'alerts.upsert':
      if (!Number.isFinite(a.rule.threshold) || a.rule.forMinutes < 1) return { key: 'err.badValue' };
      return null;
    case 'region.add':
      if (!state.unlocks.features.includes('regions')) return { key: 'err.locked' };
      if (w.regions.includes(a.region)) return { key: 'err.regionExists' };
      return null;
    case 'time.wait':
      if (a.minutes <= 0 || a.minutes > 60 * 24 * 14) return { key: 'err.badValue' };
      return null;
    case 'incident.declare':
    case 'incident.order':
    case 'incident.resolve':
      return w.observability.incidents.some((i) => i.id === a.id) ? null : { key: 'err.noIncident' };
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* mutation                                                            */
/* ------------------------------------------------------------------ */

function apply(d: Draft<GameState>, a: GameAction, content: ContentBundle, events: EngineEvent[]) {
  const w = d.world;
  const node = (id: string) => w.nodes.find((n) => n.id === id)!;
  switch (a.type) {
    case 'company.setName':
      d.company.name = a.name.trim();
      break;
    case 'app.open':
      if (!d.openedApps.includes(a.app)) d.openedApps.push(a.app);
      break;
    case 'mail.read': {
      const m = d.mail.find((x) => x.id === a.id);
      if (m) m.read = true;
      break;
    }
    case 'node.add': {
      const n = makeNode(content, w, { type: a.nodeType, pos: a.pos, region: a.region, name: a.name }, d.clock);
      w.nodes.push(n);
      events.push({ type: 'sound', key: 'drop' });
      break;
    }
    case 'node.remove':
      w.nodes = w.nodes.filter((n) => n.id !== a.id);
      w.edges = w.edges.filter((e) => e.from !== a.id && e.to !== a.id);
      break;
    case 'node.move': {
      const n = node(a.id);
      n.pos = { x: Math.round(a.pos.x), y: Math.round(a.pos.y) };
      if (a.region && w.regions.includes(a.region) && !componentDef(content, n.type).external) n.region = a.region;
      break;
    }
    case 'node.rename':
      node(a.id).name = a.name.slice(0, 24) || node(a.id).name;
      break;
    case 'node.config': {
      const n = node(a.id);
      const old = n.config[a.key];
      n.config[a.key] = a.value;
      if ((a.key === 'listenPort' || a.key === 'port') && typeof a.value === 'number') {
        n.ports = [...new Set([...n.ports.filter((p) => p !== old), a.value])];
      }
      if (a.key === 'publicAccess') {
        const port = Number(n.ports[0] ?? 3306);
        n.publicPorts = a.value === true ? [...new Set([...n.publicPorts, port])] : n.publicPorts.filter((p) => p !== port);
      }
      break;
    }
    case 'node.resize':
      node(a.id).size = a.size;
      break;
    case 'node.power':
      node(a.id).offline = a.offline || undefined;
      break;
    case 'node.restart': {
      const n = node(a.id);
      for (const inc of w.incidents) {
        if (inc.active && inc.kind === 'memoryLeak' && (inc.target === n.id || inc.target === n.type)) {
          // a restart frees the leaked memory — for now
          inc.params = { ...(inc.params ?? {}), startPct: 35 };
        }
      }
      events.push({ type: 'toast', key: 'toast.restarted', params: { node: n.name } });
      break;
    }
    case 'node.port': {
      const n = node(a.id);
      n.publicPorts = a.open ? [...new Set([...n.publicPorts, a.port])] : n.publicPorts.filter((p) => p !== a.port);
      if (n.config.publicAccess !== undefined && [3306, 5432].includes(a.port)) n.config.publicAccess = a.open;
      break;
    }
    case 'node.listen': {
      const n = node(a.id);
      n.ports = a.listen ? [...new Set([...n.ports, a.port])] : n.ports.filter((p) => p !== a.port);
      break;
    }
    case 'edge.connect': {
      w.edges.push({ id: `${a.from}>${a.to}`, from: a.from, to: a.to });
      const from = node(a.from);
      const to = node(a.to);
      const fromRole = componentDef(content, from.type).role;
      const toRole = componentDef(content, to.type).role;
      // exposing a server to the internet opens its port in the firewall
      if (fromRole === 'client') {
        const port = toRole === 'backend' ? Number(to.config.port ?? 8000) : w.tls.enabled ? 443 : Number(w.site.port ?? 80);
        if (!to.publicPorts.includes(port)) {
          to.publicPorts.push(port);
          events.push({ type: 'toast', key: 'toast.portOpened', params: { node: to.name, port } });
        }
      }
      events.push({ type: 'sound', key: 'connect' });
      break;
    }
    case 'edge.disconnect':
      w.edges = w.edges.filter((e) => !(e.from === a.from && e.to === a.to));
      break;
    case 'app.set': {
      const def = content.settings.find((s) => s.key === a.key)!;
      if (def.code && w.deploy.requireDeploy) {
        if (w.app[a.key] === a.value) delete w.deploy.pending[a.key];
        else w.deploy.pending[a.key] = a.value;
        events.push({ type: 'toast', key: 'toast.pendingDeploy' });
      } else {
        w.app[a.key] = a.value;
      }
      break;
    }
    case 'cache.rule': {
      const r = w.cacheRules.find((x) => x.endpoint === a.endpoint);
      if (r) {
        r.enabled = a.enabled;
        r.ttl = a.ttl;
      } else w.cacheRules.push({ endpoint: a.endpoint, enabled: a.enabled, ttl: a.ttl });
      break;
    }
    case 'db.createIndex': {
      const t = w.tables.find((x) => x.name === a.table)!;
      const idx: IndexDef = { name: `idx_${a.table}_${a.columns.join('_')}`, columns: [...a.columns], unique: a.unique };
      t.indexes.push(idx);
      break;
    }
    case 'db.dropIndex': {
      const t = w.tables.find((x) => x.name === a.table);
      if (t) t.indexes = t.indexes.filter((i) => i.name !== a.name);
      break;
    }
    case 'db.createTable':
      w.tables.push(JSON.parse(JSON.stringify(a.table)));
      break;
    case 'db.setColumn': {
      const t = w.tables.find((x) => x.name === a.table);
      const c = t?.columns.find((x) => x.name === a.column);
      if (c) {
        if (a.unique !== undefined) c.unique = a.unique;
        if (a.pk !== undefined) c.pk = a.pk;
        if (a.nullable !== undefined) c.nullable = a.nullable;
      }
      break;
    }
    case 'dns.setDomain':
      w.dns.domain = a.domain;
      d.company.domain = a.domain;
      d.budget.cash -= 12;
      d.budget.ledger.push({ at: d.clock, amount: -12, key: 'domain' });
      break;
    case 'dns.setRecord': {
      const idx = w.dns.records.findIndex((r) => r.id === a.record.id);
      const prev = idx >= 0 ? w.dns.records[idx] : w.dns.records.find((r) => r.name === a.record.name && r.type === a.record.type);
      if (prev && prev.value !== a.record.value) {
        w.dns.changes.push({ name: prev.name, type: prev.type, oldValue: prev.value, oldTtl: prev.ttl, at: d.clock });
        if (w.dns.changes.length > 20) w.dns.changes.splice(0, w.dns.changes.length - 20);
      }
      const rec = { ...a.record };
      if (prev) {
        rec.id = prev.id;
        const i = w.dns.records.findIndex((r) => r.id === prev.id);
        w.dns.records[i] = rec;
      } else {
        w.dns.records.push(rec);
      }
      break;
    }
    case 'dns.deleteRecord':
      w.dns.records = w.dns.records.filter((r) => r.id !== a.id);
      break;
    case 'dns.configure':
      if (a.geoRouting !== undefined) w.dns.geoRouting = a.geoRouting;
      if (a.failover !== undefined) w.dns.failover = a.failover;
      break;
    case 'tls.issue': {
      w.tls.enabled = true;
      w.tls.issuer = a.issuer;
      w.tls.expiresAt = d.clock + 90 * 1440;
      for (const n of w.nodes) {
        const role = maybeComponent(content, n.type)?.role;
        if ((role === 'proxy' || role === 'lb') && w.edges.some((e) => e.to === n.id)) {
          if (!n.ports.includes(443)) n.ports.push(443);
          if (!n.publicPorts.includes(443)) n.publicPorts.push(443);
        }
      }
      events.push({ type: 'toast', key: 'toast.tlsIssued' });
      break;
    }
    case 'tls.configure':
      Object.assign(w.tls, a.patch);
      break;
    case 'tls.renew':
      if (w.tls.enabled) w.tls.expiresAt = d.clock + 90 * 1440;
      for (const inc of w.incidents) if (inc.kind === 'certExpired') inc.active = false;
      break;
    case 'files.rename': {
      const f = w.files.find((x) => x.path === a.path)!;
      f.path = a.newPath;
      break;
    }
    case 'files.publish': {
      const f = w.files.find((x) => x.path === a.path)!;
      const name = f.path.split('/').pop()!;
      const target = `/var/www/html/${name}`;
      const existing = w.files.findIndex((x) => x.path === target);
      const copy = { ...JSON.parse(JSON.stringify(f)), path: target };
      if (existing >= 0) w.files[existing] = copy;
      else w.files.push(copy);
      break;
    }
    case 'files.delete':
      w.files = w.files.filter((x) => x.path !== a.path);
      break;
    case 'files.optimize': {
      const f = w.files.find((x) => x.path === a.path)!;
      if (f.kind === 'image' && !f.optimized) {
        f.optimized = true;
        f.sizeKb = Math.max(20, Math.round(f.sizeKb * 0.12));
        if (f.path.endsWith('.png') || f.path.endsWith('.jpg')) {
          // keep the URL stable: the server negotiates WebP via Accept, file name unchanged
        }
      }
      if ((f.kind === 'css' || f.kind === 'js') && !f.optimized) {
        f.optimized = true;
        f.sizeKb = Math.max(1, Math.round(f.sizeKb * 0.6));
      }
      break;
    }
    case 'files.lazy': {
      const f = w.files.find((x) => x.path === a.path)!;
      f.lazy = a.lazy;
      break;
    }
    case 'git.init':
      if (!w.git.initialized) {
        w.git.initialized = true;
        const c = { id: shortHash(d, 'init'), message: 'Initial commit', branch: 'main', parents: [], author: 'you', at: d.clock, files: ['index.html', 'app/'] };
        w.git.commits.push(c);
        w.git.branches.main = c.id;
        w.git.current = 'main';
      }
      break;
    case 'git.branch':
      w.git.branches[a.name] = w.git.branches[w.git.current];
      w.git.current = a.name;
      break;
    case 'git.checkout':
      if (w.git.branches[a.name]) w.git.current = a.name;
      break;
    case 'git.commit': {
      const branch = w.git.current;
      const c = { id: shortHash(d, a.message), message: a.message.slice(0, 72) || 'update', branch, parents: [w.git.branches[branch]].filter(Boolean), author: 'you', at: d.clock, files: Object.keys(w.deploy.pending).length ? Object.keys(w.deploy.pending) : ['app/'] };
      w.git.commits.push(c);
      w.git.branches[branch] = c.id;
      break;
    }
    case 'git.merge': {
      const conflict = w.git.conflict;
      if (conflict && conflict.from === a.from && conflict.into === a.into && !conflict.resolution) {
        events.push({ type: 'toast', key: 'toast.mergeConflict', params: { file: conflict.file } });
        break;
      }
      mergeCommit(d, a.from, a.into, `Merge branch '${a.from}' into ${a.into}`);
      break;
    }
    case 'git.resolve': {
      const c = w.git.conflict!;
      c.resolution = a.resolution;
      mergeCommit(d, c.from, c.into, `Merge branch '${c.from}' (resolved: ${a.resolution})`);
      if (a.resolution !== c.correct && c.wrongBug) {
        const tmpl = w.bugs.find((b) => b.id === c.wrongBug);
        if (tmpl) tmpl.fixed = false;
      }
      w.git.conflict = null;
      break;
    }
    case 'git.protect':
      if (a.requirePr !== undefined) w.git.protection.requirePr = a.requirePr;
      if (a.requireChecks !== undefined) w.git.protection.requireChecks = a.requireChecks;
      if (a.requireReview !== undefined) w.git.protection.requireReview = a.requireReview;
      break;
    case 'git.prMerge': {
      const pr = w.git.prs.find((p) => p.id === a.id)!;
      pr.status = 'merged';
      mergeCommit(d, pr.from, pr.to, `Merge pull request #${pr.id}: ${pr.title}`);
      for (const b of pr.bugs ?? []) {
        if (w.deploy.requireDeploy) {
          if (!w.deploy.pendingBugs.includes(b)) w.deploy.pendingBugs.push(b);
        } else {
          const bug = w.bugs.find((x) => x.id === b);
          if (bug) bug.fixed = false;
        }
      }
      break;
    }
    case 'git.prClose': {
      const pr = w.git.prs.find((p) => p.id === a.id);
      if (pr) pr.status = 'closed';
      break;
    }
    case 'git.revert': {
      const c = w.git.commits.find((x) => x.id === a.commitId);
      if (!c) break;
      const rev = { id: shortHash(d, `revert ${c.id}`), message: `Revert "${c.message}"`, branch: 'main', parents: [w.git.branches.main].filter(Boolean), author: 'you', at: d.clock, files: c.files, fixes: c.bugs ?? [] };
      w.git.commits.push(rev);
      w.git.branches.main = rev.id;
      for (const b of c.bugs ?? []) {
        if (w.deploy.requireDeploy && w.ci.enabled) {
          if (!w.deploy.pendingFixes.includes(b)) w.deploy.pendingFixes.push(b);
        } else {
          const bug = w.bugs.find((x) => x.id === b);
          if (bug) bug.fixed = true;
        }
      }
      break;
    }
    case 'git.rewriteHistory':
      w.git.historyRewritten = true;
      for (const c of w.git.commits) c.secret = false;
      for (const s of w.security.secrets) s.inGitHistory = false;
      events.push({ type: 'toast', key: 'toast.historyRewritten' });
      break;
    case 'git.ignore':
      if (!w.git.gitignore.includes(a.entry)) w.git.gitignore.push(a.entry);
      break;
    case 'ci.enable':
      w.ci.enabled = a.enabled;
      recomputePrChecks(d);
      break;
    case 'ci.stage':
      w.ci.stages[a.stage] = a.enabled;
      recomputePrChecks(d);
      break;
    case 'ci.addTest':
      if (!w.ci.tests.some((t) => t.id === a.id)) w.ci.tests.push({ id: a.id, covers: a.covers, label: a.label });
      recomputePrChecks(d);
      break;
    case 'deploy.run':
      runDeploy(d, a.strategy, a.percent ?? 10, events);
      break;
    case 'deploy.promote': {
      const c = w.deploy.canary!;
      w.deploy.version = c.version;
      w.deploy.canary = null;
      for (const r of w.deploy.releases) if (r.status === 'live') r.status = 'superseded';
      const rel = w.deploy.releases.find((r) => r.version === c.version);
      if (rel) rel.status = 'live';
      events.push({ type: 'deploy', key: 'deploy.promoted', params: { version: c.version } });
      break;
    }
    case 'deploy.rollback':
      rollback(d, events);
      break;
    case 'deploy.discard':
      w.deploy.pending = {};
      w.deploy.pendingFixes = [];
      break;
    case 'flag.set': {
      const f = w.deploy.flags.find((x) => x.id === a.id)!;
      f.enabled = a.enabled;
      f.rollout = Math.round(a.rollout);
      break;
    }
    case 'security.setRole': {
      const e = w.security.employees.find((x) => x.id === a.employee)!;
      e.role = a.role;
      break;
    }
    case 'security.rotateSecret': {
      const s = w.security.secrets.find((x) => x.id === a.id)!;
      s.rotatedAt = d.clock;
      s.leaked = false;
      events.push({ type: 'toast', key: 'toast.secretRotated', params: { name: s.name } });
      break;
    }
    case 'security.upgradeDep': {
      const dep = w.security.deps.find((x) => x.name === a.name)!;
      dep.version = dep.latest;
      // an upgrade is a code change: ship it through the pipeline when one exists
      if (w.deploy.requireDeploy) w.deploy.pending[`dep:${dep.name}`] = dep.latest;
      break;
    }
    case 'alerts.upsert': {
      const idx = w.observability.alertRules.findIndex((r) => r.id === a.rule.id);
      if (idx >= 0) w.observability.alertRules[idx] = { ...a.rule };
      else w.observability.alertRules.push({ ...a.rule });
      break;
    }
    case 'alerts.delete':
      w.observability.alertRules = w.observability.alertRules.filter((r) => r.id !== a.id);
      break;
    case 'runbook.save': {
      const idx = w.observability.runbooks.findIndex((r) => r.id === a.runbook.id);
      if (idx >= 0) w.observability.runbooks[idx] = JSON.parse(JSON.stringify(a.runbook));
      else w.observability.runbooks.push(JSON.parse(JSON.stringify(a.runbook)));
      break;
    }
    case 'runbook.delete':
      w.observability.runbooks = w.observability.runbooks.filter((r) => r.id !== a.id);
      break;
    case 'slo.set':
      w.observability.slo = { ...a.slo };
      break;
    case 'incident.declare': {
      const inc = w.observability.incidents.find((i) => i.id === a.id)!;
      inc.severity = a.severity;
      if (inc.declaredAt === null) inc.declaredAt = d.clock;
      break;
    }
    case 'incident.order': {
      const inc = w.observability.incidents.find((i) => i.id === a.id)!;
      inc.order = a.order.filter((id) => inc.events.some((e) => e.id === id));
      break;
    }
    case 'incident.utc': {
      const inc = w.observability.incidents.find((i) => i.id === a.id);
      if (inc) inc.utcView = a.utc;
      break;
    }
    case 'incident.resolve': {
      const inc = w.observability.incidents.find((i) => i.id === a.id)!;
      inc.status = 'resolved';
      break;
    }
    case 'postmortem.answer': {
      let pm = w.observability.postmortems.find((p) => p.incidentId === a.incidentId);
      if (!pm) {
        pm = { incidentId: a.incidentId, answers: {}, submitted: false };
        w.observability.postmortems.push(pm);
      }
      pm.answers[a.key] = Array.isArray(a.value) ? [...a.value] : a.value;
      break;
    }
    case 'postmortem.submit': {
      let pm = w.observability.postmortems.find((p) => p.incidentId === a.incidentId);
      if (!pm) {
        pm = { incidentId: a.incidentId, answers: {}, submitted: false };
        w.observability.postmortems.push(pm);
      }
      pm.submitted = true;
      break;
    }
    case 'region.add':
      w.regions.push(a.region);
      break;
    case 'mission.pin': {
      const act = d.campaign.active;
      if (!act) break;
      if (act.pinned.some((p) => p.app === a.token.app && p.kind === a.token.kind && p.key === a.token.key)) break;
      act.pinned.push({ ...a.token });
      matchEvidence(d, content, events);
      break;
    }
    case 'mission.unpin': {
      const act = d.campaign.active;
      if (act) act.pinned.splice(a.index, 1);
      break;
    }
    case 'time.wait':
      advanceTime(d, a.minutes);
      break;
  }
}

function shortHash(d: Draft<GameState>, salt: string): string {
  return createRng(combineSeed(d.seed, d.world.git.commits.length, salt)).hex(7);
}

function mergeCommit(d: Draft<GameState>, from: string, into: string, message: string) {
  const w = d.world;
  const c = { id: shortHash(d, message), message, branch: into, parents: [w.git.branches[into], w.git.branches[from]].filter(Boolean), author: 'you', at: d.clock, files: [] as string[] };
  w.git.commits.push(c);
  w.git.branches[into] = c.id;
}

/** CI decides PR checks: a covering test (or an enabled stage that covers the bug class) fails the PR. */
export function recomputePrChecks(d: Draft<GameState> | GameState) {
  const w = d.world;
  for (const pr of w.git.prs) {
    if (pr.status !== 'open') continue;
    if (!w.ci.enabled) {
      pr.checks = 'none';
      pr.failing = [];
      continue;
    }
    const failing: string[] = [];
    for (const bugId of pr.bugs ?? []) {
      const bug = w.bugs.find((b) => b.id === bugId);
      const covers = bug?.caughtBy;
      if (!covers) continue;
      const stageHit = (covers === 'unit' && w.ci.stages.unit) || (covers === 'integration' && w.ci.stages.integration) || (covers === 'contract' && w.ci.stages.contract) || (covers === 'lint' && w.ci.stages.lint) || (covers === 'secretScan' && w.ci.stages.secretScan);
      const testHit = w.ci.tests.some((t) => t.covers === covers || t.covers === bugId) && (w.ci.stages.unit || w.ci.stages.integration);
      if (stageHit || testHit) failing.push(bugId);
    }
    pr.checks = failing.length ? 'failed' : 'passed';
    pr.failing = failing;
  }
}

/** Regression probability of a deploy: technical debt and missing tests make it riskier. */
export function deployRisk(state: GameState | Draft<GameState>): number {
  const w = state.world;
  const changes = Object.keys(w.deploy.pending).length + w.deploy.pendingFixes.length + w.deploy.pendingBugs.length;
  let risk = 0.03 + state.debt / 250 + changes * 0.01;
  if (!w.ci.enabled || !w.ci.stages.unit) risk += 0.12;
  if (w.ci.enabled && w.ci.stages.unit) risk *= 0.5;
  if (w.ci.enabled && w.ci.stages.integration) risk *= 0.6;
  const friday = weekday(state.clock) === 4 && clockParts(state.clock).hh >= 15;
  if (friday) risk += 0.05; // tired humans, fewer people around
  return Math.min(0.6, Math.max(0.01, risk));
}

function runDeploy(d: Draft<GameState>, strategy: 'all' | 'canary', percent: number, events: EngineEvent[]) {
  const w = d.world;
  const v = w.deploy.version + 1;
  // CI gate
  if (w.ci.enabled) {
    const failing: string[] = [];
    for (const bugId of w.deploy.pendingBugs) {
      const bug = w.bugs.find((b) => b.id === bugId);
      if (!bug?.caughtBy) continue;
      const covered = w.ci.tests.some((t) => t.covers === bug.caughtBy || t.covers === bugId) || (bug.caughtBy === 'integration' && w.ci.stages.integration) || (bug.caughtBy === 'contract' && w.ci.stages.contract);
      if (covered && (w.ci.stages.unit || w.ci.stages.integration || w.ci.stages.contract)) failing.push(bugId);
    }
    const run = { id: w.ci.runs.length + 1, ref: `v${v}`, status: failing.length ? ('failed' as const) : ('passed' as const), failedStage: failing.length ? 'tests' : undefined, reason: failing.join(',') || undefined, at: d.clock };
    w.ci.runs.push(run);
    if (failing.length) {
      events.push({ type: 'deploy', key: 'deploy.blockedByCi', params: { bugs: failing.join(', ') } });
      // caught bugs never reach production: drop them from the release train
      w.deploy.pendingBugs = w.deploy.pendingBugs.filter((b) => !failing.includes(b));
      return;
    }
  }
  const risk = deployRisk(d);
  const roll = createRng(combineSeed(d.seed, 'deploy', w.deploy.deployCount, d.clock)).next();
  const regression = roll < risk;
  const bugs: string[] = [...w.deploy.pendingBugs];
  if (regression) {
    const candidates = w.endpoints.filter((e) => !e.disabled && e.target === 'backend');
    const ep = candidates.length ? candidates[Math.floor(roll * 1000) % candidates.length] : undefined;
    const bug: BugDef = {
      id: `regression-v${v}`,
      title: { en: `Regression in release v${v}`, ru: `Регрессия в релизе v${v}` },
      endpoint: ep?.id,
      errorRate: 0.12,
      logCode: 'REGRESSION',
      logMessage: `TypeError in ${ep?.handler ?? 'handler'}: undefined is not a function (release v${v})`,
      version: v,
      caughtBy: 'integration',
    };
    w.bugs.push(bug);
    bugs.push(bug.id);
  }
  for (const b of w.deploy.pendingBugs) {
    const bug = w.bugs.find((x) => x.id === b);
    if (bug) {
      bug.fixed = false;
      bug.version = v;
    }
  }
  // apply code changes
  for (const [k, val] of Object.entries(w.deploy.pending)) {
    if (k.startsWith('dep:')) continue;
    w.app[k] = val;
  }
  for (const b of w.deploy.pendingFixes) {
    const bug = w.bugs.find((x) => x.id === b);
    if (bug) bug.fixed = true;
  }
  const release = {
    version: v,
    at: d.clock,
    app: JSON.parse(JSON.stringify(w.app)),
    fixes: [...w.deploy.pendingFixes],
    bugs,
    status: strategy === 'canary' ? ('canary' as const) : ('live' as const),
    migration: 'additive' as const,
  };
  if (strategy === 'all') {
    for (const r of w.deploy.releases) if (r.status === 'live') r.status = 'superseded';
    w.deploy.version = v;
  } else {
    w.deploy.canary = { version: v, percent: Math.max(1, Math.min(50, Math.round(percent))) };
  }
  w.deploy.releases.push(release);
  w.deploy.pending = {};
  w.deploy.pendingFixes = [];
  w.deploy.pendingBugs = [];
  w.deploy.deployCount += 1;
  d.stats.deploys += 1;
  if (weekday(d.clock) === 4 && clockParts(d.clock).hh >= 15) d.stats.fridayDeploys += 1;
  if (w.git.initialized) {
    const c = { id: shortHash(d, `deploy ${v}`), message: `Release v${v}`, branch: 'main', parents: [w.git.branches.main].filter(Boolean), author: 'ci', at: d.clock, files: [] as string[] };
    w.git.commits.push(c);
    w.git.branches.main = c.id;
  }
  d.timeline.push({ at: d.clock, kind: 'deploy', key: strategy === 'canary' ? 'timeline.canary' : 'timeline.deploy', params: { version: v } });
  events.push({ type: 'deploy', key: strategy === 'canary' ? 'deploy.canaryStarted' : 'deploy.done', params: { version: v } });
  void addMail;
}

function rollback(d: Draft<GameState>, events: EngineEvent[]) {
  const w = d.world;
  if (w.deploy.canary) {
    const v = w.deploy.canary.version;
    const rel = w.deploy.releases.find((r) => r.version === v);
    if (rel) {
      rel.status = 'rolled-back';
      for (const b of rel.bugs) {
        const bug = w.bugs.find((x) => x.id === b);
        if (bug) bug.fixed = true;
      }
      // config of a canary was shared — restore the stable release config
      const stable = w.deploy.releases.filter((r) => r.version === w.deploy.version).pop();
      if (stable) restoreReleaseApp(w, stable);
      for (const f of rel.fixes) {
        const bug = w.bugs.find((x) => x.id === f);
        if (bug) bug.fixed = false;
      }
    }
    w.deploy.canary = null;
  } else {
    const current = w.deploy.releases.find((r) => r.version === w.deploy.version);
    const previous = w.deploy.releases.filter((r) => r.version < w.deploy.version && r.status !== 'rolled-back').pop();
    if (!current || !previous) return;
    current.status = 'rolled-back';
    for (const b of current.bugs) {
      const bug = w.bugs.find((x) => x.id === b);
      if (bug) bug.fixed = true;
    }
    // fixes shipped in the rolled-back release are reverted too
    for (const f of current.fixes) {
      const bug = w.bugs.find((x) => x.id === f);
      if (bug) bug.fixed = false;
    }
    restoreReleaseApp(w, previous);
    previous.status = 'live';
    w.deploy.version = previous.version;
  }
  d.stats.rollbacks += 1;
  d.timeline.push({ at: d.clock, kind: 'deploy', key: 'timeline.rollback', params: { version: w.deploy.version } });
  events.push({ type: 'deploy', key: 'deploy.rolledBack', params: { version: w.deploy.version } });
}

/**
 * Restore the app settings a release shipped with. A snapshot only covers the settings it
 * recorded: releases created by deploy.run hold the full config, older/seeded releases may
 * hold none — those must not wipe the live configuration.
 */
function restoreReleaseApp(w: Draft<GameState>['world'], release: { app: Record<string, ConfigValue> }) {
  w.app = { ...w.app, ...JSON.parse(JSON.stringify(release.app)) };
}

/** Match pinned evidence tokens against the active mission's evidence definitions. */
export function matchEvidence(d: Draft<GameState>, content: ContentBundle, events: EngineEvent[]) {
  const act = d.campaign.active;
  if (!act) return;
  const mission = content.missions[act.id];
  if (!mission?.evidence) return;
  for (const ev of mission.evidence) {
    if (act.evidence.includes(ev.id)) continue;
    const hit = act.pinned.some((p) => {
      if (ev.match.app && ev.match.app !== p.app) return false;
      if (ev.match.kind !== p.kind) return false;
      if (ev.match.key !== undefined) {
        const keys = Array.isArray(ev.match.key) ? ev.match.key : [ev.match.key];
        if (!keys.includes(p.key)) return false;
      }
      if (ev.match.keyPrefix && !p.key.startsWith(ev.match.keyPrefix)) return false;
      return true;
    });
    if (hit) {
      act.evidence.push(ev.id);
      events.push({ type: 'toast', key: 'toast.evidence', params: { id: ev.id } });
      events.push({ type: 'sound', key: 'evidence' });
    }
  }
}

export { applyEffects };
