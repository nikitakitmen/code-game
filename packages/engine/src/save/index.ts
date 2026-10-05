import type { ContentBundle, GameState } from '../types';
import { migrateState, SaveMigrationError } from './migrations';
import { SAVE_SCHEMA_VERSION } from './schema';

export { SAVE_SCHEMA_VERSION, migrateState, SaveMigrationError };

export interface SaveEnvelope {
  schemaVersion: number;
  revision: number;
  savedAt: string;
  contentVersion: string;
  seed: number;
  state: GameState;
}

export function makeEnvelope(state: GameState, revision: number, contentVersion: string, now: Date = new Date()): SaveEnvelope {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    revision,
    savedAt: now.toISOString(),
    contentVersion,
    seed: state.seed,
    state,
  };
}

/**
 * Bring a loaded state up to date and fill fields that newer content expects.
 * New knowledge nodes/components appear with defaults; nothing is removed.
 */
export function loadState(raw: unknown, content: ContentBundle): GameState {
  if (!raw || typeof raw !== 'object') throw new SaveMigrationError('Save is empty');
  const s = migrateState(raw as Record<string, unknown>) as unknown as GameState;
  const problems = validateState(s);
  if (problems.length) throw new SaveMigrationError(`Invalid save: ${problems.join('; ')}`);
  for (const k of content.knowledge) if (!s.knowledge[k.id]) s.knowledge[k.id] = { state: 'locked', score: 0, lastPracticedAt: null };
  const init = content.initial;
  s.unlocks = s.unlocks ?? JSON.parse(JSON.stringify(init.unlocks));
  for (const key of ['apps', 'components', 'settings', 'attacks', 'commands', 'features'] as const) s.unlocks[key] = s.unlocks[key] ?? [];
  // world fields introduced after the save was written
  const w = s.world as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(init.world)) if (w[k] === undefined) w[k] = JSON.parse(JSON.stringify(v));
  return s;
}

export function validateState(s: GameState): string[] {
  const out: string[] = [];
  if (typeof s.seed !== 'number') out.push('seed');
  if (!s.world || !Array.isArray(s.world.nodes) || !Array.isArray(s.world.edges)) out.push('world');
  if (!s.campaign || typeof s.campaign.completed !== 'object') out.push('campaign');
  if (!s.budget || typeof s.budget.cash !== 'number') out.push('budget');
  if (typeof s.debt !== 'number') out.push('debt');
  return out;
}

export function parseEnvelope(raw: unknown, content: ContentBundle): SaveEnvelope {
  if (!raw || typeof raw !== 'object') throw new SaveMigrationError('Envelope missing');
  const env = raw as Partial<SaveEnvelope>;
  const state = loadState(env.state, content);
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    revision: Number(env.revision ?? 0),
    savedAt: String(env.savedAt ?? new Date(0).toISOString()),
    contentVersion: String(env.contentVersion ?? content.version),
    seed: state.seed,
    state,
  };
}
