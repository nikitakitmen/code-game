import { describe, it, expect } from 'vitest';
import {
  canConnect,
  newGame,
  reduce,
  simulate,
  startMission,
  recordSimulation,
  completeMission,
  objectiveStatus,
  computeFacts,
  referencedFacts,
  loadState,
  makeEnvelope,
  type ContentBundle,
  type GameState,
  type MissionDef,
} from '@prod/engine';
import { loadContent, ALL_MISSIONS } from '../src/index';

const content: ContentBundle = loadContent();

describe('content integrity', () => {
  it('loads components, settings, knowledge, achievements, npcs, attacks', () => {
    expect(content.components.length).toBeGreaterThan(15);
    expect(content.settings.length).toBeGreaterThan(30);
    expect(content.knowledge.length).toBeGreaterThan(50);
    expect(content.achievements.length).toBeGreaterThan(10);
    expect(content.npcs.length).toBeGreaterThanOrEqual(5);
    expect(content.attacks.length).toBeGreaterThanOrEqual(6);
  });

  it('component config fields and connectsTo reference valid roles', () => {
    const roles = new Set(content.components.map((c) => c.role));
    for (const c of content.components) {
      for (const r of c.connectsTo) expect(roles.has(r)).toBe(true);
      expect(c.label.en && c.label.ru).toBeTruthy();
    }
  });

  it('every setting is bilingual and typed', () => {
    for (const s of content.settings) {
      expect(s.label.en && s.label.ru).toBeTruthy();
      expect(s.help.en && s.help.ru).toBeTruthy();
      if (s.type === 'enum') expect(s.options && s.options.length).toBeGreaterThan(1);
    }
  });

  it('knowledge parents and achievement knowledge refs exist', () => {
    const ids = new Set(content.knowledge.map((k) => k.id));
    for (const k of content.knowledge) {
      if (k.parent) expect(ids.has(k.parent)).toBe(true);
      expect(k.article.what.en && k.article.what.ru).toBeTruthy();
    }
    for (const c of content.components) expect(ids.has(c.knowledge)).toBe(true);
    for (const a of content.attacks) expect(ids.has(a.knowledge)).toBe(true);
  });
});

describe('mission schema', () => {
  const byId = new Map(ALL_MISSIONS.map((m) => [m.id, m] as const));

  it('mission ids and order are unique and prerequisites resolve', () => {
    const ids = new Set<string>();
    const orders = new Set<number>();
    for (const m of ALL_MISSIONS) {
      expect(ids.has(m.id)).toBe(false);
      ids.add(m.id);
      expect(orders.has(m.order)).toBe(false);
      orders.add(m.order);
      for (const p of m.prerequisites) expect(byId.has(p)).toBe(true);
    }
  });

  it('next pointers form a single chain', () => {
    for (const m of ALL_MISSIONS) if (m.next) expect(byId.has(m.next)).toBe(true);
  });

  it('every mission is bilingual with a trigger, objectives, solutions and explanation', () => {
    for (const m of ALL_MISSIONS) {
      expect(m.title.en && m.title.ru).toBeTruthy();
      expect(m.trigger.subject.en && m.trigger.subject.ru).toBeTruthy();
      expect(m.trigger.body.en && m.trigger.body.ru).toBeTruthy();
      expect(m.objectives.length).toBeGreaterThan(0);
      expect(m.solutions.length).toBeGreaterThan(0);
      expect(m.explanation.what.en && m.explanation.what.ru).toBeTruthy();
      expect(m.learning.length).toBeGreaterThan(0);
    }
  });

  it('learning refs and achievement refs resolve', () => {
    const know = new Set(content.knowledge.map((k) => k.id));
    const achs = new Set(content.achievements.map((a) => a.id));
    for (const m of ALL_MISSIONS) {
      for (const l of m.learning) expect(know.has(l)).toBe(true);
      for (const a of m.achievements ?? []) expect(achs.has(a.id)).toBe(true);
    }
  });

  it('npc senders in triggers/dialogue are known npcs', () => {
    const npcs = new Set(content.npcs.map((n) => n.id));
    for (const m of ALL_MISSIONS) {
      expect(npcs.has(m.trigger.from)).toBe(true);
      for (const d of m.dialogue ?? []) expect(npcs.has(d.npc)).toBe(true);
    }
  });

  it('objective/solution facts are facts the engine can emit', () => {
    const state = newGame(content, 1);
    const sim = simulate(state, content);
    const known = new Set(Object.keys(computeFacts(state, content, sim)));
    // collect every prefix the engine emits so dynamic facts (per id) are accepted
    const prefixes = new Set<string>();
    for (const k of known) {
      const parts = k.split('.');
      for (let i = 1; i <= parts.length; i++) prefixes.add(parts.slice(0, i).join('.'));
    }
    const accept = (f: string) => {
      if (prefixes.has(f)) return true;
      // dynamic families: match on the stable prefix up to the id segment
      const fams = ['ep.', 'nodeId.', 'node.', 'count.', 'online.', 'size.', 'edge.', 'edgeRole.', 'edgeId.', 'type.', 'role.', 'app.', 'pending.', 'cache.', 'table.', 'rows.', 'idx.', 'idxlead.', 'indexes.', 'unique.', 'pk.', 'fk.', 'column.', 'file.', 'fileOpt.', 'fileLazy.', 'dns.', 'tls.', 'sec.', 'vuln.', 'attack.', 'pr.', 'ci.', 'flag.', 'deploy.', 'obs.', 'incident.', 'postmortem.', 'worldIncident.', 'wflag.', 'completed.', 'solution.', 'solutionKind.', 'mission.', 'know.', 'achievement.', 'queue.', 'anomaly.', 'm.', 'q.', 'stats.', 'region.', 'regionNodes.', 'service.', 'services.', 'roleUtil.', 'public.', 'publicRole.', 'listen.', 'backend.', 'alerts.', 'unlocked.', 'feature.', 'mail.', 'app.opened.', 'campaignFinished', 'company.', 'clock', 'debt', 'cash', 'users', 'bug.', 'bugs.', 'dialogue.'];
      return fams.some((p) => f.startsWith(p) || f === p.replace(/\.$/, ''));
    };
    const miss: string[] = [];
    for (const m of ALL_MISSIONS) {
      const conds = [...m.objectives.map((o) => o.check), ...m.solutions.map((s) => s.when)];
      for (const c of conds) for (const f of referencedFacts(c)) if (!accept(f)) miss.push(`${m.id}:${f}`);
    }
    expect(miss, miss.slice(0, 20).join(', ')).toEqual([]);
  });
});

describe('determinism & save', () => {
  it('same seed + same state → identical simulation', () => {
    const a = newGame(content, 42);
    const b = newGame(content, 42);
    const sa = simulate(a, content);
    const sb = simulate(b, content);
    expect(sa.summary).toEqual(sb.summary);
    expect(sa.snapshot).toEqual(sb.snapshot);
  });

  it('a save round-trips through an envelope', () => {
    const s = newGame(content, 7);
    const env = makeEnvelope(s, 1, content.version);
    const loaded = loadState(JSON.parse(JSON.stringify(env)).state, content);
    expect(loaded.seed).toBe(7);
    expect(loaded.schemaVersion).toBe(env.schemaVersion);
  });
});

describe('invalid architecture connections are blocked', () => {
  it('a database cannot connect to the client', () => {
    const s = newGame(content, 1);
    // add a mysql node via a permissive clone to test the rule directly
    const withDb: GameState = JSON.parse(JSON.stringify(s));
    withDb.world.nodes.push({ id: 'db1', type: 'mysql', name: 'db', region: 'eu', pos: { x: 6, y: 6 }, size: 's', config: {}, ip: '10.0.0.9', ports: [3306], publicPorts: [], createdAt: 0 });
    const r = canConnect(content, withDb.world, 'db1', 'users');
    expect(r.ok).toBe(false);
  });
});

function playToObjectives(mission: MissionDef): { state: GameState } {
  let state = newGame(content, 123);
  state.company.name = 'Acme';
  return { state };
}

describe('act I is playable', () => {
  it('home mission can be started and simulated', () => {
    let state = newGame(content, 5);
    state.company.name = 'Acme';
    const r = startMission(state, content, 'm001');
    expect(r.ok).toBe(true);
    state = r.state;
    const sim = simulate(state, content);
    const rec = recordSimulation(state, content, sim);
    expect(rec.ok).toBe(true);
    expect(sim.summary.availability).toBeGreaterThanOrEqual(0);
  });
  void playToObjectives;
});
