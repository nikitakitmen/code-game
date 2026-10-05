/**
 * Save migrations. Every save carries `schemaVersion`; loading runs the chain
 * v1 → v2 → v3 → … up to SAVE_SCHEMA_VERSION. Migrations never drop progress:
 * unknown fields are kept, missing fields get defaults.
 *
 * Format history
 *  v1 (prototype): company was a string, knowledge was { id: 0..4 }, `cash` at top level,
 *                  `missionId` instead of `campaign`.
 *  v2: company { name, domain }, knowledge { id: { state, score } }, budget { cash, ledger },
 *      campaign { currentMissionId, completed, completedOrder, active }.
 *  v3: delayed consequences, Attack Lab results, stats, opened apps, decision seq,
 *      deploy pipeline state (deploy.pendingBugs, requireDeploy), cache rules.
 */
import { SAVE_SCHEMA_VERSION } from './schema';

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const LEVELS = ['locked', 'discovered', 'understood', 'practiced', 'mastered'];

export const MIGRATIONS: Record<number, (s: Raw) => Raw> = {
  1: (s) => {
    const out: Raw = { ...s };
    out.company = typeof s.company === 'string' ? { name: s.company, domain: null } : (s.company ?? { name: '', domain: null });
    const knowledge: Raw = {};
    for (const [k, v] of Object.entries((s.knowledge ?? {}) as Raw)) {
      knowledge[k] = typeof v === 'number' ? { state: LEVELS[Math.max(0, Math.min(4, v))], score: v, lastPracticedAt: null } : v;
    }
    out.knowledge = knowledge;
    out.budget = { cash: Number(s.cash ?? 0), ledger: [] };
    delete out.cash;
    out.campaign = {
      currentMissionId: s.missionId ?? 'm001',
      completed: s.completed ?? {},
      completedOrder: Object.keys(s.completed ?? {}),
      active: null,
      finished: false,
      livingDay: 0,
    };
    delete out.missionId;
    delete out.completed;
    out.schemaVersion = 2;
    return out;
  },
  2: (s) => {
    const out: Raw = { ...s };
    out.consequences = s.consequences ?? [];
    out.firedConsequences = s.firedConsequences ?? [];
    out.attackResults = s.attackResults ?? {};
    out.openedApps = s.openedApps ?? [];
    out.seq = s.seq ?? 0;
    out.stats = { restores: 0, deploys: 0, rollbacks: 0, fridayDeploys: 0, attacksRun: 0, attacksBlocked: 0, simRuns: 0, wrongHypotheses: 0, ...(s.stats ?? {}) };
    if (out.world) {
      out.world = { ...out.world };
      out.world.cacheRules = out.world.cacheRules ?? [];
      if (out.world.deploy) out.world.deploy = { pendingBugs: [], requireDeploy: false, deployCount: 0, pendingFixes: [], ...out.world.deploy };
    }
    out.campaign = { finished: false, livingDay: 0, ...(out.campaign ?? {}) };
    out.schemaVersion = 3;
    return out;
  },
};

export class SaveMigrationError extends Error {}

export function migrateState(raw: Raw): Raw {
  let s = { ...raw };
  let v = Number(s.schemaVersion ?? s.version ?? 1);
  if (!Number.isFinite(v) || v < 1) v = 1;
  if (v > SAVE_SCHEMA_VERSION) throw new SaveMigrationError(`Save schema v${v} is newer than supported v${SAVE_SCHEMA_VERSION}`);
  while (v < SAVE_SCHEMA_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) throw new SaveMigrationError(`No migration from v${v}`);
    s = m(s);
    v = Number(s.schemaVersion);
  }
  delete s.version;
  return s;
}
