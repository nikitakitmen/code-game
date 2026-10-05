import { maybeComponent } from '../catalog';
import type { ArchNode, ContentBundle, EndpointDef, NodeRole, RegionId, World } from '../types';

export type ConnectResult = { ok: true } | { ok: false; reason: string; params?: Record<string, string> };

const FORWARDING: NodeRole[] = ['cdn', 'waf', 'lb', 'proxy'];

/**
 * Physical connection rules. Impossible links are blocked with an explanation key;
 * bad-but-possible links (browser → backend bypassing the proxy, …) are allowed.
 */
export function canConnect(content: ContentBundle, world: World, fromId: string, toId: string): ConnectResult {
  if (fromId === toId) return { ok: false, reason: 'rules.self' };
  const from = world.nodes.find((n) => n.id === fromId);
  const to = world.nodes.find((n) => n.id === toId);
  if (!from || !to) return { ok: false, reason: 'rules.missing' };
  if (world.edges.some((e) => e.from === fromId && e.to === toId)) return { ok: false, reason: 'rules.duplicate' };
  const fd = maybeComponent(content, from.type);
  const td = maybeComponent(content, to.type);
  if (!fd || !td) return { ok: false, reason: 'rules.missing' };
  const params = { from: from.name, to: to.name };
  if (td.role === 'client') return { ok: false, reason: 'rules.toClient', params };
  if (fd.role === 'dns' || td.role === 'dns') {
    if (fd.role === 'client' && td.role === 'dns') return { ok: true };
    return { ok: false, reason: 'rules.dnsNotInPath', params };
  }
  if ((fd.role === 'database' || fd.role === 'replica') && !['replica', 'backup', 'monitoring', 'logs'].includes(td.role)) {
    return { ok: false, reason: 'rules.dbDoesNotCall', params };
  }
  if (fd.role === 'cache' && !['monitoring', 'logs'].includes(td.role)) return { ok: false, reason: 'rules.cacheDoesNotCall', params };
  if (fd.role === 'replica' && td.role === 'replica') return { ok: false, reason: 'rules.replicaChain', params };
  if (td.role === 'replica' && fd.role !== 'database' && !['backend', 'worker'].includes(fd.role)) {
    return { ok: false, reason: 'rules.generic', params };
  }
  if (!fd.connectsTo.includes(td.role)) return { ok: false, reason: 'rules.generic', params };
  if (fd.role === 'provider' && td.role !== 'backend') return { ok: false, reason: 'rules.generic', params };
  return { ok: true };
}

export function outNeighbors(world: World, id: string): ArchNode[] {
  const ids = world.edges.filter((e) => e.from === id).map((e) => e.to);
  return world.nodes.filter((n) => ids.includes(n.id));
}

export function inNeighbors(world: World, id: string): ArchNode[] {
  const ids = world.edges.filter((e) => e.to === id).map((e) => e.from);
  return world.nodes.filter((n) => ids.includes(n.id));
}

export function hasEdgeByRole(content: ContentBundle, world: World, fromRole: NodeRole, toRole: NodeRole): boolean {
  return world.edges.some((e) => {
    const a = world.nodes.find((n) => n.id === e.from);
    const b = world.nodes.find((n) => n.id === e.to);
    return !!a && !!b && maybeComponent(content, a.type)?.role === fromRole && maybeComponent(content, b.type)?.role === toRole;
  });
}

export interface RoutePath {
  nodes: string[];
  share: number;
  /** share lost because a hop was offline and nothing routed around it */
  failed?: 'UPSTREAM_DOWN' | 'NO_ROUTE';
}

export interface Route {
  endpointId: string;
  entry: string | null;
  paths: RoutePath[];
  /** forwarding layers on the main path (cdn/waf/lb/proxy) */
  layers: NodeRole[];
  error: 'NO_ROUTE' | null;
}

export interface RouteContext {
  content: ContentBundle;
  world: World;
  offline: Set<string>;
  /** limit entries to these node ids (DNS resolution) */
  entryFilter?: Set<string>;
  userRegion?: RegionId;
}

function role(ctx: RouteContext, node: ArchNode): NodeRole | undefined {
  return maybeComponent(ctx.content, node.type)?.role;
}

export function endpointService(ep: EndpointDef): string {
  return ep.service ?? 'monolith';
}

/** Backend nodes able to handle the endpoint (dedicated service first, monolith otherwise). */
export function serviceBackends(content: ContentBundle, world: World, ep: EndpointDef): ArchNode[] {
  const backends = world.nodes.filter((n) => maybeComponent(content, n.type)?.role === 'backend');
  const service = endpointService(ep);
  const dedicated = backends.filter((n) => (n.config.service ?? 'monolith') === service);
  if (dedicated.length) return dedicated;
  return backends.filter((n) => (n.config.service ?? 'monolith') === 'monolith');
}

function isTerminal(ctx: RouteContext, node: ArchNode, ep: EndpointDef, terminals: Set<string>): boolean {
  if (ep.target === 'backend') return terminals.has(node.id);
  const r = role(ctx, node);
  if (ep.upload) return r === 'storage' || r === 'backend';
  return r === 'proxy' || r === 'storage' || r === 'backend';
}

/**
 * Enumerate client → terminal paths through forwarding nodes and split traffic:
 * every forwarding node spreads requests evenly across next hops that lead to a terminal
 * (that is what an upstream block / load balancer does). Offline hops are skipped when the
 * forwarder has health checks; otherwise their share fails with 502.
 */
export function routeEndpoint(ctx: RouteContext, ep: EndpointDef): Route {
  const { world } = ctx;
  const client = world.nodes.find((n) => role(ctx, n) === 'client');
  const empty: Route = { endpointId: ep.id, entry: null, paths: [], layers: [], error: 'NO_ROUTE' };
  if (!client) return empty;
  const terminals = new Set(serviceBackends(ctx.content, world, ep).map((n) => n.id));

  // Which nodes can reach a terminal (memoised DFS over forwarding nodes)?
  const reach = new Map<string, boolean>();
  const canReach = (node: ArchNode, seen: Set<string>): boolean => {
    if (reach.has(node.id)) return reach.get(node.id)!;
    if (isTerminal(ctx, node, ep, terminals)) {
      // static content: a proxy serves files itself unless it is a pure pass-through
      reach.set(node.id, true);
      return true;
    }
    const r = role(ctx, node);
    if (!r || !FORWARDING.includes(r)) {
      reach.set(node.id, false);
      return false;
    }
    seen.add(node.id);
    const ok = outNeighbors(world, node.id).some((nb) => !seen.has(nb.id) && canReach(nb, seen));
    seen.delete(node.id);
    reach.set(node.id, ok);
    return ok;
  };

  let entries = outNeighbors(world, client.id).filter((n) => role(ctx, n) !== 'dns' && canReach(n, new Set([client.id])));
  if (ctx.entryFilter) entries = entries.filter((n) => ctx.entryFilter!.has(n.id));
  if (!entries.length) return empty;

  const depth = (n: ArchNode): number => {
    const r = role(ctx, n);
    if (!r || !FORWARDING.includes(r) || isTerminal(ctx, n, ep, terminals)) return 0;
    const nexts = outNeighbors(world, n.id).filter((nb) => canReach(nb, new Set([n.id])));
    return 1 + Math.max(0, ...nexts.map(depth));
  };
  // Users follow the outermost layer the owner has put in front (their URL points there).
  // Prefer entries in the user's region when several are equally deep.
  entries.sort((a, b) => {
    const d = depth(b) - depth(a);
    if (d !== 0) return d;
    if (ctx.userRegion) {
      const ra = a.region === ctx.userRegion ? 0 : 1;
      const rb = b.region === ctx.userRegion ? 0 : 1;
      if (ra !== rb) return ra - rb;
    }
    return a.id.localeCompare(b.id);
  });
  const entry = entries[0];

  const paths: RoutePath[] = [];
  const walk = (node: ArchNode, acc: string[], share: number) => {
    const path = [...acc, node.id];
    if (ctx.offline.has(node.id)) {
      paths.push({ nodes: path, share, failed: 'UPSTREAM_DOWN' });
      return;
    }
    const r = role(ctx, node);
    // static content: a proxy that also forwards to an upstream still serves static files itself
    if (isTerminal(ctx, node, ep, terminals) && !(r === 'cdn')) {
      paths.push({ nodes: path, share });
      return;
    }
    const nexts = outNeighbors(world, node.id).filter((nb) => !path.includes(nb.id) && canReach(nb, new Set(path)));
    if (!nexts.length) {
      paths.push({ nodes: path, share, failed: 'NO_ROUTE' });
      return;
    }
    const healthChecks = r === 'lb' ? node.config.healthChecks !== false : r === 'proxy' || r === 'cdn' || r === 'waf';
    const alive = nexts.filter((nb) => !ctx.offline.has(nb.id));
    const targets = healthChecks && alive.length ? alive : nexts;
    for (const nb of targets) walk(nb, path, share / targets.length);
  };
  walk(entry, [], 1);

  const main = paths.slice().sort((a, b) => b.share - a.share)[0];
  const layers = (main?.nodes ?? [])
    .map((id) => world.nodes.find((n) => n.id === id))
    .filter((n): n is ArchNode => !!n)
    .map((n) => role(ctx, n)!)
    .filter((r) => FORWARDING.includes(r));
  return { endpointId: ep.id, entry: entry.id, paths, layers, error: null };
}
