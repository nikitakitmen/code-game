import { describe, it, expect } from 'vitest';
import { produce } from 'immer';
import {
  applyEffects,
  clockParts,
  clockTarget,
  computeFacts,
  isWorldAction,
  newGame,
  reduce,
  simulate,
  startMission,
  weekday,
  type ContentBundle,
  type EngineEvent,
  type Effect,
  type GameState,
} from '../src/index';
import { loadContent } from '@prod/content';

const content: ContentBundle = loadContent();

function withEffects(state: GameState, effects: Effect[]): { state: GameState; events: EngineEvent[] } {
  const events: EngineEvent[] = [];
  const next = produce(state, (d) => applyEffects(d, content, effects, events, 'test'));
  return { state: next, events };
}

/** Pretend the campaign is done up to (and excluding) a mission so it can be started directly. */
function completedUpTo(state: GameState, missionId: string): GameState {
  const s = structuredClone(state);
  for (const m of [...content.missionIndex].sort((a, b) => a.order - b.order)) {
    if (m.id === missionId) break;
    s.campaign.completed[m.id] = { id: m.id, result: 'success', solutionId: null, solutionKind: 'good', completedAt: 0, before: null, after: null, hypothesisCorrect: null, wrongHypotheses: 0, debtDelta: 0, evidence: 0 };
    s.campaign.completedOrder.push(m.id);
  }
  return s;
}

describe('effect paths', () => {
  it('"clock" addresses GameState.clock, never world.clock', () => {
    const s = newGame(content, 1);
    const { state } = withEffects(s, [{ set: 'clock', value: 6780 }]);
    expect(state.clock).toBe(6780);
    expect((state.world as unknown as Record<string, unknown>).clock).toBeUndefined();
  });

  it('game time only moves forward: a past target means the next such time of the week', () => {
    const now = 200 * 1440 + 9 * 60; // day 201, 09:00
    const friday5pm = clockTarget(now, 6780);
    expect(friday5pm).toBeGreaterThan(now);
    expect(weekday(friday5pm)).toBe(4);
    expect(clockParts(friday5pm).hh).toBe(17);
    expect(friday5pm - now).toBeLessThan(7 * 1440);
    expect(clockTarget(100, 6780)).toBe(6780); // a future target is taken as is
  });

  it('m046 makes it Friday 17:00 and m047 the following Monday 10:00', () => {
    let s = completedUpTo(newGame(content, 3), 'm046');
    s.clock = 150 * 1440 + 11 * 60;
    s = startMission(s, content, 'm046').state;
    expect(weekday(s.clock)).toBe(4);
    expect(clockParts(s.clock).hh).toBe(17);
    expect(computeFacts(s, content, null)['clock.friday']).toBe(true);
    const friday = s.clock;
    s = structuredClone(s);
    s.campaign.completed.m046 = { ...s.campaign.completed.m045, id: 'm046' };
    s.campaign.completedOrder.push('m046');
    s.campaign.active = null;
    s = startMission(s, content, 'm047').state;
    expect(weekday(s.clock)).toBe(0);
    expect(clockParts(s.clock).hh).toBe(10);
    expect(s.clock).toBeGreaterThan(friday);
  });

  it('every other path family still addresses the world', () => {
    const s = newGame(content, 1);
    const { state } = withEffects(s, [
      { set: 'app.cors', value: 'origin' },
      { merge: 'app', value: { deleteMethod: 'GET' } },
      { set: 'endpoints[id=home].cpuMs', value: 2 },
      { set: 'nodes[id=web1].publicPorts', value: [22] },
      { set: 'traffic.baseRps', value: 9 },
      { push: 'observability.runbooks', value: { id: 'rb', title: 't', trigger: 'x', steps: [] } },
      { set: 'files[path=/var/www/html/logo.png]', value: { path: '/var/www/html/logo.png', sizeKb: 1, kind: 'image' } },
      { inc: 'traffic.users', by: 5 },
      { set: 'flags.demo', value: true },
    ]);
    const w = state.world;
    expect(w.app.cors).toBe('origin');
    expect(w.app.deleteMethod).toBe('GET');
    expect(w.endpoints.find((e) => e.id === 'home')!.cpuMs).toBe(2);
    expect(w.nodes.find((n) => n.id === 'web1')!.publicPorts).toEqual([22]);
    expect(w.traffic.baseRps).toBe(9);
    expect(w.traffic.users).toBe(s.world.traffic.users + 5);
    expect(w.observability.runbooks.map((r) => r.id)).toEqual(['rb']);
    expect(w.files.some((f) => f.path === '/var/www/html/logo.png')).toBe(true);
    expect(w.flags.demo).toBe(true);
    expect(state.clock).toBe(s.clock);
  });

  it('an effect on something the player does not have is skipped, not fatal', () => {
    const s = newGame(content, 1);
    const { state, events } = withEffects(s, [{ set: 'nodes[id=mysql-9].config.maxConnections', value: 5 }, { set: 'app.cors', value: 'origin' }]);
    expect(events.some((e) => e.key === 'toast.effectSkipped')).toBe(true);
    expect(state.world.app.cors).toBe('origin');
  });

  it('every mission setup in the campaign targets real fields', () => {
    for (const id of Object.keys(content.missions)) {
      for (const e of content.missions[id].setup ?? []) {
        for (const k of ['set', 'inc', 'push', 'merge', 'remove'] as const) {
          const path = (e as Record<string, unknown>)[k];
          if (typeof path !== 'string') continue;
          const head = path.split(/[.[]/)[0];
          expect(head === 'clock' || head in content.initial.world, `${id}: ${k} ${path}`).toBe(true);
        }
      }
    }
  });
});

describe('actions', () => {
  it('app.open records the canonical app id without touching the world', () => {
    const s = newGame(content, 1);
    const r = reduce(s, { type: 'app.open', app: 'project' }, content);
    expect(r.ok).toBe(true);
    expect(r.state.openedApps).toEqual(['project']);
    expect(r.state.seq).toBe(s.seq);
    expect(computeFacts(r.state, content, null)['app.opened.project']).toBe(true);
    expect(isWorldAction({ type: 'app.open', app: 'project' })).toBe(false);
    expect(isWorldAction({ type: 'node.move', id: 'web1', pos: { x: 1, y: 1 } })).toBe(false);
    expect(isWorldAction({ type: 'node.move', id: 'web1', pos: { x: 1, y: 1 }, region: 'us' })).toBe(true);
  });

  it('edge.disconnect removes a link; impossible links stay impossible', () => {
    let s = newGame(content, 1);
    s.unlocks.components.push('backend', 'mysql');
    s = reduce(s, { type: 'node.add', nodeType: 'backend' }, content).state;
    s = reduce(s, { type: 'node.add', nodeType: 'mysql' }, content).state;
    s = reduce(s, { type: 'edge.connect', from: 'web1', to: 'backend-1' }, content).state;
    expect(reduce(s, { type: 'edge.connect', from: 'mysql-1', to: 'users' }, content).ok).toBe(false);
    const r = reduce(s, { type: 'edge.disconnect', from: 'web1', to: 'backend-1' }, content);
    expect(r.ok).toBe(true);
    expect(r.state.world.edges.some((e) => e.id === 'web1>backend-1')).toBe(false);
  });

  it('rolling back to a release without a config snapshot keeps the live settings', () => {
    const s = newGame(content, 1);
    s.unlocks.features.push('release_pipeline');
    s.world.app.authMode = 'session';
    s.world.deploy.version = 2;
    s.world.deploy.releases.push({ version: 2, at: 0, app: {}, fixes: [], bugs: [], status: 'live', migration: 'none' });
    const r = reduce(s, { type: 'deploy.rollback' }, content);
    expect(r.ok).toBe(true);
    expect(r.state.world.deploy.version).toBe(1);
    expect(r.state.world.app.authMode).toBe('session');
  });
});

describe('simulation model fixes', () => {
  function shop(): GameState {
    const s = newGame(content, 4);
    s.unlocks.components.push('backend', 'mysql', 'redis', 'replica');
    let st = s;
    for (const t of ['backend', 'mysql']) st = reduce(st, { type: 'node.add', nodeType: t }, content).state;
    st = reduce(st, { type: 'edge.connect', from: 'web1', to: 'backend-1' }, content).state;
    st = reduce(st, { type: 'edge.connect', from: 'backend-1', to: 'mysql-1' }, content).state;
    st = structuredClone(st);
    st.world.app.dataSource = 'mysql';
    st.world.traffic.baseRps = 200;
    st.world.tables.push({ name: 'products', rows: 400000, rowKb: 1, columns: [{ name: 'id', type: 'bigint', pk: true }, { name: 'category_id', type: 'bigint' }], indexes: [] });
    st.world.endpoints.push({ id: 'catalog', method: 'GET', path: '/catalog', product: { en: '', ru: '' }, target: 'backend', weight: 10, cpuMs: 4, responseKb: 4, auth: 'none', queries: [{ id: 'q', table: 'products', op: 'select', where: ['category_id'], match: 'many', selectivity: 0.01 }], cache: { cardinality: 10, valueKb: 4 } });
    return st;
  }

  it('cache hits take read load off the database', () => {
    const base = shop();
    const cached = structuredClone(base);
    cached.world.nodes.push({ ...structuredClone(cached.world.nodes.find((n) => n.id === 'mysql-1')!), id: 'redis-1', type: 'redis', config: { memoryMb: 256, maxmemoryPolicy: 'noeviction', purpose: 'both' } });
    cached.world.edges.push({ id: 'backend-1>redis-1', from: 'backend-1', to: 'redis-1' });
    cached.world.cacheRules.push({ endpoint: 'catalog', enabled: true, ttl: 300 });
    const a = simulate(base, content).nodes['mysql-1'].util;
    const b = simulate(cached, content).nodes['mysql-1'].util;
    expect(b).toBeLessThan(a * 0.2);
  });

  it('reads are spread across all replicas', () => {
    const one = shop();
    one.world.app.readRouting = 'replica';
    const rep = (id: string) => ({ ...structuredClone(one.world.nodes.find((n) => n.id === 'mysql-1')!), id, type: 'replica', config: { maxConnections: 151, promoteOnFailure: false } });
    one.world.nodes.push(rep('replica-1'));
    one.world.edges.push({ id: 'mysql-1>replica-1', from: 'mysql-1', to: 'replica-1' }, { id: 'backend-1>replica-1', from: 'backend-1', to: 'replica-1' });
    const two = structuredClone(one);
    two.world.nodes.push(rep('replica-2'));
    two.world.edges.push({ id: 'mysql-1>replica-2', from: 'mysql-1', to: 'replica-2' }, { id: 'backend-1>replica-2', from: 'backend-1', to: 'replica-2' });
    const u1 = simulate(one, content).nodes['replica-1'].util;
    const sim2 = simulate(two, content);
    expect(sim2.nodes['replica-1'].util).toBeCloseTo(u1 / 2, 1);
    expect(sim2.nodes['replica-2'].util).toBeCloseTo(u1 / 2, 1);
  });

  it('DNS failover skips an entry whose origin is down, and no outage means no REGION_DOWN', () => {
    const s = shop();
    s.unlocks.components.push('cdn');
    s.company.domain = 'acme.shop';
    s.world.dns = { domain: 'acme.shop', records: [{ id: '@', type: 'A', name: '@', value: '203.0.113.10', ttl: 60 }, { id: 'www', type: 'A', name: 'www', value: '203.0.113.10', ttl: 60 }], changes: [], geoRouting: true, failover: true };
    s.world.regions = ['eu', 'us', 'ap'];
    s.world.traffic.regionMix = { eu: 0.5, us: 0.3, ap: 0.2 };
    // a CDN in front of the EU proxy, and a US proxy with its own backend
    s.world.nodes.push({ ...structuredClone(s.world.nodes.find((n) => n.id === 'web1')!), id: 'cdn-1', type: 'cdn', ip: 'external', config: { cacheStatic: true, cacheApi: false, edges: 'eu' } });
    s.world.nodes.push({ ...structuredClone(s.world.nodes.find((n) => n.id === 'web1')!), id: 'web-us', region: 'us', ip: '203.0.113.30' });
    s.world.nodes.push({ ...structuredClone(s.world.nodes.find((n) => n.id === 'backend-1')!), id: 'backend-us', region: 'us' });
    s.world.edges.push({ id: 'users>cdn-1', from: 'users', to: 'cdn-1' }, { id: 'cdn-1>web1', from: 'cdn-1', to: 'web1' }, { id: 'users>web-us', from: 'users', to: 'web-us' }, { id: 'web-us>backend-us', from: 'web-us', to: 'backend-us' }, { id: 'backend-us>mysql-1', from: 'backend-us', to: 'mysql-1' });
    const calm = simulate(s, content);
    expect(Object.values(calm.endpoints).every((e) => !e.errors.REGION_DOWN)).toBe(true);

    const outage = structuredClone(s);
    // the EU web tier is gone; the CDN (external) is up but its origin is not
    outage.world.incidents.push({ id: 'webdown', kind: 'nodeDown', title: { en: '', ru: '' }, target: 'web1', startTick: 0, source: 'mission', active: true });
    const sim = simulate(outage, content);
    const home = sim.endpoints.home;
    expect(home.errors.UPSTREAM_DOWN ?? 0).toBe(0);
    expect(home.errorRate).toBeLessThan(0.1);
  });

  it('same state, same seed → same result', () => {
    const s = shop();
    expect(JSON.stringify(simulate(s, content).summary)).toBe(JSON.stringify(simulate(structuredClone(s), content).summary));
  });
});
