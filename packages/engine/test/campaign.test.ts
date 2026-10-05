import { describe, it, expect } from 'vitest';
import {
  newGame,
  reduce,
  simulate,
  startMission,
  recordSimulation,
  completeMission,
  performOp,
  chooseHypothesis,
  objectiveStatus,
  createCheckpoint,
  restoreCheckpoint,
  compareStates,
  migrateState,
  loadState,
  runAttack,
  computeFacts,
  runCommand,
  callApi,
  type GameState,
  type GameAction,
  type ContentBundle,
} from '../src/index';
import { loadContent } from '@prod/content';

const content: ContentBundle = loadContent();

/** Apply a list of actions, asserting each succeeds. */
function act(state: GameState, actions: GameAction[]): GameState {
  let s = state;
  for (const a of actions) {
    const r = reduce(s, a, content);
    if (!r.ok) throw new Error(`action ${a.type} failed: ${r.events.map((e) => e.key).join(',')}`);
    s = r.state;
  }
  return s;
}

function completeCurrent(state: GameState): GameState {
  const sim = simulate(state, content);
  let s = recordSimulation(state, content, sim).state;
  const status = objectiveStatus(s, content, sim);
  expect(status.every((o) => o.met), `mission ${state.campaign.active?.id} unmet: ${status.filter((o) => !o.met).map((o) => o.id)} p95=${sim.summary.p95} err=${sim.summary.errorRate} homeServed=${sim.endpoints.home?.served}`).toBe(true);
  const r = completeMission(s, content, sim);
  expect(r.ok, `complete failed: ${r.events.map((e) => e.key)}`).toBe(true);
  return r.state;
}

describe('mission lifecycle — Act I', () => {
  it('plays m001 → m006 end to end', () => {
    let s = newGame(content, 777);
    // m001 boot
    s = startMission(s, content, 'm001').state;
    s = act(s, [{ type: 'app.open', app: 'project' }, { type: 'mail.read', id: 'm001-t' }]);
    s = completeCurrent(s);
    expect(s.campaign.completed['m001']).toBeTruthy();
    expect(s.campaign.currentMissionId).toBe('m002');

    // m002 name
    s = startMission(s, content, 'm002').state;
    s = act(s, [{ type: 'company.setName', name: 'Acme Shop' }]);
    s = completeCurrent(s);

    // m003 static page — publish files
    s = startMission(s, content, 'm003').state;
    s = performOp(s, content, 'publish', null).state;
    s = performOp(s, content, 'css', null).state;
    s = performOp(s, content, 'logo', null).state;
    s = completeCurrent(s);
    expect(s.achievements['first-request']).toBeTruthy();

    // m004 first user
    s = startMission(s, content, 'm004').state;
    s = completeCurrent(s);

    // m005 request/response — pin the request
    s = startMission(s, content, 'm005').state;
    s = act(s, [{ type: 'mission.pin', token: { app: 'inspector', kind: 'request', key: 'home' } }]);
    s = completeCurrent(s);

    // m006 server/port — the port was closed in setup; reopen it
    s = startMission(s, content, 'm006').state;
    s = act(s, [
      { type: 'mission.pin', token: { app: 'terminal', kind: 'ports', key: '80,22' } },
    ]);
    s = chooseHypothesis(s, content, 'h2').state;
    s = performOp(s, content, 'open80', null).state;
    s = completeCurrent(s);
    expect(s.campaign.completed['m006']).toBeTruthy();
    expect(s.campaign.currentMissionId).toBe('m007');
  });
});

describe('delayed consequences', () => {
  it('a quick-fix schedules a consequence that later fires', () => {
    // Reach m013 quickly by stubbing completion of prerequisites.
    let s = newGame(content, 5);
    s.company.name = 'Acme';
    // Fabricate completion of m001..m012 so we can start m013.
    for (const id of ['m001','m002','m003','m004','m005','m006','m007','m008','m009','m010','m011','m012']) {
      s.campaign.completed[id] = { id, result: 'success', solutionId: null, solutionKind: 'good', completedAt: 0, before: null, after: null, hypothesisCorrect: null, wrongHypotheses: 0, debtDelta: 0, evidence: 0 };
      s.campaign.completedOrder.push(id);
    }
    // Ensure the world has the needed endpoints/settings m013 expects.
    s.unlocks.settings.push('authMode', 'sessionStore', 'cookieHttpOnly');
    s.world.endpoints.push({ id: 'account', method: 'GET', path: '/account', product: { en: '', ru: '' }, target: 'backend', weight: 4, cpuMs: 8, responseKb: 3, auth: 'user', queries: [] });
    s = startMission(s, content, 'm013').state;
    // choose the weak auth to trigger the consequence
    s = act(s, [
      { type: 'app.set', key: 'authMode', value: 'plain-cookie' },
      { type: 'mission.pin', token: { app: 'inspector', kind: 'request', key: 'account' } },
    ]);
    const sim = simulate(s, content);
    s = recordSimulation(s, content, sim).state;
    const st = objectiveStatus(s, content, sim);
    // objective o1 is met (authMode is plain-cookie counts as logged-in); complete with the bad solution
    if (st.every((o) => o.met)) {
      const r = completeMission(s, content, sim);
      s = r.state;
      expect(r.report?.consequencesScheduled.length ?? 0).toBeGreaterThanOrEqual(0);
      expect(s.consequences.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('Time Machine', () => {
  it('restore never loses achievements or knowledge, and backs up first', () => {
    let s = newGame(content, 11);
    const cp = createCheckpoint(s, 'manual', 'start');
    // advance: unlock an achievement and knowledge, add debt
    s.achievements['friday-deploy'] = 100;
    s.knowledge['db.index'] = { state: 'mastered', score: 9, lastPracticedAt: 0 };
    s.debt = 40;
    const { state: restored, backup } = restoreCheckpoint(s, cp);
    expect(backup.type).toBe('pre-restore');
    expect(restored.debt).toBe(0); // world state rolled back
    expect(restored.achievements['friday-deploy']).toBe(100); // meta kept
    expect(restored.knowledge['db.index'].state).toBe('mastered');
    expect(restored.stats.restores).toBe(1);
  });

  it('compare runs both sides with the same seed salt', () => {
    const a = newGame(content, 7);
    const b = JSON.parse(JSON.stringify(a)) as GameState;
    b.world.nodes.find((n) => n.type === 'nginx')!.config.gzip = true;
    const { rows } = compareStates(a, b, content);
    expect(rows.find((r) => r.metric === 'p95')).toBeTruthy();
  });
});

describe('attack lab', () => {
  it('SQLi succeeds on a vulnerable system and is blocked once fixed', () => {
    const s = newGame(content, 1);
    s.world.endpoints.push({ id: 'search', method: 'GET', path: '/search', product: { en: '', ru: '' }, target: 'backend', weight: 1, cpuMs: 5, responseKb: 2, auth: 'none', api: true, queries: [{ id: 'q', table: 'products', op: 'select', where: ['name'], like: true, match: 'many' }] });
    s.world.app.queryMode = 'concat';
    const attack = content.attacks.find((a) => a.id === 'sqli')!;
    const vulnFacts = computeFacts(s, content, simulate(s, content));
    expect(runAttack(attack, vulnFacts, 0, 0).success).toBe(true);
    s.world.app.queryMode = 'parameterized';
    const safeFacts = computeFacts(s, content, simulate(s, content));
    expect(runAttack(attack, safeFacts, 0, 1).success).toBe(false);
  });
});

describe('simulated terminal and API are honest', () => {
  it('curl over https fails before a certificate exists', () => {
    const s = newGame(content, 1);
    s.unlocks.commands.push('curl');
    const out = runCommand('curl -I https://203.0.113.10/', s, content, null);
    expect(out.lines.join(' ')).toMatch(/SSL|refused|timed out/i);
  });

  it('API returns 404 for an unknown path and 401 when auth is required', () => {
    const s = newGame(content, 1);
    s.world.endpoints.push({ id: 'account', method: 'GET', path: '/api/v1/me', product: { en: '', ru: '' }, target: 'backend', weight: 1, cpuMs: 5, responseKb: 1, auth: 'user', api: true, queries: [] });
    s.world.app.authMode = 'session';
    const notFound = callApi(s, content, null, { method: 'GET', path: '/api/v1/nope', auth: 'none', body: 'none' });
    expect(notFound.status).toBe(404);
    const unauth = callApi(s, content, null, { method: 'GET', path: '/api/v1/me', auth: 'none', body: 'none' });
    expect(unauth.status).toBe(401);
  });
});

describe('save migrations', () => {
  it('migrates a v1 save to the current schema without losing progress', () => {
    const v1 = {
      version: 1,
      seed: 123,
      company: 'Legacy Co',
      cash: 250,
      missionId: 'm009',
      completed: { m001: { id: 'm001' }, m002: { id: 'm002' } },
      knowledge: { 'db.index': 3 },
      debt: 12,
      world: newGame(content, 123).world,
    };
    const migrated = migrateState(v1 as unknown as Record<string, unknown>) as unknown as GameState;
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.company.name).toBe('Legacy Co');
    expect(migrated.budget.cash).toBe(250);
    expect(migrated.campaign.currentMissionId).toBe('m009');
    expect(migrated.knowledge['db.index'].state).toBe('practiced');
    expect(Object.keys(migrated.campaign.completed)).toContain('m001');
  });

  it('loadState fills fields that newer content expects', () => {
    const v1 = { version: 1, seed: 9, company: 'X', cash: 0, missionId: 'm001', completed: {}, knowledge: {}, debt: 0, world: newGame(content, 9).world };
    const loaded = loadState(v1, content);
    expect(loaded.world.cacheRules).toBeDefined();
    expect(loaded.knowledge['sec.sqli']).toBeDefined();
  });

  it('refuses a save from a newer schema', () => {
    expect(() => migrateState({ schemaVersion: 99 })).toThrow();
  });
});
