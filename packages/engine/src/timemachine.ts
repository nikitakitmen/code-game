/**
 * Time Machine: checkpoints before big decisions, safe restore (never destroys progress),
 * replay of a checkpoint and side-by-side comparison of two solutions.
 */
import { simulate } from './sim';
import type { SimResult } from './sim/types';
import type { ContentBundle, GameState, KnowledgeLevel } from './types';
import { KNOWLEDGE_LEVELS } from './types';
import { deepClone } from './util';

export type CheckpointType = 'mission-start' | 'manual' | 'pre-restore' | 'pre-decision' | 'auto';

export interface Checkpoint {
  id: string;
  type: CheckpointType;
  label: string;
  missionId: string | null;
  clock: number;
  createdAt: string;
  state: GameState;
}

let counter = 0;

export function createCheckpoint(state: GameState, type: CheckpointType, label: string, now: Date = new Date()): Checkpoint {
  counter = (counter + 1) % 1_000_000;
  return {
    id: `cp-${now.getTime().toString(36)}-${counter.toString(36)}`,
    type,
    label,
    missionId: state.campaign.currentMissionId,
    clock: state.clock,
    createdAt: now.toISOString(),
    state: deepClone(state),
  };
}

/**
 * Restore a checkpoint. The current state is returned as a `pre-restore` backup first.
 * Meta progress (achievements, knowledge, stats) is merged, never rolled back.
 */
export function restoreCheckpoint(current: GameState, cp: Checkpoint, now: Date = new Date()): { state: GameState; backup: Checkpoint } {
  const backup = createCheckpoint(current, 'pre-restore', `Before restoring "${cp.label}"`, now);
  const s = deepClone(cp.state);
  for (const [id, at] of Object.entries(current.achievements)) if (s.achievements[id] === undefined) s.achievements[id] = at;
  for (const [id, k] of Object.entries(current.knowledge)) {
    const mine = s.knowledge[id];
    if (!mine || KNOWLEDGE_LEVELS.indexOf(k.state as KnowledgeLevel) > KNOWLEDGE_LEVELS.indexOf(mine.state as KnowledgeLevel)) s.knowledge[id] = { ...k };
    else s.knowledge[id] = { ...mine, score: Math.max(mine.score, k.score) };
  }
  s.stats = { ...current.stats, restores: current.stats.restores + 1 };
  s.seq = Math.max(current.seq, s.seq) + 1;
  s.timeline = [...s.timeline, { at: s.clock, kind: 'restore', key: 'timeline.restore', params: { label: cp.label } }];
  return { state: s, backup };
}

export interface CompareRow {
  metric: string;
  a: number | null;
  b: number | null;
  /** which side is better for this metric */
  better: 'a' | 'b' | 'same';
}

const LOWER_IS_BETTER = new Set(['p95', 'p50', 'errorRate', 'cost', 'debt', 'pageLoad']);

export function compareStates(a: GameState, b: GameState, content: ContentBundle): { simA: SimResult; simB: SimResult; rows: CompareRow[] } {
  // same salt for both sides: differences come from decisions, not from randomness
  const simA = simulate(a, content, { salt: 'compare' });
  const simB = simulate(b, content, { salt: 'compare' });
  const pick = (s: SimResult, st: GameState): Record<string, number | null> => ({
    p50: s.summary.p50,
    p95: s.summary.p95,
    errorRate: s.summary.errorRate,
    availability: s.summary.availability,
    cost: s.cost.total,
    debt: st.debt,
    pageLoad: s.summary.pageLoadMs,
    performance: s.quality.performance,
    reliability: s.quality.reliability,
    security: s.quality.security,
    maintainability: s.quality.maintainability,
  });
  const va = pick(simA, a);
  const vb = pick(simB, b);
  const rows: CompareRow[] = Object.keys(va).map((metric) => {
    const x = va[metric];
    const y = vb[metric];
    let better: CompareRow['better'] = 'same';
    if (x !== null && y !== null && Math.abs(x - y) > 1e-9) {
      const lower = LOWER_IS_BETTER.has(metric);
      better = (lower ? x < y : x > y) ? 'a' : 'b';
    }
    return { metric, a: x, b: y, better };
  });
  return { simA, simB, rows };
}

/** Keep every manual / mission checkpoint (up to `maxKeep`) and the newest automatic ones. */
export function pruneCheckpoints(list: Checkpoint[], maxAuto = 15, maxKeep = 60): Checkpoint[] {
  const sorted = [...list].sort((x, y) => x.createdAt.localeCompare(y.createdAt));
  const auto = sorted.filter((c) => c.type === 'auto' || c.type === 'pre-restore');
  const keep = sorted.filter((c) => c.type !== 'auto' && c.type !== 'pre-restore');
  return [...keep.slice(-maxKeep), ...auto.slice(-maxAuto)].sort((x, y) => x.createdAt.localeCompare(y.createdAt));
}
