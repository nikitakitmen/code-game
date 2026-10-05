import { computeQuality, costBreakdown, snapshotOf } from '../quality';
import type { ContentBundle, GameState } from '../types';
import { buildPresentation } from './presentation';
import { simulateCore, type SimOptions } from './simulate';
import type { SimResult } from './types';

export * from './types';
export { explainQuery, querySql, tableIndexes, type ExplainRow } from './db';
export { canConnect, routeEndpoint, serviceBackends, outNeighbors, inNeighbors } from './graph';
export { queueFactor, overloadErrors, ttlHitRatio, staleFraction, bugShare, SIM_TICKS, simSeed } from './simulate';
export { rtt, dcRtt } from './network';
export { alertMetricAt, evaluateAlerts } from './presentation';
export type { SimOptions };

/**
 * Full deterministic simulation: numbers + presentation (traces, logs, alerts)
 * + cost, quality and a metrics snapshot. Pure function of (state, content, options).
 */
export function simulate(state: GameState, content: ContentBundle, opts: SimOptions = {}): SimResult {
  const sim = simulateCore(state, content, opts);
  const pres = buildPresentation(state, content, sim);
  sim.traces = pres.traces;
  sim.logs = pres.logs;
  sim.alerts = pres.alerts;
  sim.cost = costBreakdown(state, content, sim);
  const q = computeQuality(state, content, sim);
  sim.quality = q.scores;
  sim.qualityReasons = q.reasons;
  sim.vulns = q.vulns;
  sim.snapshot = snapshotOf(state, sim);
  return sim;
}
