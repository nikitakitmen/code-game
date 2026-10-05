import type { MetricsSnapshot, QualityReason, QualityScores, RegionId } from '../types';
import type { ExplainRow } from './db';

export type ErrorCode =
  | 'CONNECTION_REFUSED'
  | 'CONNECTION_TIMEOUT'
  | 'DNS_NXDOMAIN'
  | 'DNS_MISMATCH'
  | 'TLS_EXPIRED'
  | 'MIXED_CONTENT'
  | 'CORS_BLOCKED'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'NO_ROUTE'
  | 'UPSTREAM_DOWN'
  | 'OVERLOAD'
  | 'GATEWAY_TIMEOUT'
  | 'DB_TOO_MANY_CONNECTIONS'
  | 'DB_POOL_TIMEOUT'
  | 'DB_DOWN'
  | 'DB_DEADLOCK'
  | 'DB_LOCK_TIMEOUT'
  | 'CACHE_OOM'
  | 'CACHE_DOWN'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_ERROR'
  | 'CIRCUIT_OPEN'
  | 'SERVICE_UNAVAILABLE'
  | 'SESSION_LOST'
  | 'RATE_LIMITED'
  | 'REGION_DOWN'
  | 'OOM_KILLED'
  | 'STORAGE_MISSING'
  | 'DISK_FULL'
  | 'FILE_CORRUPTED'
  | 'NO_BACKEND'
  | 'NO_DATABASE'
  | 'BUG';

export const ERROR_STATUS: Record<ErrorCode, number> = {
  CONNECTION_REFUSED: 0,
  CONNECTION_TIMEOUT: 0,
  DNS_NXDOMAIN: 0,
  DNS_MISMATCH: 0,
  TLS_EXPIRED: 0,
  MIXED_CONTENT: 0,
  CORS_BLOCKED: 0,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  NO_ROUTE: 502,
  UPSTREAM_DOWN: 502,
  OVERLOAD: 503,
  GATEWAY_TIMEOUT: 504,
  DB_TOO_MANY_CONNECTIONS: 500,
  DB_POOL_TIMEOUT: 500,
  DB_DOWN: 500,
  DB_DEADLOCK: 500,
  DB_LOCK_TIMEOUT: 500,
  CACHE_OOM: 500,
  CACHE_DOWN: 500,
  PROVIDER_TIMEOUT: 504,
  PROVIDER_ERROR: 502,
  CIRCUIT_OPEN: 503,
  SERVICE_UNAVAILABLE: 503,
  SESSION_LOST: 401,
  RATE_LIMITED: 429,
  REGION_DOWN: 0,
  OOM_KILLED: 502,
  STORAGE_MISSING: 404,
  DISK_FULL: 500,
  FILE_CORRUPTED: 500,
  NO_BACKEND: 0,
  NO_DATABASE: 500,
  BUG: 500,
};

export type HealthStatus = 'ok' | 'warn' | 'error' | 'offline';

export interface StageTrace {
  id: string;
  nodeId: string | null;
  nodeType: string;
  layer: 'network' | 'infrastructure' | 'application' | 'data';
  label: string;
  startMs: number;
  durationMs: number;
  status: 'ok' | 'warn' | 'error';
  details: Record<string, string | number | boolean>;
}

export interface RequestTrace {
  id: string;
  requestId: string | null;
  traceId: string;
  endpointId: string;
  method: string;
  path: string;
  region: RegionId;
  status: number;
  errorCode: string | null;
  totalMs: number;
  stages: StageTrace[];
  tick: number;
  sample: 'typical' | 'slow' | 'error' | 'asset';
  request: { headers: Record<string, string>; body?: string };
  response: { headers: Record<string, string>; sizeKb: number; body?: string };
}

export interface LogLine {
  id: string;
  /** game clock minute (UTC) */
  t: number;
  /** timezone offset of the server that printed the line (hours) */
  tz: number;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  source: string;
  sourceType: string;
  code: string;
  message: string;
  requestId?: string;
  traceId?: string;
  endpoint?: string;
  status?: number;
  ms?: number;
  ip?: string;
}

export interface FiredAlert {
  id: string;
  ruleId: string;
  metric: string;
  severity: 'page' | 'ticket';
  startTick: number;
  endTick: number;
  peak: number;
  threshold: number;
  /** users were actually hurt while it fired */
  actionable: boolean;
}

export interface NodeTick {
  util: number;
  rps: number;
  latencyMs: number;
  errorRate: number;
  cpu: number;
  ram: number;
  offline: boolean;
}

export interface TickMetrics {
  t: number;
  minute: number;
  rps: number;
  p50: number;
  p95: number;
  errorRate: number;
  cacheHitRate: number | null;
  queueBacklog: number;
  dbConnections: number;
  dbUtil: number;
  replicaLagMs: number;
  nodes: Record<string, NodeTick>;
}

export interface EndpointSummary {
  id: string;
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  errorRate: number;
  errors: Partial<Record<ErrorCode, number>>;
  /** dominant HTTP status (0 = browser-side failure) */
  status: number;
  path: string[];
  entry: string | null;
  cacheHitRate: number | null;
  dbMs: number;
  rowsScanned: number;
  explain: ExplainRow[];
  externalMs: number;
  pageLoadMs: number | null;
  missingAssets: string[];
  pageWeightKb: number | null;
  bugCodes: string[];
  served: boolean;
}

export interface NodeSummary {
  id: string;
  rps: number;
  util: number;
  utilMax: number;
  latencyMs: number;
  errorRate: number;
  cpu: number;
  ram: number;
  status: HealthStatus;
  reasons: string[];
  costPerMonth: number;
  connections?: number;
  maxConnections?: number;
  memoryUsedMb?: number;
  memoryMb?: number;
  instances?: number;
}

export interface QueueSummary {
  name: string;
  inRate: number;
  throughput: number;
  backlogEnd: number;
  backlogMax: number;
  waitSec: number;
  failedPerHour: number;
  dlqPerHour: number;
  duplicatesPerHour: number;
  retriesPerHour: number;
  workers: number;
}

export interface SimEvent {
  tick: number;
  key: string;
  params?: Record<string, string | number>;
  level: 'info' | 'warn' | 'error';
}

export interface SimSummary {
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  errorRate: number;
  availability: number;
  cacheHitRate: number | null;
  queueBacklog: number | null;
  dbUtil: number | null;
  dbConnections: number;
  maxConnections: number;
  replicaLagMs: number;
  pageLoadMs: number | null;
  pageWeightKb: number | null;
  regionP95: Partial<Record<RegionId, number>>;
  errorBudgetUsed: number | null;
  providerAmplification: number;
}

export interface SimResult {
  seq: number;
  seed: number;
  clock: number;
  ticks: TickMetrics[];
  summary: SimSummary;
  endpoints: Record<string, EndpointSummary>;
  nodes: Record<string, NodeSummary>;
  edges: Record<string, { rps: number; errorRate: number }>;
  queues: Record<string, QueueSummary>;
  anomalies: Record<string, number>;
  traces: RequestTrace[];
  logs: LogLine[];
  alerts: FiredAlert[];
  events: SimEvent[];
  vulns: string[];
  cost: { total: number; breakdown: { id: string; label: string; amount: number }[] };
  quality: QualityScores;
  qualityReasons: QualityReason[];
  snapshot: MetricsSnapshot;
  warnings: string[];
}
