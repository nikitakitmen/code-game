/**
 * A scripted player for the whole campaign. It plays every mission only through the public
 * game API — the same calls the PROD OS UI makes (reduce / startMission / performOp /
 * chooseHypothesis / chooseDialogue / runAttackLab / recordSimulation / completeMission) —
 * and pins only evidence that an app actually shows (pinsFor / callApi / runCommand).
 *
 * It is the campaign reachability proof (playthrough.test.ts) and, through `usage`, the list
 * of player actions the UI must offer (apps/web/test/ui-coverage.test.tsx).
 */
import {
  callApi,
  chooseDialogue,
  chooseHypothesis,
  completeMission,
  computeFacts,
  isWorldAction,
  objectiveStatus,
  performOp,
  pinsFor,
  recordSimulation,
  reduce,
  runAttackLab,
  runCommand,
  sameToken,
  simulate,
  startMission,
  newGame,
  type ApiRequest,
  type ContentBundle,
  type EvidenceToken,
  type GameAction,
  type GameState,
  type HttpMethod,
  type SimResult,
} from '@prod/engine';

export interface Usage {
  /** GameAction types dispatched (what UI controls must exist) */
  actions: Set<string>;
  /** app.set keys */
  settings: Set<string>;
  /** node.config "<type>.<key>" */
  nodeConfig: Set<string>;
  /** evidence "<app>:<kind>" */
  pins: Set<string>;
  apiCalls: number;
  commands: Set<string>;
  ops: Set<string>;
  hypotheses: number;
  dialogue: number;
  attacks: Set<string>;
  /**
   * First use of each player action, keyed "action:<type>", "setting:<key>", "config:<nodeType>.<key>",
   * "pin:<app>:<kind>": the mission, the apps unlocked then and the game state just before it.
   */
  firstUse: Map<string, { mission: string; apps: string[]; state: GameState }>;
}

export class PlaythroughError extends Error {}

export class Play {
  s: GameState;
  private simCache: SimResult | null = null;
  private simFor: GameState | null = null;
  readonly usage: Usage = { actions: new Set(), settings: new Set(), nodeConfig: new Set(), pins: new Set(), apiCalls: 0, commands: new Set(), ops: new Set(), hypotheses: 0, dialogue: 0, attacks: new Set(), firstUse: new Map() };
  readonly log: string[] = [];

  constructor(readonly content: ContentBundle, seed: number) {
    this.s = newGame(content, seed);
  }

  /** The latest simulation of the current state (what the apps show). */
  get sim(): SimResult {
    if (!this.simCache || this.simFor !== this.s) {
      this.simCache = simulate(this.s, this.content);
      this.simFor = this.s;
    }
    return this.simCache;
  }

  set sim(v: SimResult) {
    this.simCache = v;
    this.simFor = this.s;
  }

  get missionId(): string {
    const id = this.s.campaign.active?.id;
    if (!id) throw new PlaythroughError('no active mission');
    return id;
  }

  private fail(msg: string): never {
    throw new PlaythroughError(`[${this.s.campaign.active?.id ?? this.s.campaign.currentMissionId}] ${msg}`);
  }

  private keys(events: { key: string; params?: Record<string, string | number> }[]) {
    return events.map((e) => `${e.key}${e.params ? JSON.stringify(e.params) : ''}`).join(', ');
  }

  private note(key: string) {
    if (this.usage.firstUse.has(key)) return;
    this.usage.firstUse.set(key, { mission: this.s.campaign.active?.id ?? '-', apps: [...this.s.unlocks.apps], state: this.s });
  }

  /** A UI control dispatching a GameAction (the store keeps the old simulation for meta actions). */
  do(a: GameAction): this {
    this.note(`action:${a.type}`);
    if (a.type === 'app.set') this.note(`setting:${a.key}`);
    if (a.type === 'node.config') this.note(`config:${this.s.world.nodes.find((x) => x.id === a.id)?.type}.${a.key}`);
    if (a.type === 'mission.pin') this.note(`pin:${a.token.app}:${a.token.kind}`);
    const r = reduce(this.s, a, this.content);
    if (!r.ok) this.fail(`${a.type} rejected: ${this.keys(r.events)}`);
    this.usage.actions.add(a.type);
    if (a.type === 'app.set') this.usage.settings.add(a.key);
    if (a.type === 'node.config') {
      const n = this.s.world.nodes.find((x) => x.id === a.id);
      this.usage.nodeConfig.add(`${n?.type}.${a.key}`);
    }
    const keep = !isWorldAction(a) && this.simCache && this.simFor === this.s ? this.simCache : null;
    this.s = r.state;
    if (keep) this.sim = keep;
    this.log.push(`${a.type} ${JSON.stringify(a).slice(0, 120)}`);
    return this;
  }

  setApp(key: string, value: string | number | boolean): this {
    return this.do({ type: 'app.set', key, value });
  }

  config(nodeId: string, key: string, value: string | number | boolean): this {
    return this.do({ type: 'node.config', id: nodeId, key, value });
  }

  add(nodeType: string, opts: { region?: 'eu' | 'us' | 'ap'; name?: string } = {}): string {
    const before = new Set(this.s.world.nodes.map((n) => n.id));
    this.do({ type: 'node.add', nodeType, ...opts });
    const added = this.s.world.nodes.find((n) => !before.has(n.id));
    if (!added) this.fail(`node.add ${nodeType} added nothing`);
    return added.id;
  }

  connect(from: string, to: string): this {
    return this.do({ type: 'edge.connect', from, to });
  }

  /** Mission-dock button. */
  op(id: string): this {
    const r = performOp(this.s, this.content, id, this.sim);
    if (!r.ok) this.fail(`op ${id} rejected: ${this.keys(r.events)}`);
    this.usage.ops.add(`${this.missionId}:${id}`);
    this.s = r.state;
    return this;
  }

  /** "📌 Pin" in an investigation app — only what that app currently shows. */
  pin(app: string, kind: string, key?: string | ((k: string) => boolean)): this {
    const shown = pinsFor(app, this.s, this.content, this.sim).filter((t) => t.kind === kind);
    const token = shown.find((t) => key === undefined || (typeof key === 'string' ? t.key === key : key(t.key)));
    if (!token) this.fail(`${app} shows no ${kind} evidence ${typeof key === 'string' ? key : ''} (shown: ${shown.map((t) => t.key).join(',') || 'none'})`);
    return this.pinToken(token);
  }

  private pinToken(token: EvidenceToken): this {
    if (!this.s.unlocks.apps.includes(token.app)) this.fail(`evidence is in ${token.app}, which is still locked`);
    if (!pinsFor(token.app, this.s, this.content, this.sim).some((t) => sameToken(t, token)) && !['api', 'terminal'].includes(token.app)) this.fail(`token not shown: ${JSON.stringify(token)}`);
    this.usage.pins.add(`${token.app}:${token.kind}`);
    return this.do({ type: 'mission.pin', token });
  }

  /** API Inspector: send a request; pin the response. */
  api(endpointPrefix: string, req: Partial<ApiRequest> = {}): this {
    const ep = this.s.world.endpoints.find((e) => e.id.startsWith(endpointPrefix) && !e.disabled && e.target === 'backend');
    if (!ep) this.fail(`API Inspector lists no endpoint ${endpointPrefix}`);
    const res = callApi(this.s, this.content, this.sim, { method: ep.method as HttpMethod, path: ep.path, auth: 'user', body: 'none', origin: 'same', ...req });
    this.usage.apiCalls += 1;
    if (!res.pin) this.fail('API response has no pin');
    return this.pinToken(res.pin);
  }

  /** Terminal: run a command; pin its output when it can be pinned. */
  term(cmd: string): this {
    const out = runCommand(cmd, this.s, this.content, this.sim);
    if (out.error) this.fail(`terminal "${cmd}": ${out.lines.join(' ')}`);
    this.usage.commands.add(cmd.split(' ')[0]);
    if (out.pin) this.pinToken(out.pin);
    return this;
  }

  hyp(id: string): this {
    const r = chooseHypothesis(this.s, this.content, id);
    if (!r.ok) this.fail(`hypothesis ${id} rejected: ${this.keys(r.events)}`);
    this.usage.hypotheses += 1;
    this.s = r.state;
    return this;
  }

  /** Answer an NPC dialogue in Mail. */
  say(dialogueId: string, choiceId: string): this {
    const r = chooseDialogue(this.s, this.content, dialogueId, choiceId);
    if (!r.ok) this.fail(`dialogue ${dialogueId}/${choiceId} rejected: ${this.keys(r.events)}`);
    this.usage.dialogue += 1;
    this.s = r.state;
    return this;
  }

  attack(id: string, expectBlocked = true): this {
    const r = runAttackLab(this.s, this.content, id, this.sim);
    if (!r.ok) this.fail(`attack ${id} rejected: ${this.keys(r.events)}`);
    this.usage.attacks.add(id);
    this.s = r.state;
    if (expectBlocked && this.s.attackResults[id].success) this.fail(`attack ${id} was expected to be blocked`);
    return this;
  }

  /** CI/CD "Deploy": ship pending code changes. A regression that slips through is rolled back and shipped again. */
  deploy(strategy: 'all' | 'canary' = 'all', percent = 10): this {
    const d = this.s.world.deploy;
    if (!Object.keys(d.pending).length && !d.pendingFixes.length && !d.pendingBugs.length) return this;
    for (let attempt = 0; attempt < 6; attempt++) {
      const pending = { ...this.s.world.deploy.pending };
      const before = new Set(this.s.world.bugs.map((b) => b.id));
      this.do({ type: 'deploy.run', strategy, percent });
      const regression = this.s.world.bugs.find((b) => !before.has(b.id) && b.id.startsWith('regression-') && !b.fixed);
      if (!regression || strategy === 'canary') return this;
      this.log.push(`regression ${regression.id}: rollback and redeploy`);
      this.do({ type: 'deploy.rollback' });
      for (const [k, v] of Object.entries(pending)) if (!k.startsWith('dep:')) this.setApp(k, v as string);
      if (!Object.keys(this.s.world.deploy.pending).length && !this.s.world.deploy.pendingFixes.length) return this;
    }
    this.fail('deploy keeps regressing');
  }

  /** Mission dock "Next ▶": start the current mission and run the first simulation (as the store does). */
  start(): this {
    const id = this.s.campaign.currentMissionId;
    if (!id) this.fail('campaign has no current mission');
    const r = startMission(this.s, this.content, id);
    if (!r.ok) this.fail(`start ${id}: ${this.keys(r.events)}`);
    const skipped = r.events.filter((e) => e.key === 'toast.effectSkipped');
    if (skipped.length) this.fail(`mission setup effects could not be applied (${skipped.length})`);
    this.s = r.state;
    const sim = this.sim;
    this.s = recordSimulation(this.s, this.content, sim).state;
    this.sim = sim;
    return this;
  }

  /** "▷ Run simulation" + "Complete mission". */
  complete(): this {
    const sim = this.sim;
    const rec = recordSimulation(this.s, this.content, sim).state;
    const status = objectiveStatus(rec, this.content, sim);
    if (!status.every((o) => o.met)) {
      const mission = this.content.missions[this.missionId];
      const facts = computeFacts(rec, this.content, sim) as Record<string, unknown>;
      const unmet = status.filter((o) => !o.met).map((o) => {
        const def = mission.objectives.find((x) => x.id === o.id)!;
        const refs = JSON.stringify(def.check).match(/"fact":"[^"]+"/g)?.map((x) => x.slice(8, -1)) ?? [];
        const eps = [...new Set(refs.filter((f) => f.startsWith('ep.')).map((f) => f.split('.')[1]))];
        const stages = (id: string) => (sim.traces.find((t) => t.endpointId === id && t.sample === 'slow') ?? sim.traces.find((t) => t.endpointId === id))?.stages.map((st) => `${st.label.slice(0, 28)}=${st.durationMs}`).join(' | ');
        const detail = eps.map((id) => `${id} errors=${JSON.stringify(sim.endpoints[id]?.errors)} p95=${sim.endpoints[id]?.p95} [${stages(id)}]`).join('; ');
        const global = refs.some((f) => f.startsWith('m.')) ? ` worst=${JSON.stringify(Object.values(sim.endpoints).filter((e) => e.errorRate > 0.005).map((e) => `${e.id}:${e.errorRate}:${Object.keys(e.errors).filter((k) => (e.errors as Record<string, number>)[k] > 0.001).join('/')}`))}` : '';
        return `${o.id} ${JSON.stringify(def.check)} → ${refs.map((f) => `${f}=${JSON.stringify(facts[f])}`).join(' ')} ${detail}${global}`;
      });
      this.fail(`objectives not met:\n  ${unmet.join('\n  ')}`);
    }
    this.s = rec;
    this.sim = sim;
    const r = completeMission(rec, this.content, sim);
    if (!r.ok) this.fail(`complete: ${this.keys(r.events)}`);
    this.s = r.state;
    return this;
  }

  fact(name: string): unknown {
    return computeFacts(this.s, this.content, this.sim)[name];
  }
}

/** An app server in a region, wired to that region's replica, cache and queue (and to shared services). */
function addRegionBackend(p: Play, region: 'us' | 'ap'): string {
  const be = addBackend(p, region);
  p.config(be, 'poolSize', 60);
  const local = (type: string) => p.s.world.nodes.find((n) => n.type === type && n.region === region)!.id;
  for (const far of ['replica-1', 'replica-2', 'redis-1', 'queue-1']) p.do({ type: 'edge.disconnect', from: be, to: far });
  p.connect(be, local('replica')).connect(be, local('redis')).connect(be, local('queue'));
  return be;
}

/** A regional point of presence: proxy + load balancer + read replica + cache + queue/worker + app servers. */
function addRegion(p: Play, region: 'us' | 'ap', servers: number) {
  const ng = p.add('nginx', { region });
  p.config(ng, 'gzip', true).config(ng, 'http2', true).config(ng, 'cacheHeaders', true);
  const lb = p.add('lb', { region });
  p.connect('users', ng).connect(ng, lb);
  const rep = p.add('replica', { region });
  p.do({ type: 'node.resize', id: rep, size: '2xl' }).config(rep, 'maxConnections', 600).connect('mysql-1', rep);
  const redis = p.add('redis', { region });
  p.config(redis, 'memoryMb', 1024);
  const queue = p.add('queue', { region });
  const worker = p.add('worker', { region });
  p.connect(queue, worker).config(worker, 'concurrency', 16).do({ type: 'node.resize', id: worker, size: 'xl' });
  for (let i = 0; i < servers; i++) addRegionBackend(p, region);
}

type Step = (p: Play) => void;

/** Architecture: one more app server behind the load balancer, wired to everything the first one uses. */
function addBackend(p: Play, region?: 'eu' | 'us' | 'ap'): string {
  const be = p.add('backend', region ? { region } : {});
  p.do({ type: 'node.resize', id: be, size: '2xl' });
  const lb = p.s.world.nodes.find((n) => n.type === 'lb' && (!region || n.region === region))?.id ?? 'lb-1';
  p.connect(lb, be);
  const deps = p.s.world.edges.filter((e) => e.from === 'backend-1').map((e) => e.to);
  for (const dep of deps) p.connect(be, dep);
  return be;
}

/** One solution path per mission, expressed as player actions. */
export const PLAYBOOK: Record<string, Step> = {
  m001: (p) => p.do({ type: 'app.open', app: 'project' }).do({ type: 'mail.read', id: 'm001-t' }),
  m002: (p) => p.do({ type: 'company.setName', name: 'Acme Shop' }),
  m003: (p) => {
    for (const f of ['index.html', 'style.css', 'logo.png']) p.do({ type: 'files.publish', path: `/home/dev/${f}` });
  },
  m004: () => {},
  m005: (p) => p.pin('inspector', 'request', 'home'),
  m006: (p) => p.term('ss').hyp('h2').do({ type: 'node.port', id: 'web1', port: 80, open: true }),
  m007: (p) => {
    const be = p.add('backend');
    p.connect('web1', be);
  },
  m008: (p) => p.pin('inspector', 'request', 'catalog'),
  m009: (p) => {
    const db = p.add('mysql');
    p.connect('backend-1', db).setApp('dataSource', 'mysql');
  },
  m010: (p) => p.op('create'),
  m011: (p) => p.pin('database', 'schema', 'users.password_hash').setApp('passwordStorage', 'bcrypt').setApp('inputValidation', true),
  m012: (p) => p.setApp('authErrors', 'generic'),
  m013: (p) => p.pin('inspector', 'request', 'account').hyp('h1').setApp('authMode', 'session').setApp('cookieHttpOnly', true),
  m014: (p) => p.api('admin_products').hyp('h1').setApp('adminRoleCheck', true),
  m015: (p) => p.api('api_catalog', { origin: 'other' }).setApp('cors', 'origin'),
  m016: (p) => p.api('api_catalog'),
  m017: (p) => p.pin('logs', 'log', 'ANOMALY_CRAWLERDELETES').hyp('h1').setApp('deleteMethod', 'DELETE'),
  m018: (p) => p.api('api_catalog', { body: 'invalid' }).hyp('h1').setApp('apiStatusCodes', 'proper'),
  m019: (p) => p.api('api_catalog').hyp('h1').op('revert'),
  m020: (p) => p.setApp('apiVersioning', 'url').setApp('apiContract', true),
  m021: (p) =>
    p
      .do({ type: 'dns.setDomain', domain: 'acme.shop' })
      .do({ type: 'dns.setRecord', record: { id: '@-A', type: 'A', name: '@', value: '203.0.113.10', ttl: 3600 } })
      .do({ type: 'dns.setRecord', record: { id: 'www-A', type: 'A', name: 'www', value: '203.0.113.10', ttl: 3600 } }),
  m022: (p) => p.do({ type: 'dns.setRecord', record: { id: '@-TXT', type: 'TXT', name: '@', value: 'prod-verify=ok', ttl: 3600 } }),
  m023: (p) =>
    p
      .pin('dns', 'dns', '@:A')
      .hyp('h1')
      // lower the TTL first, then point the records at the new server and wait out the old TTL
      .do({ type: 'dns.setRecord', record: { id: '@-A', type: 'A', name: '@', value: '203.0.113.10', ttl: 300 } })
      .do({ type: 'dns.setRecord', record: { id: '@-A', type: 'A', name: '@', value: '203.0.113.11', ttl: 300 } })
      .do({ type: 'dns.setRecord', record: { id: 'www-A', type: 'A', name: 'www', value: '203.0.113.11', ttl: 300 } })
      .op('wait'),
  m024: (p) => p.do({ type: 'tls.issue', issuer: 'letsencrypt' }).do({ type: 'tls.configure', patch: { redirectHttp: true, hsts: true, autoRenew: true } }).pin('network', 'tls', 'ok'),
  m025: (p) => p.config('web1', 'gzip', true).config('web1', 'http2', true),
  m026: (p) => {
    const st = p.add('storage');
    p.connect('backend-1', st).setApp('uploadsTarget', 'object-storage');
  },
  m027: (p) => p.pin('monitoring', 'metric', 'cpu.backend').do({ type: 'node.resize', id: 'backend-1', size: 'l' }),
  m028: (p) => p.pin('logs', 'log', 'SLOW_QUERY').pin('database', 'explain', 'products:ALL').hyp('h1'),
  m029: (p) => p.do({ type: 'db.createIndex', table: 'products', columns: ['category_id', 'created_at'] }),
  m030: (p) =>
    p
      .pin('inspector', 'request', 'home')
      .do({ type: 'files.optimize', path: '/var/www/html/hero.png' })
      .do({ type: 'files.optimize', path: '/var/www/html/banner.png' })
      .do({ type: 'files.lazy', path: '/var/www/html/banner.png', lazy: true }),
  m031: (p) => {
    const redis = p.add('redis');
    p.connect('backend-1', redis)
      .do({ type: 'cache.rule', endpoint: 'catalog', enabled: true, ttl: 60 })
      .do({ type: 'cache.rule', endpoint: 'api_catalog', enabled: true, ttl: 60 });
  },
  m032: (p) => p.do({ type: 'cache.rule', endpoint: 'catalog', enabled: true, ttl: 300 }).do({ type: 'cache.rule', endpoint: 'api_catalog', enabled: true, ttl: 300 }),
  m033: (p) => p.pin('logs', 'log', 'ANOMALY_STALEREADS').hyp('h1').setApp('cacheInvalidation', 'on-write'),
  m034: (p) => p.term('redis-cli info').hyp('h1').config('redis-1', 'memoryMb', 1024),
  m035: (p) => p.pin('inspector', 'request', 'checkout').hyp('h1'),
  m036: (p) => {
    const q = p.add('queue');
    const wk = p.add('worker');
    p.connect('backend-1', q).connect(q, wk).setApp('asyncEmail', true).setApp('asyncInvoice', true);
    // checkout charges cards through the payment provider and sends mail through the mail provider
    p.connect('backend-1', p.add('payment')).connect('backend-1', p.add('mail'));
  },
  m037: (p) => p.pin('queue', 'queue', 'default').config('worker-1', 'concurrency', 8).do({ type: 'node.resize', id: 'worker-1', size: 'xl' }).do({ type: 'node.resize', id: 'backend-1', size: 'xl' }),
  m038: (p) => {
    // separate queues; the newsletter gets its own worker, order emails keep theirs
    p.pin('queue', 'queue').hyp('h1').setApp('queueSeparation', true).config('worker-1', 'queues', 'critical');
    const bulk = p.add('worker');
    p.connect('queue-1', bulk).config(bulk, 'queues', 'bulk').config(bulk, 'concurrency', 16).do({ type: 'node.resize', id: bulk, size: 'xl' });
  },
  m039: (p) => p.pin('logs', 'log', 'JOB_FAILED').hyp('h1').setApp('retryPolicy', 'exponential').setApp('maxRetries', 4).setApp('deadLetterQueue', true).setApp('retryJitter', true),
  m040: (p) => p.pin('logs', 'log', 'ANOMALY_DOUBLECHARGES').hyp('h1').setApp('paymentIdempotency', true).setApp('jobIdempotency', true),
  m041: (p) => p.do({ type: 'git.init' }),
  m042: (p) => p.do({ type: 'git.resolve', resolution: 'theirs' }),
  m043: (p) => p.pin('cicd', 'log', 'NULLREF').hyp('h1').do({ type: 'deploy.rollback' }).do({ type: 'git.protect', requirePr: true, requireReview: true }),
  m044: (p) =>
    p
      .do({ type: 'ci.enable', enabled: true })
      .do({ type: 'ci.stage', stage: 'lint', enabled: true })
      .do({ type: 'ci.stage', stage: 'unit', enabled: true })
      .do({ type: 'ci.stage', stage: 'build', enabled: true })
      .do({ type: 'git.protect', requireChecks: true }),
  m045: (p) => p.do({ type: 'ci.addTest', id: 't-checkout', covers: 'unit', label: { en: 'Checkout handles missing field', ru: 'Оформление переживает отсутствующее поле' } }),
  m046: (p) => p.say('d', 'c1'),
  m047: (p) => {
    // three safe releases, each shipping a real improvement
    p.setApp('cacheFailOpen', true).deploy();
    p.setApp('retryJitter', false).deploy();
    p.setApp('retryJitter', true).deploy();
  },
  m048: (p) => p.do({ type: 'git.prMerge', id: 12 }).deploy('canary', 10),
  m049: (p) => p.do({ type: 'flag.set', id: 'wishlist', enabled: true, rollout: 10 }).do({ type: 'deploy.rollback' }),
  m050: (p) => {
    const logs = p.add('logs');
    p.connect('backend-1', logs).setApp('requestIds', true).deploy();
  },
  m051: (p) => p.pin('logs', 'log', 'MYSTERY'),
  m052: (p) => p.pin('logs', 'log', 'MYSTERY').op('fix').deploy().do({ type: 'db.createIndex', table: 'orders', columns: ['user_id'] }),
  m053: (p) => p.pin('traces', 'request', 'account').hyp('h1').op('eager').deploy(),
  m054: (p) =>
    p
      .pin('monitoring', 'alert', 'cpu.backend')
      .hyp('h1')
      .do({ type: 'alerts.upsert', rule: { id: 'cpu-twitchy', metric: 'errorRate', op: '>', threshold: 5, forMinutes: 5, severity: 'page', enabled: true } }),
  m055: (p) =>
    p
      .pin('logs', 'log')
      .do({ type: 'incident.declare', id: 'inc-101', severity: 'SEV2' })
      .do({ type: 'incident.order', id: 'inc-101', order: ['ev1', 'ev2', 'ev3', 'ev4'] }),
  m056: (p) =>
    p
      .do({ type: 'postmortem.answer', incidentId: 'inc-101', key: 'rootCause', value: 'Deploy v7 exhausted DB connections' })
      .do({ type: 'postmortem.answer', incidentId: 'inc-101', key: 'action', value: 'Canary releases and a connection alert' })
      .do({ type: 'postmortem.submit', incidentId: 'inc-101' }),
  m057: (p) =>
    p.do({
      type: 'runbook.save',
      runbook: { id: 'rb-checkout', title: 'Checkout 502s', trigger: 'checkout-5xx', steps: ['Check the latest release in CI/CD', 'Roll back if a recent deploy correlates', 'Check DB connections', 'Declare an incident if not resolved in 10 min'] },
    }),
  m058: (p) => p.do({ type: 'slo.set', slo: { availability: 0.99, latencyMs: 800, slaAvailability: 0.98, freezeOnBudgetExhausted: true } }),
  m059: (p) => p.pin('security', 'schema', 'users.password_hash').hyp('h1').setApp('passwordStorage', 'bcrypt').setApp('loginRateLimit', true).deploy(),
  m060: (p) => p.attack('bruteforce'),
  m061: (p) => p.pin('security', 'vuln', 'sqli').hyp('h1').setApp('queryMode', 'parameterized').deploy().attack('sqli'),
  m062: (p) => p.pin('security', 'vuln', 'xss').hyp('h1').setApp('outputEscaping', true).setApp('csp', true).deploy().attack('xss'),
  m063: (p) => p.pin('security', 'vuln', 'csrf').hyp('h1').setApp('csrfProtection', 'token').deploy().attack('csrf'),
  m064: (p) => p.api('order_view', { auth: 'other-user' }).hyp('h1').setApp('ownershipChecks', true).deploy().attack('idor'),
  m065: (p) => p.pin('logs', 'log', 'ACCESS').hyp('h1').setApp('lockout', 'backoff').deploy(),
  m066: (p) => p.term('ss -tlnp').hyp('h1').attack('exposed-db'),
  m067: (p) =>
    p
      .term('git log')
      .hyp('h1')
      .do({ type: 'security.rotateSecret', id: 'app-env' })
      .do({ type: 'git.ignore', entry: '.env' })
      .do({ type: 'git.rewriteHistory' })
      .attack('secret-in-git'),
  m068: (p) => p.pin('security', 'vuln', 'unsafeUpload').hyp('h1').setApp('uploadValidation', true).setApp('uploadsTarget', 'object-storage').deploy().attack('upload-rce'),
  m069: (p) => p.pin('security', 'vuln', 'vulnerableDependency').hyp('h1').do({ type: 'security.upgradeDep', name: 'image-resize' }).deploy(),
  m070: (p) =>
    p
      .pin('security', 'vuln', 'ssrf')
      .setApp('ssrfProtection', true)
      .deploy()
      .do({ type: 'security.setRole', employee: 'lev', role: 'developer' })
      .do({ type: 'security.setRole', employee: 'sonya', role: 'support' })
      .do({ type: 'security.setRole', employee: 'intern', role: 'marketing' }),
  m071: (p) => p.do({ type: 'node.resize', id: 'backend-1', size: '2xl' }).do({ type: 'node.resize', id: 'mysql-1', size: '2xl' }),
  m072: (p) => p.pin('monitoring', 'metric', 'cpu.backend').hyp('h1'),
  m073: (p) => {
    const lb = p.add('lb');
    p.do({ type: 'edge.disconnect', from: 'web1', to: 'backend-1' }).connect('web1', lb).connect(lb, 'backend-1');
    // each app server has a 10-connection DB pool: spread the load
    addBackend(p);
    addBackend(p);
  },
  m074: (p) => {
    addBackend(p);
    addBackend(p);
  },
  m075: (p) => p.pin('logs', 'log', 'SESSION_LOST').hyp('h1'),
  m076: (p) => p.setApp('sessionStore', 'redis').deploy(),
  m077: (p) => {
    p.pin('monitoring', 'metric', 'cpu.database');
    const rep = p.add('replica');
    p.do({ type: 'node.resize', id: rep, size: '2xl' }).connect('mysql-1', rep);
    for (const be of p.s.world.nodes.filter((n) => n.type === 'backend')) p.connect(be.id, rep);
    p.setApp('readRouting', 'replica').deploy();
  },
  m078: (p) => {
    // with five app servers the 151 connections are not exhausted in this world (PROCESSLIST shows "ok"),
    // so there is no "too many connections" evidence and no hypothesis to pick; pooling still pays off
    p.term('mysql -e "SHOW PROCESSLIST"').config('mysql-1', 'pooler', true).config('mysql-1', 'maxConnections', 600).config('replica-1', 'maxConnections', 600);
    for (const be of p.s.world.nodes.filter((n) => n.type === 'backend')) p.config(be.id, 'poolSize', 60);
    // the search scans keep one replica saturated: add a second one for reads
    const rep = p.add('replica');
    p.do({ type: 'node.resize', id: rep, size: '2xl' }).config(rep, 'maxConnections', 600).connect('mysql-1', rep);
    for (const be of p.s.world.nodes.filter((n) => n.type === 'backend')) p.connect(be.id, rep);
  },
  m079: (p) => p.pin('logs', 'log', 'ANOMALY_OVERSOLD').hyp('h1').setApp('inventoryUpdate', 'atomic').deploy(),
  m080: (p) => p.pin('logs', 'log', 'DB_DEADLOCK').hyp('h1').setApp('lockOrdering', 'consistent').deploy(),
  m081: (p) => p.pin('logs', 'log', 'ANOMALY_DUPLICATEFULFILLMENTS').hyp('h1').setApp('webhookIdempotency', true).setApp('webhookAsync', true).deploy(),
  m082: (p) => p.pin('logs', 'log', 'ANOMALY_STALEREADS').hyp('h1').setApp('readRouting', 'read-your-writes').deploy(),
  m083: (p) => {
    // a payments service: its own app server, at first still talking to the shared database
    const pay = addBackend(p);
    p.config(pay, 'service', 'payments');
  },
  m084: (p) => {
    p.pin('architecture', 'schema', (k) => k.startsWith('orders')).hyp('h1');
    const pay = p.s.world.nodes.find((n) => n.type === 'backend' && n.config.service === 'payments')!.id;
    const db = p.add('mysql');
    p.do({ type: 'edge.disconnect', from: pay, to: 'mysql-1' }).connect(pay, db);
  },
  m085: (p) => p.pin('traces', 'request', 'product_page').hyp('h1').setApp('fallbacks', true).setApp('providerTimeoutMs', 800).deploy(),
  m086: (p) => p.pin('monitoring', 'metric', 'amplification').hyp('h1').setApp('circuitBreaker', true).setApp('retries', 2).deploy(),
  m087: (p) =>
    p
      .do({ type: 'ci.stage', stage: 'contract', enabled: true })
      .do({ type: 'ci.addTest', id: 't-contract', covers: 'contract', label: { en: 'Payments ↔ orders contract', ru: 'Контракт платежи ↔ заказы' } }),
  m088: (p) => p.pin('logs', 'log', 'ANOMALY_LOSTEVENTS').hyp('h1').setApp('outbox', true).deploy(),
  m089: (p) => p.pin('network', 'metric', (k) => k.startsWith('p95')).do({ type: 'region.add', region: 'us' }).do({ type: 'region.add', region: 'ap' }),
  m090: (p) => p.pin('network', 'metric', (k) => k.startsWith('p95')),
  m091: (p) => {
    const cdn = p.add('cdn');
    p.config(cdn, 'edges', 'eu,us,ap').connect('users', cdn).connect(cdn, 'web1');
    // repeat visitors reuse cached assets; the remaining image gets optimized too
    p.config('web1', 'cacheHeaders', true).do({ type: 'files.optimize', path: '/var/www/html/logo.png' });
  },
  m092: (p) => {
    // a US point of presence; ~35% of the traffic is American: three app servers there
    addRegion(p, 'us', 3);
    // GeoDNS sends US users to the US entry; re-issuing the certificate covers the new proxy (443)
    p.do({ type: 'dns.configure', geoRouting: true }).do({ type: 'tls.issue', issuer: 'letsencrypt' });
  },
  m093: (p) => p.pin('monitoring', 'metric', 'p95').hyp('h1'),
  m094: (p) => {
    // health-checked DNS failover; the US replica takes over writes when the EU primary is gone
    p.do({ type: 'dns.configure', failover: true }).config('replica-3', 'promoteOnFailure', true);
    // a short TTL so resolvers follow the failover quickly
    p.do({ type: 'dns.setRecord', record: { id: '@-A', type: 'A', name: '@', value: '203.0.113.11', ttl: 60 } });
    p.do({ type: 'dns.setRecord', record: { id: 'www-A', type: 'A', name: 'www', value: '203.0.113.11', ttl: 60 } });
    // the standby region must carry everyone during an outage
    for (let i = 0; i < 6; i++) addRegionBackend(p, 'us');
    const worker = p.add('worker', { region: 'us' });
    p.connect('queue-2', worker).config(worker, 'concurrency', 16).do({ type: 'node.resize', id: worker, size: 'xl' });
  },
  m095: (p) => p.say('d', 'c1'),
  m096: (p) => {
    p.pin('monitoring', 'metric', 'errorRate').hyp('h1').op('warm').op('breaker').deploy();
    // absorb the spike: every app server may scale out
    const backends = p.s.world.nodes.filter((n) => n.type === 'backend' && n.config.service !== 'payments');
    for (const be of backends) p.config(be.id, 'autoscale', true).config(be.id, 'maxInstances', 8);
    // the front doors and the read path must take ×5 traffic too
    for (const proxy of p.s.world.nodes.filter((n) => n.type === 'nginx')) p.do({ type: 'node.resize', id: proxy.id, size: '2xl' });
    for (const region of ['eu', 'us'] as const) {
      for (let i = 0; i < 2; i++) {
        const rep = p.add('replica', { region });
        p.do({ type: 'node.resize', id: rep, size: '2xl' }).connect('mysql-1', rep);
        for (const be of backends.filter((n) => n.region === region)) p.connect(be.id, rep);
      }
    }
    for (const rep of p.s.world.nodes.filter((n) => n.type === 'replica')) p.config(rep.id, 'maxConnections', 4000);
  },
  m097: (p) =>
    p
      .do({ type: 'incident.declare', id: 'inc-storm', severity: 'SEV1' })
      .do({ type: 'incident.order', id: 'inc-storm', order: ['s1', 's2', 's3', 's4'] })
      .do({ type: 'postmortem.answer', incidentId: 'inc-storm', key: 'rootCause', value: 'Spike + cold cache + slow payment provider' })
      .do({ type: 'postmortem.answer', incidentId: 'inc-storm', key: 'action', value: 'Cache warming, circuit breaker, autoscaling headroom' })
      .do({ type: 'postmortem.submit', incidentId: 'inc-storm' }),
  m098: (p) => {
    // a million users worldwide: Asia-Pacific gets its own point of presence too
    addRegion(p, 'ap', 3);
    p.do({ type: 'tls.issue', issuer: 'letsencrypt' });
  },
  m099: (p) => p.pin('logs', 'log').op('utc').deploy(),
  m100: (p) => p.say('d', 'c1'),
};

export interface CampaignRun {
  play: Play;
  completed: string[];
}

/** Play the campaign from m001 until `until` (inclusive) or the end. */
export function playCampaign(content: ContentBundle, seed = 20261006, until?: string): CampaignRun {
  const p = new Play(content, seed);
  const completed: string[] = [];
  while (p.s.campaign.currentMissionId) {
    const id = p.s.campaign.currentMissionId;
    const step = PLAYBOOK[id];
    if (!step) throw new PlaythroughError(`[${id}] no playbook step`);
    p.start();
    step(p);
    p.complete();
    completed.push(id);
    if (id === until) break;
  }
  return { play: p, completed };
}
