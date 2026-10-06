/**
 * UI coverage of the campaign: every player action, app setting, node setting and piece of
 * evidence the scripted playthrough needs must be reachable through a real PROD OS control that
 * is available (its app unlocked) at the moment the campaign first needs it — and using that
 * control must change the game state through the store's dispatch (GameAction → reduce()).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeFacts, simulate, type GameState } from '@prod/engine';
import { loadContent } from '@prod/content';
import { useGame } from '@/game/store';
import { useWM } from '@/os/windows';
import { APP_MAP } from '@/os/registry';
import { SETTING_HOMES } from '@/ui/Settings';
import { playCampaign, type Usage } from '../../../packages/content/test/playbook';

// vitest runs from apps/web
const SRC = resolve(process.cwd(), 'src') + '/';
const source = (file: string) => readFileSync(SRC + file, 'utf8');

/** Where the player triggers each GameAction (file must dispatch it; one of the apps must be unlocked). */
const ACTION_UI: Record<string, { files: string[]; apps: string[] | 'always' }> = {
  // windows.ts reports launches (onAppOpened); the store turns them into app.open
  'app.open': { files: ['game/store.ts'], apps: 'always' },
  'mail.read': { files: ['apps/Mail.tsx'], apps: ['mail'] },
  'company.setName': { files: ['os/Modals.tsx'], apps: 'always' },
  'mission.pin': { files: ['ui/Pin.tsx'], apps: 'always' },
  'app.set': { files: ['ui/Settings.tsx'], apps: 'always' },
  'node.add': { files: ['apps/Architecture.tsx'], apps: ['architecture'] },
  'node.config': { files: ['apps/Architecture.tsx'], apps: ['architecture'] },
  'node.resize': { files: ['apps/Architecture.tsx'], apps: ['architecture'] },
  'edge.connect': { files: ['apps/Architecture.tsx'], apps: ['architecture'] },
  'edge.disconnect': { files: ['apps/Architecture.tsx'], apps: ['architecture'] },
  'region.add': { files: ['apps/Architecture.tsx'], apps: ['architecture'] },
  'node.port': { files: ['apps/Servers.tsx'], apps: ['servers'] },
  'files.publish': { files: ['apps/Files.tsx'], apps: ['files'] },
  'files.optimize': { files: ['apps/Files.tsx'], apps: ['files'] },
  'files.lazy': { files: ['apps/Files.tsx'], apps: ['files'] },
  'db.createIndex': { files: ['apps/Database.tsx'], apps: ['database'] },
  'cache.rule': { files: ['apps/Cache.tsx'], apps: ['cache'] },
  'dns.setDomain': { files: ['apps/Dns.tsx'], apps: ['dns'] },
  'dns.setRecord': { files: ['apps/Dns.tsx'], apps: ['dns'] },
  'dns.configure': { files: ['apps/Dns.tsx'], apps: ['dns'] },
  'tls.issue': { files: ['apps/Network.tsx'], apps: ['network'] },
  'tls.configure': { files: ['apps/Network.tsx'], apps: ['network'] },
  'alerts.upsert': { files: ['apps/Monitoring.tsx'], apps: ['monitoring'] },
  'incident.declare': { files: ['apps/Incidents.tsx'], apps: ['incidents'] },
  'incident.order': { files: ['apps/Incidents.tsx'], apps: ['incidents'] },
  'postmortem.answer': { files: ['apps/Incidents.tsx'], apps: ['incidents'] },
  'postmortem.submit': { files: ['apps/Incidents.tsx'], apps: ['incidents'] },
  'slo.set': { files: ['apps/Incidents.tsx'], apps: ['incidents'] },
  'runbook.save': { files: ['apps/Runbooks.tsx'], apps: ['runbooks'] },
  'ci.enable': { files: ['apps/Cicd.tsx'], apps: ['cicd'] },
  'ci.stage': { files: ['apps/Cicd.tsx'], apps: ['cicd'] },
  'ci.addTest': { files: ['apps/Cicd.tsx'], apps: ['cicd'] },
  'deploy.run': { files: ['apps/Cicd.tsx'], apps: ['cicd'] },
  'deploy.rollback': { files: ['apps/Cicd.tsx'], apps: ['cicd'] },
  'flag.set': { files: ['apps/Cicd.tsx'], apps: ['cicd'] },
  'git.init': { files: ['apps/Git.tsx'], apps: ['git'] },
  'git.resolve': { files: ['apps/Git.tsx'], apps: ['git'] },
  'git.protect': { files: ['apps/Git.tsx'], apps: ['git'] },
  'git.prMerge': { files: ['apps/Git.tsx'], apps: ['git'] },
  'git.ignore': { files: ['apps/Git.tsx'], apps: ['git'] },
  'git.rewriteHistory': { files: ['apps/Git.tsx'], apps: ['git'] },
  'security.rotateSecret': { files: ['apps/Security.tsx'], apps: ['security'] },
  'security.setRole': { files: ['apps/Security.tsx'], apps: ['security'] },
  'security.upgradeDep': { files: ['apps/Security.tsx'], apps: ['security'] },
};

/** Terminal command that shows each kind of terminal evidence. */
const TERMINAL_CMD: Record<string, string> = { ports: 'ss -tlnp', redis: 'redis-cli info', git: 'git log', db: 'mysql -e "SHOW PROCESSLIST"' };

const content = loadContent();
let usage: Usage;

beforeAll(() => {
  usage = playCampaign(content).play.usage;
}, 300_000);

beforeEach(() => {
  cleanup();
  // jsdom has no layout
  Element.prototype.scrollIntoView = () => {};
  // @ts-expect-error test stub: no backend in jsdom
  global.fetch = () => Promise.reject(new Error('offline'));
  useWM.setState({ windows: [], focusedId: null, topZ: 10 });
});

function load(state: GameState) {
  const c = useGame.getState().content;
  const sim = simulate(state, c);
  useGame.setState({ state, sim, facts: computeFacts(state, c, sim), hydrated: true, modal: null });
}

function renderApp(id: string) {
  const App = APP_MAP[id].Component;
  return render(<App />);
}

function entries(prefix: string) {
  return [...usage.firstUse.entries()].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => ({ id: k.slice(prefix.length), ...v }));
}

/** Change a form control to a value different from the current one. */
function changeControl(el: Element) {
  if (el instanceof HTMLInputElement && el.type === 'checkbox') fireEvent.click(el);
  else if (el instanceof HTMLSelectElement) {
    const other = [...el.options].find((o) => o.value !== el.value);
    fireEvent.change(el, { target: { value: other!.value } });
  } else if (el instanceof HTMLInputElement && el.type === 'number') {
    const min = el.min === '' ? 0 : Number(el.min);
    const max = el.max === '' ? Number(el.value) + 10 : Number(el.max);
    fireEvent.change(el, { target: { value: String(Number(el.value) === max ? min : max) } });
  } else throw new Error(`unsupported control ${el.outerHTML.slice(0, 80)}`);
}

describe('campaign UI coverage', () => {
  it('every app a mission unlocks, links to or collects evidence in exists in PROD OS', () => {
    const unknown: string[] = [];
    for (const m of Object.values(content.missions)) {
      const apps = [...(m.unlocks?.apps ?? []), ...(m.evidence ?? []).map((e) => e.app), ...(m.ops ?? []).map((o) => o.app), ...(m.symptoms ?? []).map((s) => s.app)];
      for (const a of apps) if (!APP_MAP[a]) unknown.push(`${m.id}: ${a}`);
    }
    expect(unknown).toEqual([]);
  });

  it('every mission-required GameAction has a UI control in an app available at that moment', () => {
    const required = entries('action:');
    const missing: string[] = [];
    for (const { id, mission, apps } of required) {
      const ui = ACTION_UI[id];
      if (!ui) {
        missing.push(`${id} (first needed in ${mission}): no UI entry point known`);
        continue;
      }
      for (const f of ui.files) if (!source(f).includes(`type: '${id}'`)) missing.push(`${id}: ${f} never dispatches it`);
      if (ui.apps !== 'always' && !ui.apps.some((a) => apps.includes(a))) missing.push(`${id} needed in ${mission} but ${ui.apps.join('/')} is locked`);
    }
    if (missing.length) console.info(missing.join(String.fromCharCode(10)));
    console.info(`mission-required GameActions: ${required.length}, with UI: ${required.length - missing.length}, without UI: ${missing.length}`);
    expect(missing).toEqual([]);
  });

  it('every app setting has a home app, and every one the campaign needs can be changed there', () => {
    for (const s of content.settings) expect(SETTING_HOMES[s.key], `setting ${s.key} has no home app`).toBeTruthy();
    for (const apps of Object.values(SETTING_HOMES)) for (const a of apps) expect(APP_MAP[a], `unknown app ${a}`).toBeTruthy();

    const required = entries('setting:');
    const failed: string[] = [];
    for (const { id: key, mission, apps, state } of required) {
      const home = SETTING_HOMES[key].find((a) => apps.includes(a));
      if (!home) {
        failed.push(`${key} (${mission}): ${SETTING_HOMES[key].join('/')} locked`);
        continue;
      }
      cleanup();
      load(state);
      const view = renderApp(home);
      // Architecture keeps system-wide settings behind its "⚙ System" button
      if (home === 'architecture') act(() => fireEvent.click(view.getByText(/System/)));
      const control = view.container.querySelector(`[data-setting="${key}"] input, [data-setting="${key}"] select`);
      if (!control) {
        failed.push(`${key} (${mission}): no control in ${home}`);
        continue;
      }
      const before = JSON.stringify([state.world.app[key], state.world.deploy.pending[key]]);
      act(() => changeControl(control));
      const s2 = useGame.getState().state;
      if (JSON.stringify([s2.world.app[key], s2.world.deploy.pending[key]]) === before) failed.push(`${key} (${mission}): control in ${home} changed nothing`);
    }
    if (failed.length) console.info(failed.join(String.fromCharCode(10)));
    console.info(`mission-required settings: ${required.length}, with UI: ${required.length - failed.length}, without UI: ${failed.length}`);
    expect(failed).toEqual([]);
  }, 120_000);

  it('every node setting the campaign needs is editable in the Architecture inspector', () => {
    const required = entries('config:');
    const failed: string[] = [];
    for (const { id, mission, state } of required) {
      const [type, key] = id.split('.');
      const node = state.world.nodes.find((n) => n.type === type)!;
      cleanup();
      load(state);
      const view = renderApp('architecture');
      const card = view.container.querySelector(`[data-node="${node.id}"]`);
      if (!card) {
        failed.push(`${id} (${mission}): node not on the canvas`);
        continue;
      }
      act(() => fireEvent.pointerDown(card));
      const control = view.container.querySelector(`[data-config="${key}"] input, [data-config="${key}"] select`);
      if (!control) {
        failed.push(`${id} (${mission}): no field in the inspector`);
        continue;
      }
      act(() => changeControl(control));
      const after = useGame.getState().state.world.nodes.find((n) => n.id === node.id)!;
      if (after.config[key] === node.config[key]) failed.push(`${id} (${mission}): field changed nothing`);
    }
    console.info(`mission-required node settings: ${required.length}, with UI: ${required.length - failed.length}, without UI: ${failed.length}`);
    expect(failed).toEqual([]);
  }, 120_000);

  it('every kind of evidence the campaign needs can be pinned in its app', () => {
    const required = entries('pin:');
    const failed: string[] = [];
    for (const { id, mission, apps, state } of required) {
      const [app, kind] = id.split(':');
      if (!apps.includes(app)) {
        failed.push(`${id} (${mission}): ${app} locked`);
        continue;
      }
      cleanup();
      load(state);
      const pinned = () => useGame.getState().state.campaign.active?.pinned.length ?? 0;
      const before = pinned();
      const view = renderApp(app);
      if (app === 'api') {
        act(() => fireEvent.click(view.getByText('Send')));
      } else if (app === 'terminal') {
        const input = view.container.querySelector('input')!;
        act(() => fireEvent.change(input, { target: { value: TERMINAL_CMD[kind] } }));
        act(() => fireEvent.keyDown(input, { key: 'Enter' }));
      } else {
        if (app === 'architecture') act(() => fireEvent.click(view.getByText(/System/)));
        const btn = view.container.querySelector(`[data-pin^="${app}:${kind}:"]`);
        if (!btn) {
          failed.push(`${id} (${mission}): no pin control`);
          continue;
        }
        act(() => fireEvent.click(btn));
      }
      if (pinned() <= before) failed.push(`${id} (${mission}): nothing was pinned`);
    }
    if (failed.length) console.info(failed.join(String.fromCharCode(10)));
    console.info(`mission-required evidence kinds: ${required.length}, with UI: ${required.length - failed.length}, without UI: ${failed.length}`);
    expect(failed).toEqual([]);
  }, 120_000);
});

describe('new PROD OS controls dispatch the generic game actions', () => {
  const snapshot = (key: string) => usage.firstUse.get(key)!.state;

  it('Network issues and configures the (simulated) TLS certificate', () => {
    load(snapshot('action:tls.issue'));
    const view = renderApp('network');
    act(() => fireEvent.click(view.getByText(/Issue certificate/)));
    expect(useGame.getState().state.world.tls).toMatchObject({ enabled: true, issuer: 'letsencrypt' });
    act(() => fireEvent.click(view.getByLabelText(/Redirect HTTP/)));
    expect(useGame.getState().state.world.tls.redirectHttp).toBe(true);
  });

  it('Files publishes, optimizes and lazy-loads assets', () => {
    load(snapshot('action:files.publish'));
    let view = renderApp('files');
    act(() => fireEvent.click(view.getByText('index.html', { exact: false })));
    act(() => fireEvent.click(view.getByText('Publish to web root')));
    expect(useGame.getState().state.world.files.some((f) => f.path === '/var/www/html/index.html')).toBe(true);

    cleanup();
    load(snapshot('action:files.optimize'));
    view = renderApp('files');
    act(() => fireEvent.click(view.getByText(/hero\.png/)));
    act(() => fireEvent.click(view.getByText('Optimize')));
    expect(useGame.getState().state.world.files.find((f) => f.path === '/var/www/html/hero.png')?.optimized).toBe(true);
    act(() => fireEvent.click(view.getByLabelText('Lazy-load')));
    expect(useGame.getState().state.world.files.find((f) => f.path === '/var/www/html/hero.png')?.lazy).toBe(true);
  });

  it('Monitoring edits an alert rule', () => {
    load(snapshot('action:alerts.upsert'));
    const view = renderApp('monitoring');
    const row = view.container.querySelector('[data-alert="cpu-twitchy"]')!;
    act(() => fireEvent.change(row.querySelector('select[aria-label="Metric"]')!, { target: { value: 'errorRate' } }));
    act(() => fireEvent.click([...row.querySelectorAll('button')].find((b) => b.textContent === 'Save')!));
    expect(useGame.getState().state.world.observability.alertRules.find((r) => r.id === 'cpu-twitchy')?.metric).toBe('errorRate');
    act(() => fireEvent.click(view.getByText(/Add alert/)));
    expect(useGame.getState().state.world.observability.alertRules.length).toBe(2);
  });

  it('Runbooks saves a runbook for a trigger', () => {
    load(snapshot('action:runbook.save'));
    const view = renderApp('runbooks');
    act(() => fireEvent.change(view.getByLabelText('Trigger'), { target: { value: 'checkout-5xx' } }));
    act(() => fireEvent.click(view.getByLabelText('Roll back if a recent deploy correlates')));
    act(() => fireEvent.click(view.getByText('Save runbook')));
    expect(useGame.getState().facts['obs.runbook.checkout-5xx']).toBe(true);
  });

  it('Incident Manager sets the SLO', () => {
    load(snapshot('action:slo.set'));
    const view = renderApp('incidents');
    act(() => fireEvent.click(view.getByText('Save SLO')));
    expect(useGame.getState().state.world.observability.slo).not.toBeNull();
  });

  it('CI/CD adds a regression test that fails the PR it covers', () => {
    load(snapshot('action:ci.addTest'));
    const view = renderApp('cicd');
    act(() => fireEvent.change(view.getByLabelText('Endpoint'), { target: { value: 'checkout' } }));
    act(() => fireEvent.click(view.getByText('+')));
    const s = useGame.getState();
    expect(s.state.world.ci.tests.some((x) => x.id === 't-checkout' && x.covers === 'unit')).toBe(true);
    expect(s.facts['pr.11.checks']).toBe('failed');
  });

  it('Git creates a branch, commits, merges and ignores files (all simulated)', () => {
    load(snapshot('action:git.ignore'));
    const view = renderApp('git');
    const g = () => useGame.getState().state.world.git;
    act(() => fireEvent.change(view.getByLabelText('New branch'), { target: { value: 'feature/login' } }));
    act(() => fireEvent.click(view.getByText('New branch', { selector: 'button' })));
    expect(g().branches['feature/login']).toBeTruthy();
    expect(g().current).toBe('feature/login');
    const commits = g().commits.length;
    act(() => fireEvent.change(view.getByLabelText('Commit message'), { target: { value: 'Add login form' } }));
    act(() => fireEvent.click(view.getByText('Commit', { selector: 'button' })));
    expect(g().commits.length).toBe(commits + 1);
    act(() => fireEvent.click(view.getByText('main', { selector: 'button' })));
    act(() => fireEvent.change(view.getByLabelText('from'), { target: { value: 'feature/login' } }));
    act(() => fireEvent.change(view.getByLabelText('into'), { target: { value: 'feature/login' === 'main' ? 'x' : 'main' } }));
    const protectedMain = g().protection.requirePr;
    if (protectedMain) act(() => fireEvent.click(view.getByText(/require pull request/)));
    act(() => fireEvent.click(view.getByText('Merge', { selector: 'button' })));
    expect(g().commits.some((c) => c.parents.length === 2 && c.message.includes('feature/login'))).toBe(true);
    act(() => fireEvent.change(view.getByLabelText('.gitignore'), { target: { value: '.env' } }));
    act(() => fireEvent.click(view.getByText('Add', { selector: 'button' })));
    expect(g().gitignore).toContain('.env');
  });

  it('Architecture removes a connection and adds nodes in the chosen region', () => {
    load(snapshot('action:edge.disconnect'));
    let view = renderApp('architecture');
    act(() => fireEvent.pointerDown(view.container.querySelector('[data-node="web1"]')!));
    const link = view.container.querySelector('[data-edge="web1>backend-1"]')!;
    act(() => fireEvent.click(link.querySelector('button')!));
    expect(useGame.getState().state.world.edges.some((e) => e.id === 'web1>backend-1')).toBe(false);

    cleanup();
    load(usage.firstUse.get('action:node.add')!.state);
    const late = [...usage.firstUse.values()].find((u) => u.state.world.regions.length > 1)!.state;
    load(late);
    view = renderApp('architecture');
    act(() => fireEvent.change(view.getByLabelText('Region for new components'), { target: { value: 'us' } }));
    const before = useGame.getState().state.world.nodes.length;
    act(() => fireEvent.click(view.getAllByText('Backend')[0]));
    const added = useGame.getState().state.world.nodes.slice(before)[0];
    expect(added.type).toBe('backend');
    expect(added.region).toBe('us');

    // Arrange lays every node out below the toolbar without overlaps
    act(() => fireEvent.click(view.getByText(/Arrange/)));
    const nodes = useGame.getState().state.world.nodes;
    expect(nodes.every((n) => n.pos.y >= 60)).toBe(true);
    expect(new Set(nodes.map((n) => `${n.pos.x},${n.pos.y}`)).size).toBe(nodes.length);
  });

  it('new nodes never stack on each other or under the canvas toolbar', () => {
    useGame.getState().resetGame();
    const s = useGame.getState();
    expect(s.state.world.nodes.every((n) => n.pos.y >= 60)).toBe(true);
    useGame.setState({ state: { ...s.state, unlocks: { ...s.state.unlocks, components: [...s.state.unlocks.components, 'backend', 'mysql'] } } });
    useGame.getState().dispatch({ type: 'node.add', nodeType: 'backend' });
    useGame.getState().dispatch({ type: 'node.add', nodeType: 'mysql' });
    const nodes = useGame.getState().state.world.nodes;
    expect(new Set(nodes.map((n) => `${n.pos.x},${n.pos.y}`)).size).toBe(nodes.length);
  });
});
