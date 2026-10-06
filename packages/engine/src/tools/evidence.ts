/**
 * Evidence the investigation apps can show right now — exactly the tokens a player can pin
 * with "📌 Pin" in each app. The UI builds its pin buttons from these helpers and campaign
 * validation uses `pinsFor` to prove that every mission's evidence is reachable.
 * (API Inspector and Terminal pins come from callApi / runCommand responses.)
 */
import { maybeComponent } from '../catalog';
import { computeVulns } from '../security';
import { explainQuery } from '../sim/db';
import type { SimResult } from '../sim/types';
import type { ContentBundle, EvidenceToken, GameState } from '../types';

export const MONITORING_METRICS = ['rps', 'p95', 'errorRate', 'cpu.backend', 'cpu.database', 'queue.backlog', 'db.connections', 'cacheHit'] as const;

export const pin = {
  request: (app: 'inspector' | 'traces', endpointId: string): EvidenceToken => ({ app, kind: 'request', key: endpointId }),
  log: (code: string): EvidenceToken => ({ app: 'logs', kind: 'log', key: code }),
  explain: (table: string, type: string): EvidenceToken => ({ app: 'database', kind: 'explain', key: `${table}:${type}` }),
  column: (app: 'database' | 'security', table: string, column: string): EvidenceToken => ({ app, kind: 'schema', key: `${table}.${column}` }),
  metric: (app: 'monitoring' | 'network', key: string): EvidenceToken => ({ app, kind: 'metric', key }),
  alert: (metric: string): EvidenceToken => ({ app: 'monitoring', kind: 'alert', key: metric }),
  queue: (name: string): EvidenceToken => ({ app: 'queue', kind: 'queue', key: name }),
  releaseLog: (logCode: string): EvidenceToken => ({ app: 'cicd', kind: 'log', key: logCode }),
  vuln: (id: string): EvidenceToken => ({ app: 'security', kind: 'vuln', key: id }),
  tls: (status: string): EvidenceToken => ({ app: 'network', kind: 'tls', key: status }),
  dns: (name: string, type: string): EvidenceToken => ({ app: 'dns', kind: 'dns', key: `${name}:${type}` }),
  tableOwners: (table: string, services: string[]): EvidenceToken => ({ app: 'architecture', kind: 'schema', key: `${table}:${services.join('+')}` }),
};

/** Status of the site certificate as the Network app shows it. */
export function tlsStatus(state: GameState): 'none' | 'ok' | 'expiring' | 'expired' {
  const tls = state.world.tls;
  if (!tls.enabled || tls.expiresAt === null) return 'none';
  const days = Math.floor((tls.expiresAt - state.clock) / 1440);
  return days < 0 ? 'expired' : days < 14 ? 'expiring' : 'ok';
}

/** Services whose endpoints read or write each table (shared tables = coupled services). */
export function tableOwners(state: GameState): Record<string, string[]> {
  const out: Record<string, Set<string>> = {};
  for (const ep of state.world.endpoints) {
    if (ep.disabled) continue;
    for (const q of ep.queries) (out[q.table] ??= new Set()).add(ep.service ?? 'monolith');
  }
  return Object.fromEntries(Object.entries(out).map(([t, s]) => [t, [...s].sort()]));
}

export function hasDatabase(state: GameState, content: ContentBundle): boolean {
  return state.world.nodes.some((n) => maybeComponent(content, n.type)?.role === 'database');
}

export function pinsFor(app: string, state: GameState, content: ContentBundle, sim: SimResult | null): EvidenceToken[] {
  const w = state.world;
  const out: EvidenceToken[] = [];
  switch (app) {
    case 'inspector':
    case 'traces':
      for (const tr of sim?.traces ?? []) if (tr.sample !== 'asset') out.push(pin.request(app, tr.endpointId));
      break;
    case 'logs':
      for (const l of sim?.logs ?? []) out.push(pin.log(l.code));
      break;
    case 'database':
      if (!hasDatabase(state, content)) break;
      for (const t of w.tables) for (const c of t.columns) out.push(pin.column('database', t.name, c.name));
      for (const ep of w.endpoints) for (const q of ep.queries) {
        const ex = explainQuery(q, w.tables);
        out.push(pin.explain(ex.table, ex.type));
      }
      break;
    case 'monitoring':
      if (!sim) break;
      for (const m of MONITORING_METRICS) out.push(pin.metric('monitoring', m));
      out.push(pin.metric('monitoring', 'amplification'));
      for (const a of sim.alerts) out.push(pin.alert(a.metric));
      break;
    case 'queue':
      for (const name of Object.keys(sim?.queues ?? {})) out.push(pin.queue(name));
      break;
    case 'cicd':
      for (const r of w.deploy.releases) for (const id of r.bugs) {
        const bug = w.bugs.find((b) => b.id === id);
        if (bug) out.push(pin.releaseLog(bug.logCode));
      }
      break;
    case 'security': {
      for (const v of sim?.vulns ?? computeVulns(w, content)) out.push(pin.vuln(v));
      const users = w.tables.find((t) => t.name === 'users');
      const pwd = users?.columns.find((c) => c.name.startsWith('password'));
      if (users && pwd) out.push(pin.column('security', users.name, pwd.name));
      break;
    }
    case 'network':
      out.push(pin.tls(tlsStatus(state)));
      for (const r of Object.keys(sim?.summary.regionP95 ?? {})) out.push(pin.metric('network', `p95.${r}`));
      break;
    case 'dns':
      for (const r of w.dns.records) out.push(pin.dns(r.name, r.type));
      break;
    case 'architecture':
      for (const [table, services] of Object.entries(tableOwners(state))) out.push(pin.tableOwners(table, services));
      break;
  }
  return out;
}

export function sameToken(a: EvidenceToken, b: EvidenceToken): boolean {
  return a.app === b.app && a.kind === b.kind && a.key === b.key;
}
