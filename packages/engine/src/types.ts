/**
 * PROD engine — domain types.
 *
 * Everything here is plain JSON-serialisable data: the whole GameState goes into saves,
 * checkpoints and the backend. Content (missions, components, …) is described by the
 * *Def types and lives in @prod/content as JSON.
 */

export type Locale = 'en' | 'ru';
export interface LText {
  en: string;
  ru: string;
}

export type RegionId = 'eu' | 'us' | 'ap';
export const REGIONS: RegionId[] = ['eu', 'us', 'ap'];

export type Size = 's' | 'm' | 'l' | 'xl' | '2xl';
export const SIZES: Size[] = ['s', 'm', 'l', 'xl', '2xl'];

export type ConfigValue = string | number | boolean;
export type FactValue = string | number | boolean | null;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type NodeRole =
  | 'client'
  | 'dns'
  | 'cdn'
  | 'waf'
  | 'lb'
  | 'proxy'
  | 'backend'
  | 'worker'
  | 'database'
  | 'replica'
  | 'cache'
  | 'queue'
  | 'storage'
  | 'provider'
  | 'monitoring'
  | 'logs'
  | 'backup'
  | 'region';

/* ------------------------------------------------------------------ */
/* Architecture                                                        */
/* ------------------------------------------------------------------ */

export interface ArchNode {
  id: string;
  /** component type id from the catalog, e.g. "mysql" */
  type: string;
  name: string;
  region: RegionId;
  /** isometric grid position */
  pos: { x: number; y: number };
  size: Size;
  config: Record<string, ConfigValue>;
  ip: string;
  /** ports the process listens on */
  ports: number[];
  /** ports reachable from the internet (firewall) */
  publicPorts: number[];
  /** manually stopped / decommissioned */
  offline?: boolean;
  /** cannot be removed (the users/client node) */
  locked?: boolean;
  createdAt: number;
}

export interface ArchEdge {
  id: string;
  from: string;
  to: string;
}

export interface TrafficProfile {
  users: number;
  baseRps: number;
  pattern: 'flat' | 'wave' | 'spike' | 'growth' | 'daily';
  spikeMultiplier?: number;
  spikeStart?: number;
  spikeEnd?: number;
  growthTo?: number;
  regionMix: Partial<Record<RegionId, number>>;
  /** share of users on slow / unstable mobile networks */
  mobileShare?: number;
  /** typical downstream bandwidth of a desktop user, Mbit/s */
  bandwidthMbps?: number;
}

export interface QueryDef {
  id: string;
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete';
  where?: string[];
  /** WHERE uses LIKE '%…%' — cannot use a B-tree index */
  like?: boolean;
  orderBy?: string;
  limit?: number;
  match?: 'one' | 'many';
  /** fraction of rows matched by WHERE (for "many") */
  selectivity?: number;
  /** how many times the query runs per request (N+1 shows up here) */
  perRequest?: number;
  join?: { table: string; on: string };
  /** SELECT … FOR UPDATE / row locks inside a transaction */
  lockRows?: boolean;
}

export interface JobDef {
  id: string;
  label: LText;
  cpuMs: number;
  /** external call made by the job */
  external?: 'mail' | 'payment' | 'storage';
  /** wall time not spent on CPU (rendering, I/O) */
  ioMs?: number;
  queue?: 'critical' | 'bulk';
  /** app setting that moves this job to the queue, e.g. "async.orderEmail" */
  asyncSetting: string;
  perRequest?: number;
}

export interface EndpointDef {
  id: string;
  method: HttpMethod;
  path: string;
  /** product layer: what the user is doing */
  product: LText;
  /** application layer: handler name */
  handler?: string;
  target: 'static' | 'backend';
  /** backend service that owns the endpoint ("monolith" by default) */
  service?: string;
  weight: number;
  cpuMs: number;
  responseKb: number;
  auth: 'none' | 'user' | 'admin';
  writes?: boolean;
  api?: boolean;
  queries: QueryDef[];
  cache?: { cardinality: number; valueKb: number; writesPerHourPerKey?: number };
  jobs?: JobDef[];
  /** synchronous calls to other services */
  calls?: string[];
  external?: { provider: 'payment' | 'mail' | 'fetch'; latencyMs?: number }[];
  /** static asset paths (relative to web root) loaded by this page */
  assets?: string[];
  upload?: boolean;
  disabled?: boolean;
  /** feature flag gating this endpoint */
  flag?: string;
  /** API version this endpoint belongs to */
  version?: string;
  /** JSON response example (API Inspector) */
  example?: unknown;
  /** users read this right after writing it (read-your-writes matters) */
  readAfterWrite?: boolean;
  /** called from browser JavaScript (CORS applies when cross-origin) */
  browserFetch?: boolean;
  /** fraction of requests that are duplicates caused by impatient clicks on slow networks */
  doubleSubmit?: boolean;
}

export interface CacheRule {
  endpoint: string;
  enabled: boolean;
  /** seconds */
  ttl: number;
}

export interface ColumnDef {
  name: string;
  type: string;
  pk?: boolean;
  unique?: boolean;
  nullable?: boolean;
  /** "table.column" */
  fk?: string;
}

export interface IndexDef {
  name: string;
  columns: string[];
  unique?: boolean;
}

export interface TableDef {
  name: string;
  rows: number;
  rowKb: number;
  columns: ColumnDef[];
  indexes: IndexDef[];
}

export interface BugDef {
  id: string;
  title: LText;
  endpoint?: string;
  errorRate?: number;
  extraLatencyMs?: number;
  extraCpuMs?: number;
  /** MB per simulated minute */
  memoryLeakMbPerMin?: number;
  anomaly?: { id: string; perHour: number };
  logCode: string;
  logMessage: string;
  /** release that introduced it (canary math) */
  version?: number;
  fixed?: boolean;
  /** test id that would catch it in CI */
  caughtBy?: string;
  /** active only for users inside this feature flag rollout */
  flag?: string;
}

export type FileKind = 'html' | 'css' | 'js' | 'image' | 'config' | 'env' | 'sql' | 'log' | 'code' | 'text' | 'dir';

export interface ProjectFile {
  path: string;
  sizeKb: number;
  kind: FileKind;
  content?: string;
  optimized?: boolean;
  secret?: boolean;
  lazy?: boolean;
}

export interface DnsRecord {
  id: string;
  type: 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT';
  /** "@" for apex, "www", … */
  name: string;
  value: string;
  ttl: number;
}

export interface DnsChange {
  name: string;
  type: string;
  oldValue: string | null;
  oldTtl: number;
  at: number;
}

export interface DnsState {
  domain: string | null;
  records: DnsRecord[];
  changes: DnsChange[];
  geoRouting: boolean;
  failover: boolean;
}

export interface TlsState {
  enabled: boolean;
  issuer: 'none' | 'self-signed' | 'letsencrypt';
  /** clock minute when the certificate expires */
  expiresAt: number | null;
  autoRenew: boolean;
  redirectHttp: boolean;
  hsts: boolean;
  version: '1.2' | '1.3';
  sessionResumption: boolean;
}

export interface Role {
  id: string;
  permissions: string[];
}

export interface Employee {
  id: string;
  name: string;
  role: string;
}

export interface Secret {
  id: string;
  name: string;
  scope: string;
  leaked: boolean;
  inGitHistory: boolean;
  rotatedAt: number | null;
}

export interface Dependency {
  name: string;
  version: string;
  latest: string;
  cve?: { id: string; severity: 'low' | 'medium' | 'high' | 'critical'; fixedIn: string; summary: LText };
}

export interface SecurityState {
  roles: Role[];
  employees: Employee[];
  secrets: Secret[];
  deps: Dependency[];
}

export interface GitCommit {
  id: string;
  message: string;
  branch: string;
  parents: string[];
  author: string;
  at: number;
  files: string[];
  secret?: boolean;
  /** bug ids introduced by this commit */
  bugs?: string[];
  /** bug ids fixed by this commit */
  fixes?: string[];
}

export interface PullRequest {
  id: number;
  title: string;
  from: string;
  to: string;
  author: string;
  status: 'open' | 'merged' | 'closed';
  checks: 'none' | 'passed' | 'failed';
  failing?: string[];
  /** bug ids the PR would introduce */
  bugs?: string[];
  reviewed?: boolean;
}

export interface MergeConflict {
  from: string;
  into: string;
  file: string;
  ours: string;
  theirs: string;
  combined: string;
  /** which resolution is semantically correct */
  correct: 'ours' | 'theirs' | 'combined';
  /** bug introduced by a wrong resolution */
  wrongBug?: string;
  resolution?: 'ours' | 'theirs' | 'combined';
}

export interface GitState {
  initialized: boolean;
  commits: GitCommit[];
  branches: Record<string, string>;
  current: string;
  prs: PullRequest[];
  protection: { requirePr: boolean; requireChecks: boolean; requireReview: boolean };
  conflict: MergeConflict | null;
  gitignore: string[];
  historyRewritten: boolean;
}

export interface CiStages {
  lint: boolean;
  unit: boolean;
  integration: boolean;
  contract: boolean;
  secretScan: boolean;
  depScan: boolean;
  build: boolean;
}

export interface CiRun {
  id: number;
  ref: string;
  status: 'passed' | 'failed';
  failedStage?: string;
  reason?: string;
  at: number;
}

export interface CiState {
  enabled: boolean;
  stages: CiStages;
  /** regression tests: each covers a bug id (or class) */
  tests: { id: string; covers: string; label: LText }[];
  runs: CiRun[];
}

export interface Release {
  version: number;
  at: number;
  app: Record<string, ConfigValue>;
  fixes: string[];
  bugs: string[];
  status: 'live' | 'canary' | 'rolled-back' | 'superseded';
  migration: 'none' | 'additive' | 'destructive';
  notes?: string;
}

export interface FeatureFlag {
  id: string;
  label: LText;
  enabled: boolean;
  rollout: number;
}

export interface DeployState {
  version: number;
  releases: Release[];
  /** code-level changes waiting for the next deploy */
  pending: Record<string, ConfigValue>;
  pendingFixes: string[];
  /** bugs that the next deploy will ship (from merged PRs) */
  pendingBugs: string[];
  canary: { version: number; percent: number } | null;
  flags: FeatureFlag[];
  /** after Act VII: app.* changes require a deploy */
  requireDeploy: boolean;
  deployCount: number;
}

export interface AlertRule {
  id: string;
  metric: AlertMetric;
  op: '>' | '<';
  threshold: number;
  forMinutes: number;
  severity: 'page' | 'ticket';
  enabled: boolean;
}

export type AlertMetric =
  | 'errorRate'
  | 'p95'
  | 'availability'
  | 'cpu.backend'
  | 'cpu.database'
  | 'ram.backend'
  | 'queue.backlog'
  | 'db.connections'
  | 'disk'
  | 'slo.burn'
  | 'uptime';

export interface Runbook {
  id: string;
  title: string;
  trigger: string;
  steps: string[];
}

export interface SloConfig {
  availability: number;
  latencyMs: number;
  slaAvailability: number | null;
  freezeOnBudgetExhausted: boolean;
}

export interface IncidentEvent {
  id: string;
  source: string;
  /** local HH:MM as printed by the source */
  raw: string;
  /** offset of the source clock from UTC, hours */
  tz: number;
  text: LText;
}

export interface IncidentRecord {
  id: string;
  title: LText;
  severity: 'SEV1' | 'SEV2' | 'SEV3' | null;
  status: 'open' | 'mitigated' | 'resolved';
  declaredAt: number | null;
  events: IncidentEvent[];
  order: string[];
  utcView: boolean;
  missionId?: string;
}

export interface Postmortem {
  incidentId: string;
  answers: Record<string, string | string[]>;
  submitted: boolean;
}

export interface ObservabilityState {
  alertRules: AlertRule[];
  runbooks: Runbook[];
  slo: SloConfig | null;
  incidents: IncidentRecord[];
  postmortems: Postmortem[];
  ackedAlerts: string[];
}

export type IncidentKind =
  | 'nodeDown'
  | 'regionDown'
  | 'providerSlow'
  | 'providerDown'
  | 'memoryLeak'
  | 'cpuSteal'
  | 'trafficSpike'
  | 'certExpired'
  | 'cacheFlush'
  | 'backupAtPeak'
  | 'nightlyJob'
  | 'diskFull'
  | 'scanner'
  | 'botnet'
  | 'bulkJobs'
  | 'serviceDown';

export interface WorldIncident {
  id: string;
  kind: IncidentKind;
  title: LText;
  /** node id, node type, region id, provider type or service name */
  target?: string;
  params?: Record<string, number | string>;
  startTick?: number;
  endTick?: number;
  /** when the condition holds the incident is considered resolved */
  resolvedWhen?: Condition;
  source: 'mission' | 'consequence' | 'living' | 'deploy';
  active: boolean;
  reward?: number;
}

export interface World {
  nodes: ArchNode[];
  edges: ArchEdge[];
  regions: RegionId[];
  primaryRegion: RegionId;
  traffic: TrafficProfile;
  /** simulated minutes per tick (1 = one minute) */
  timeScale: number;
  endpoints: EndpointDef[];
  tables: TableDef[];
  app: Record<string, ConfigValue>;
  cacheRules: CacheRule[];
  bugs: BugDef[];
  files: ProjectFile[];
  site: { port: number; ip: string };
  dns: DnsState;
  tls: TlsState;
  security: SecurityState;
  git: GitState;
  ci: CiState;
  deploy: DeployState;
  observability: ObservabilityState;
  incidents: WorldIncident[];
  flags: Record<string, FactValue>;
}

/* ------------------------------------------------------------------ */
/* Conditions & effects (mission DSL)                                  */
/* ------------------------------------------------------------------ */

export type Condition =
  | boolean
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | FactCondition;

export interface FactCondition {
  fact: string;
  eq?: FactValue;
  ne?: FactValue;
  lt?: number;
  lte?: number;
  gt?: number;
  gte?: number;
  in?: FactValue[];
  truthy?: boolean;
  falsy?: boolean;
}

export type Effect =
  | { set: string; value: unknown }
  | { inc: string; by: number }
  | { push: string; value: unknown }
  | { remove: string }
  | { merge: string; value: Record<string, unknown> }
  | { addNode: Partial<ArchNode> & { id: string; type: string } }
  | { removeNode: string }
  | { connect: [string, string] }
  | { disconnect: [string, string] }
  | { debt: number }
  | { cash: number }
  | { users: number }
  | { mail: MailDef }
  | { unlock: Partial<Unlocks> }
  | { flag: string; value: FactValue }
  | { incident: WorldIncident }
  | { resolveIncident: string }
  | { fixBug: string }
  | { addBug: BugDef }
  | { advance: number };

export interface MailDef {
  id: string;
  from: string;
  subject: LText;
  body: LText;
  dialogue?: string;
}

/* ------------------------------------------------------------------ */
/* Content definitions                                                 */
/* ------------------------------------------------------------------ */

export interface ConfigFieldDef {
  key: string;
  type: 'bool' | 'enum' | 'number';
  options?: (string | number)[];
  min?: number;
  max?: number;
  step?: number;
  label: LText;
  help: LText;
  /** feature that must be unlocked for the field to be editable */
  feature?: string;
}

export interface ComponentDef {
  type: string;
  role: NodeRole;
  label: LText;
  purpose: LText;
  why: LText;
  knowledge: string;
  icon: string;
  /** capacity at size "s": rps for edge roles, CPU-ms/s for compute & databases, MB for caches, jobs for queues */
  capacity: number;
  baseLatencyMs: number;
  costPerMonth: number;
  scalable: boolean;
  /** RAM at size "s", MB */
  ramMb: number;
  defaultPorts: number[];
  defaults: Record<string, ConfigValue>;
  config: ConfigFieldDef[];
  /** roles this component may initiate connections to */
  connectsTo: NodeRole[];
  maxCount?: number;
  /** external SaaS: not placed in a region, fixed cost */
  external?: boolean;
}

export interface SettingOption {
  value: string | number | boolean;
  label: LText;
  note?: LText;
  code?: string;
}

export interface SettingDef {
  key: string;
  area: 'auth' | 'security' | 'api' | 'data' | 'cache' | 'async' | 'reliability' | 'observability' | 'performance' | 'release';
  type: 'bool' | 'enum' | 'number';
  default: ConfigValue;
  options?: SettingOption[];
  min?: number;
  max?: number;
  step?: number;
  label: LText;
  help: LText;
  knowledge?: string;
  /** true: a code change (goes through deploy after Act VII); false: runtime config */
  code: boolean;
}

export interface KnowledgeNodeDef {
  id: string;
  category: string;
  parent: string | null;
  title: LText;
  summary: LText;
  article: {
    what: LText;
    why: LText;
    limits: LText;
    production: LText;
    underTheHood?: LText;
    before?: LText;
    after?: LText;
    diagram?: DiagramDef;
  };
  related?: string[];
}

export interface DiagramDef {
  nodes: { id: string; label: string; icon?: string; tone?: 'ok' | 'warn' | 'error' | 'muted' | 'accent' }[];
  edges: [string, string, string?][];
}

export interface AchievementDef {
  id: string;
  title: LText;
  description: LText;
  icon: string;
  secret?: boolean;
  /** global condition, checked after every mission & simulation */
  when?: Condition;
}

export interface NpcDef {
  id: string;
  name: LText;
  role: LText;
  avatar: string;
  signature?: LText;
}

export interface AttackStepDef {
  id: string;
  label: LText;
  /** where the step happens (node type or endpoint id), used by Attack Replay */
  at: string;
  payload?: string;
  /** step is blocked when this holds */
  blockedWhen: Condition;
  blockedBy: LText;
  succeeded: LText;
}

export interface AttackDef {
  id: string;
  name: LText;
  category: string;
  knowledge: string;
  description: LText;
  steps: AttackStepDef[];
  impact: LText;
}

export interface CommandDef {
  id: string;
  usage: string;
  description: LText;
  /** commands are typed as `name args…`; examples shown as clickable buttons */
  examples: string[];
}

export interface Unlocks {
  apps: string[];
  components: string[];
  settings: string[];
  attacks: string[];
  commands: string[];
  features: string[];
}

export interface DialogueChoiceDef {
  id: string;
  text: LText;
  reply?: LText;
  effects?: Effect[];
}

export interface DialogueDef {
  id: string;
  npc: string;
  text: LText;
  choices: DialogueChoiceDef[];
  /** this dialogue arrives as mail when the condition holds (default: at mission start) */
  when?: Condition;
}

export interface EvidenceMatch {
  app?: string;
  kind: string;
  key?: string | string[];
  keyPrefix?: string;
}

export interface EvidenceDef {
  id: string;
  app: string;
  hint: LText;
  text: LText;
  match: EvidenceMatch;
}

export interface HypothesisDef {
  id: string;
  text: LText;
  correct: boolean;
  feedback: LText;
}

export interface MissionOpDef {
  id: string;
  app: string;
  label: LText;
  description?: LText;
  effects: Effect[];
  once?: boolean;
  /** op is visible only while the condition holds */
  when?: Condition;
  /** treated as a code change (goes through deploy when required) */
  code?: boolean;
  danger?: boolean;
}

export interface ObjectiveDef {
  id: string;
  text: LText;
  check: Condition;
  /** needs a fresh simulation run to be evaluated */
  sim?: boolean;
}

export interface ConsequenceDef {
  id: string;
  /** fire after this many completed missions */
  delay: number;
  /** fires only if the condition still holds at that moment */
  when?: Condition;
  effects: Effect[];
  mail: MailDef;
}

export type SolutionKind = 'good' | 'acceptable' | 'quickfix' | 'bad' | 'overkill';

export interface SolutionDef {
  id: string;
  kind: SolutionKind;
  when: Condition;
  text: LText;
  effects?: Effect[];
  debt?: number;
  consequences?: ConsequenceDef[];
}

export interface ExplanationDef {
  what: LText;
  whyNow: LText;
  limits: LText;
  production?: LText;
  underTheHood?: LText;
  diagram?: { before?: DiagramDef; after?: DiagramDef };
  article?: string;
}

export interface MissionDef {
  id: string;
  slug: string;
  act: number;
  order: number;
  kind: 'tutorial' | 'build' | 'incident' | 'decision' | 'security' | 'epilogue';
  title: LText;
  summary: LText;
  prerequisites: string[];
  unlocks?: Partial<Unlocks>;
  setup?: Effect[];
  trigger: MailDef;
  dialogue?: DialogueDef[];
  symptoms?: { text: LText; app: string }[];
  evidence?: EvidenceDef[];
  hypotheses?: HypothesisDef[];
  ops?: MissionOpDef[];
  learning: string[];
  objectives: ObjectiveDef[];
  solutions: SolutionDef[];
  explanation: ExplanationDef;
  achievements?: { id: string; when: Condition }[];
  checkpoint?: boolean;
  rewards?: { cash?: number; users?: number; days?: number };
  next: string | null;
}

export interface MissionIndexEntry {
  id: string;
  slug: string;
  act: number;
  order: number;
  title: LText;
}

export interface ActDef {
  act: number;
  title: LText;
  subtitle: LText;
}

export interface InitialStateDef {
  world: World;
  cash: number;
  unlocks: Unlocks;
}

export interface ContentBundle {
  version: string;
  components: ComponentDef[];
  settings: SettingDef[];
  knowledge: KnowledgeNodeDef[];
  achievements: AchievementDef[];
  npcs: NpcDef[];
  attacks: AttackDef[];
  commands: CommandDef[];
  acts: ActDef[];
  initial: InitialStateDef;
  missionIndex: MissionIndexEntry[];
  /** missions loaded so far (lazy by act) */
  missions: Record<string, MissionDef>;
}

/* ------------------------------------------------------------------ */
/* Game state                                                          */
/* ------------------------------------------------------------------ */

export type KnowledgeLevel = 'locked' | 'discovered' | 'understood' | 'practiced' | 'mastered';
export const KNOWLEDGE_LEVELS: KnowledgeLevel[] = ['locked', 'discovered', 'understood', 'practiced', 'mastered'];

export interface KnowledgeProgress {
  state: KnowledgeLevel;
  score: number;
  lastPracticedAt: number | null;
}

export interface EvidenceToken {
  app: string;
  kind: string;
  key: string;
  label?: string;
}

export interface MetricsSnapshot {
  p50: number;
  p95: number;
  errorRate: number;
  availability: number;
  rps: number;
  costPerMonth: number;
  cacheHitRate: number | null;
  queueBacklog: number | null;
  dbUtil: number | null;
  pageLoadMs: number | null;
  quality: QualityScores;
  debt: number;
  anomalies: Record<string, number>;
}

export interface QualityScores {
  performance: number;
  reliability: number;
  security: number;
  maintainability: number;
  cost: number;
}

export interface QualityReason {
  metric: keyof QualityScores | 'debt';
  delta: number;
  key: string;
  params?: Record<string, string | number>;
}

export type MissionPhase = 'briefing' | 'investigating' | 'resolved' | 'debrief';

export interface ActiveMission {
  id: string;
  phase: MissionPhase;
  startedAt: number;
  pinned: EvidenceToken[];
  evidence: string[];
  hypothesis: string | null;
  wrongHypotheses: string[];
  choices: Record<string, string>;
  ops: string[];
  actions: number;
  baseline: MetricsSnapshot | null;
  simRuns: number;
  /** clock of the last state-changing action; sim is fresh when lastSimAt >= lastChangeAt */
  lastChangeSeq: number;
  lastSimSeq: number;
  objectivesMet: string[];
  attemptId?: string | null;
}

export interface MissionSummary {
  id: string;
  result: 'success';
  solutionId: string | null;
  solutionKind: SolutionKind | null;
  completedAt: number;
  before: MetricsSnapshot | null;
  after: MetricsSnapshot | null;
  hypothesisCorrect: boolean | null;
  wrongHypotheses: number;
  debtDelta: number;
  evidence: number;
}

export interface PendingConsequence {
  id: string;
  missionId: string;
  fireAtCompleted: number;
  def: ConsequenceDef;
}

export interface MailMessage {
  id: string;
  from: string;
  subject: LText;
  body: LText;
  at: number;
  read: boolean;
  kind: 'trigger' | 'dialogue' | 'reply' | 'consequence' | 'alert' | 'info';
  missionId?: string;
  dialogue?: string;
}

export interface DecisionEntry {
  seq: number;
  at: number;
  missionId: string | null;
  action: string;
  summary: string;
}

export interface TimelineEntry {
  at: number;
  kind: 'mission' | 'decision' | 'incident' | 'consequence' | 'achievement' | 'checkpoint' | 'deploy' | 'restore';
  key: string;
  params?: Record<string, string | number>;
}

export interface Stats {
  restores: number;
  deploys: number;
  rollbacks: number;
  fridayDeploys: number;
  attacksRun: number;
  attacksBlocked: number;
  simRuns: number;
  wrongHypotheses: number;
}

export interface GameState {
  schemaVersion: number;
  seed: number;
  /** game clock in minutes since campaign start */
  clock: number;
  /** monotonic counter of state-changing actions */
  seq: number;
  company: { name: string; domain: string | null };
  campaign: {
    currentMissionId: string | null;
    completed: Record<string, MissionSummary>;
    completedOrder: string[];
    active: ActiveMission | null;
    finished: boolean;
    livingDay: number;
  };
  world: World;
  debt: number;
  budget: { cash: number; ledger: { at: number; amount: number; key: string }[] };
  quality: QualityScores;
  unlocks: Unlocks;
  knowledge: Record<string, KnowledgeProgress>;
  achievements: Record<string, number>;
  consequences: PendingConsequence[];
  firedConsequences: string[];
  mail: MailMessage[];
  decisionLog: DecisionEntry[];
  timeline: TimelineEntry[];
  stats: Stats;
  /** last Attack Lab results by attack id */
  attackResults: Record<string, AttackResult>;
  openedApps: string[];
}

export interface AttackStepResult {
  id: string;
  status: 'passed' | 'blocked' | 'skipped';
}

export interface AttackResult {
  attackId: string;
  success: boolean;
  blockedAt: string | null;
  steps: AttackStepResult[];
  at: number;
  seq: number;
}
