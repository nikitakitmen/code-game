/**
 * Campaign rules: mission lifecycle, hypotheses, dialogue choices, mission ops,
 * solution families, delayed consequences, knowledge progression, achievements,
 * rewards and the post-campaign "living production" mode.
 */
import { produce, type Draft } from 'immer';
import { advanceTime, matchEvidence } from './actions';
import { evaluate } from './conditions';
import { addMail, applyEffects, mergeUnlocks, type EngineEvent } from './effects';
import { computeFacts } from './facts';
import { revenuePerMonth } from './quality';
import { combineSeed, createRng } from './rng';
import { runAttack } from './security';
import { SAVE_SCHEMA_VERSION } from './save/schema';
import type { SimResult } from './sim/types';
import type {
  ContentBundle,
  Effect,
  GameState,
  KnowledgeLevel,
  MissionDef,
  MissionSummary,
  SolutionDef,
  WorldIncident,
} from './types';
import { KNOWLEDGE_LEVELS } from './types';
import { deepClone } from './util';

export interface CampaignResult {
  state: GameState;
  events: EngineEvent[];
  ok: boolean;
}

const fail = (state: GameState, key: string, params?: Record<string, string | number>): CampaignResult => ({ state, events: [{ type: 'error', key, params }], ok: false });

/* ------------------------------------------------------------------ */
/* new game                                                            */
/* ------------------------------------------------------------------ */

export function newGame(content: ContentBundle, seed: number): GameState {
  const init = deepClone(content.initial);
  const first = [...content.missionIndex].sort((a, b) => a.order - b.order)[0]?.id ?? null;
  const state: GameState = {
    schemaVersion: SAVE_SCHEMA_VERSION,
    seed: seed >>> 0,
    clock: 9 * 60, // Monday 09:00
    seq: 0,
    company: { name: '', domain: null },
    campaign: { currentMissionId: first, completed: {}, completedOrder: [], active: null, finished: false, livingDay: 0 },
    world: init.world,
    debt: 0,
    budget: { cash: init.cash, ledger: [{ at: 0, amount: init.cash, key: 'seed' }] },
    quality: { performance: 100, reliability: 100, security: 100, maintainability: 100, cost: 100 },
    unlocks: init.unlocks,
    knowledge: {},
    achievements: {},
    consequences: [],
    firedConsequences: [],
    mail: [],
    decisionLog: [],
    timeline: [],
    stats: { restores: 0, deploys: 0, rollbacks: 0, fridayDeploys: 0, attacksRun: 0, attacksBlocked: 0, simRuns: 0, wrongHypotheses: 0 },
    attackResults: {},
    openedApps: [],
  };
  for (const k of content.knowledge) state.knowledge[k.id] = { state: 'locked', score: 0, lastPracticedAt: null };
  return state;
}

/* ------------------------------------------------------------------ */
/* mission start                                                       */
/* ------------------------------------------------------------------ */

export function missionDef(content: ContentBundle, id: string | null): MissionDef | undefined {
  return id ? content.missions[id] : undefined;
}

export function startMission(state: GameState, content: ContentBundle, missionId: string): CampaignResult {
  const mission = content.missions[missionId];
  if (!mission) return fail(state, 'err.missionNotLoaded', { id: missionId });
  for (const p of mission.prerequisites) if (!state.campaign.completed[p]) return fail(state, 'err.prerequisite', { id: p });
  const events: EngineEvent[] = [];
  const next = produce(state, (d) => {
    d.campaign.currentMissionId = mission.id;
    d.campaign.active = {
      id: mission.id,
      phase: 'briefing',
      startedAt: d.clock,
      pinned: [],
      evidence: [],
      hypothesis: null,
      wrongHypotheses: [],
      choices: {},
      ops: [],
      actions: 0,
      baseline: null,
      simRuns: 0,
      lastChangeSeq: d.seq,
      lastSimSeq: -1,
      objectivesMet: [],
      attemptId: null,
    };
    mergeUnlocks(d.unlocks, mission.unlocks, events);
    applyEffects(d, content, mission.setup, events, mission.id);
    fireDueConsequences(d, content, events);
    addMail(d, mission.trigger, 'trigger', mission.id, events);
    for (const dlg of mission.dialogue ?? []) {
      if (dlg.when !== undefined) continue;
      addMail(d, { id: `${mission.id}:${dlg.id}`, from: dlg.npc, subject: mission.title, body: dlg.text, dialogue: dlg.id }, 'dialogue', mission.id, events);
    }
    for (const k of mission.learning) raiseKnowledge(d, k, 'discovered', 1);
    d.seq += 1;
    d.timeline.push({ at: d.clock, kind: 'mission', key: 'timeline.missionStart', params: { id: mission.id } });
  });
  return { state: next, events, ok: true };
}

/** Record the baseline simulation of a freshly started mission ("metrics before"). */
export function recordSimulation(state: GameState, content: ContentBundle, sim: SimResult): CampaignResult {
  const events: EngineEvent[] = [];
  const next = produce(state, (d) => {
    d.stats.simRuns += 1;
    d.quality = { ...sim.quality };
    const act = d.campaign.active;
    if (!act) return;
    act.simRuns += 1;
    act.lastSimSeq = d.seq;
    if (!act.baseline) act.baseline = deepClone(sim.snapshot);
    if (act.phase === 'briefing') act.phase = 'investigating';
    // dialogues that arrive when a condition holds
    const mission = content.missions[act.id];
    const facts = computeFacts(d as GameState, content, sim);
    for (const dlg of mission?.dialogue ?? []) {
      if (dlg.when === undefined) continue;
      const mailId = `${mission!.id}:${dlg.id}`;
      if (d.mail.some((m) => m.id === mailId)) continue;
      if (evaluate(dlg.when, facts)) addMail(d, { id: mailId, from: dlg.npc, subject: mission!.title, body: dlg.text, dialogue: dlg.id }, 'dialogue', mission!.id, events);
    }
    const status = objectiveStatus(d as GameState, content, sim);
    act.objectivesMet = status.filter((o) => o.met).map((o) => o.id);
    if (status.length && status.every((o) => o.met)) {
      if (act.phase !== 'resolved') events.push({ type: 'sound', key: 'success' });
      act.phase = 'resolved';
    } else if (act.phase === 'resolved') act.phase = 'investigating';
    checkAchievements(d, content, facts, events);
  });
  return { state: next, events, ok: true };
}

export interface ObjectiveState {
  id: string;
  met: boolean;
  needsSim: boolean;
}

export function objectiveStatus(state: GameState, content: ContentBundle, sim: SimResult | null): ObjectiveState[] {
  const act = state.campaign.active;
  if (!act) return [];
  const mission = content.missions[act.id];
  if (!mission) return [];
  const fresh = !!sim && act.lastSimSeq === state.seq && sim.seq === state.seq;
  const facts = computeFacts(state, content, fresh ? sim : null);
  return mission.objectives.map((o) => ({ id: o.id, needsSim: !!o.sim, met: (!o.sim || fresh) && evaluate(o.check, facts) }));
}

/* ------------------------------------------------------------------ */
/* investigation                                                       */
/* ------------------------------------------------------------------ */

export function chooseHypothesis(state: GameState, content: ContentBundle, hypothesisId: string): CampaignResult {
  const act = state.campaign.active;
  if (!act) return fail(state, 'err.noMission');
  const mission = content.missions[act.id];
  const h = mission?.hypotheses?.find((x) => x.id === hypothesisId);
  if (!mission || !h) return fail(state, 'err.noHypothesis');
  const needed = Math.min(1, mission.evidence?.length ?? 0);
  if (act.evidence.length < needed) return fail(state, 'err.needEvidence');
  const events: EngineEvent[] = [];
  const next = produce(state, (d) => {
    const a = d.campaign.active!;
    a.hypothesis = h.id;
    if (!h.correct) {
      if (!a.wrongHypotheses.includes(h.id)) a.wrongHypotheses.push(h.id);
      d.stats.wrongHypotheses += 1;
      events.push({ type: 'sound', key: 'warning' });
    } else {
      for (const k of mission.learning) raiseKnowledge(d, k, 'understood', 1);
      events.push({ type: 'sound', key: 'success' });
    }
    d.decisionLog.push({ seq: d.seq, at: d.clock, missionId: mission.id, action: 'mission.hypothesis', summary: `hypothesis=${h.id} correct=${h.correct}` });
  });
  return { state: next, events, ok: true };
}

export function chooseDialogue(state: GameState, content: ContentBundle, dialogueId: string, choiceId: string): CampaignResult {
  const act = state.campaign.active;
  if (!act) return fail(state, 'err.noMission');
  const mission = content.missions[act.id];
  const dlg = mission?.dialogue?.find((x) => x.id === dialogueId);
  const choice = dlg?.choices.find((c) => c.id === choiceId);
  if (!mission || !dlg || !choice) return fail(state, 'err.noChoice');
  if (act.choices[dialogueId]) return fail(state, 'err.alreadyChosen');
  const events: EngineEvent[] = [];
  const next = produce(state, (d) => {
    d.campaign.active!.choices[dialogueId] = choiceId;
    applyCodeAwareEffects(d, content, choice.effects, events, mission.id, false);
    if (choice.reply) addMail(d, { id: `${mission.id}:${dialogueId}:reply`, from: dlg.npc, subject: mission.title, body: choice.reply }, 'reply', mission.id, events);
    d.seq += 1;
    d.decisionLog.push({ seq: d.seq, at: d.clock, missionId: mission.id, action: 'mission.choice', summary: `${dialogueId}=${choiceId}` });
  });
  return { state: next, events, ok: true };
}

export function performOp(state: GameState, content: ContentBundle, opId: string, sim: SimResult | null): CampaignResult {
  const act = state.campaign.active;
  if (!act) return fail(state, 'err.noMission');
  const mission = content.missions[act.id];
  const op = mission?.ops?.find((o) => o.id === opId);
  if (!mission || !op) return fail(state, 'err.noOp');
  if (op.once !== false && act.ops.includes(opId)) return fail(state, 'err.opDone');
  if (op.when !== undefined && !evaluate(op.when, computeFacts(state, content, sim))) return fail(state, 'err.opUnavailable');
  const events: EngineEvent[] = [];
  const next = produce(state, (d) => {
    if (!d.campaign.active!.ops.includes(opId)) d.campaign.active!.ops.push(opId);
    applyCodeAwareEffects(d, content, op.effects, events, mission.id, !!op.code);
    d.seq += 1;
    d.campaign.active!.actions += 1;
    d.decisionLog.push({ seq: d.seq, at: d.clock, missionId: mission.id, action: 'mission.op', summary: opId });
  });
  return { state: next, events, ok: true };
}

/**
 * Code changes (app.* settings, bug fixes) wait for a deploy once the release pipeline
 * exists; everything else (infrastructure, story) applies immediately.
 */
function applyCodeAwareEffects(d: Draft<GameState>, content: ContentBundle, effects: Effect[] | undefined, events: EngineEvent[], missionId: string, isCode: boolean) {
  if (!effects) return;
  if (!isCode || !d.world.deploy.requireDeploy) {
    applyEffects(d, content, effects, events, missionId);
    return;
  }
  const immediate: Effect[] = [];
  for (const e of effects) {
    if ('set' in e && e.set.startsWith('app.')) d.world.deploy.pending[e.set.slice(4)] = e.value as never;
    else if ('fixBug' in e) {
      if (!d.world.deploy.pendingFixes.includes(e.fixBug)) d.world.deploy.pendingFixes.push(e.fixBug);
    } else immediate.push(e);
  }
  applyEffects(d, content, immediate, events, missionId);
  events.push({ type: 'toast', key: 'toast.pendingDeploy' });
}

export function runAttackLab(state: GameState, content: ContentBundle, attackId: string, sim: SimResult | null): CampaignResult {
  const attack = content.attacks.find((a) => a.id === attackId);
  if (!attack) return fail(state, 'err.noAttack');
  if (!state.unlocks.attacks.includes(attackId)) return fail(state, 'err.locked');
  const facts = computeFacts(state, content, sim);
  const result = runAttack(attack, facts, state.clock, state.seq);
  const events: EngineEvent[] = [{ type: 'sound', key: result.success ? 'incident' : 'success' }];
  const next = produce(state, (d) => {
    d.attackResults[attackId] = result;
    d.stats.attacksRun += 1;
    if (!result.success) d.stats.attacksBlocked += 1;
    if (result.success) raiseKnowledge(d, attack.knowledge, 'discovered', 0);
    else raiseKnowledge(d, attack.knowledge, 'understood', 1);
  });
  return { state: next, events, ok: true };
}

/* ------------------------------------------------------------------ */
/* completion                                                          */
/* ------------------------------------------------------------------ */

export function pickSolution(mission: MissionDef, facts: Record<string, unknown>): SolutionDef | null {
  for (const s of mission.solutions) if (evaluate(s.when, facts as never)) return s;
  return null;
}

export interface CompletionReport {
  summary: MissionSummary;
  solution: SolutionDef | null;
  consequencesScheduled: string[];
  achievements: string[];
  knowledge: { id: string; level: KnowledgeLevel }[];
  cashDelta: number;
}

export function completeMission(state: GameState, content: ContentBundle, sim: SimResult): CampaignResult & { report?: CompletionReport } {
  const act = state.campaign.active;
  if (!act) return fail(state, 'err.noMission');
  const mission = content.missions[act.id];
  if (!mission) return fail(state, 'err.missionNotLoaded');
  const status = objectiveStatus(state, content, sim);
  if (!status.every((o) => o.met)) return fail(state, 'err.objectivesNotMet');
  const facts = computeFacts(state, content, sim);
  const solution = pickSolution(mission, facts);
  const events: EngineEvent[] = [];
  const scheduled: string[] = [];
  const newAchievements: string[] = [];
  const knowledgeChanges: { id: string; level: KnowledgeLevel }[] = [];
  let cashDelta = 0;
  const hypCorrect = mission.hypotheses?.length ? !!mission.hypotheses.find((h) => h.id === act.hypothesis)?.correct : null;

  const next = produce(state, (d) => {
    const a = d.campaign.active!;
    const debtBefore = d.debt;
    if (solution) {
      applyEffects(d, content, solution.effects, events, mission.id);
      if (solution.debt) d.debt = Math.max(0, Math.min(100, d.debt + solution.debt));
      for (const c of solution.consequences ?? []) {
        d.consequences.push({ id: c.id, missionId: mission.id, fireAtCompleted: d.campaign.completedOrder.length + 1 + c.delay, def: deepClone(c) });
        scheduled.push(c.id);
      }
    }
    // knowledge
    const good = !solution || solution.kind === 'good' || solution.kind === 'acceptable';
    for (const k of mission.learning) {
      const level: KnowledgeLevel = good && hypCorrect !== false ? 'practiced' : 'understood';
      const changed = raiseKnowledge(d, k, level, good ? 2 : 1);
      const kp = d.knowledge[k];
      if (kp && kp.state === 'practiced' && kp.score >= 6 && a.wrongHypotheses.length === 0) {
        kp.state = 'mastered';
        knowledgeChanges.push({ id: k, level: 'mastered' });
      } else if (changed) knowledgeChanges.push({ id: k, level });
      if (kp) kp.lastPracticedAt = d.clock;
    }
    // mission achievements
    for (const ach of mission.achievements ?? []) {
      if (!d.achievements[ach.id] && evaluate(ach.when, facts)) {
        d.achievements[ach.id] = d.clock;
        newAchievements.push(ach.id);
        events.push({ type: 'achievement', key: 'achievement.unlocked', params: { id: ach.id } });
      }
    }
    // rewards & time passing: revenue minus infrastructure cost over the elapsed days
    const days = mission.rewards?.days ?? 3;
    const revenue = revenuePerMonth(d as GameState, sim.summary.availability);
    const net = Math.round(((revenue - sim.cost.total) * days) / 30);
    d.budget.cash += net;
    d.budget.ledger.push({ at: d.clock, amount: net, key: 'operations' });
    cashDelta += net;
    if (mission.rewards?.cash) {
      d.budget.cash += mission.rewards.cash;
      d.budget.ledger.push({ at: d.clock, amount: mission.rewards.cash, key: `mission.${mission.id}` });
      cashDelta += mission.rewards.cash;
    }
    if (mission.rewards?.users) d.world.traffic.users += mission.rewards.users;
    advanceTime(d, days * 1440);
    // resolve side incidents whose condition now holds
    resolveSideIncidents(d, content, facts, events);

    const summary: MissionSummary = {
      id: mission.id,
      result: 'success',
      solutionId: solution?.id ?? null,
      solutionKind: solution?.kind ?? null,
      completedAt: d.clock,
      before: a.baseline ? deepClone(a.baseline) : null,
      after: deepClone(sim.snapshot),
      hypothesisCorrect: hypCorrect,
      wrongHypotheses: a.wrongHypotheses.length,
      debtDelta: d.debt - debtBefore,
      evidence: a.evidence.length,
    };
    d.campaign.completed[mission.id] = summary;
    d.campaign.completedOrder.push(mission.id);
    d.campaign.active = null;
    d.campaign.currentMissionId = mission.next;
    if (!mission.next) d.campaign.finished = true;
    d.quality = { ...sim.quality };
    d.timeline.push({ at: d.clock, kind: 'mission', key: 'timeline.missionDone', params: { id: mission.id, solution: solution?.id ?? '-' } });
    d.seq += 1;
    const postFacts = computeFacts(d as GameState, content, sim);
    for (const id of checkAchievements(d, content, postFacts, events)) newAchievements.push(id);
  });

  const summary = next.campaign.completed[mission.id];
  return {
    state: next,
    events,
    ok: true,
    report: { summary, solution, consequencesScheduled: scheduled, achievements: newAchievements, knowledge: knowledgeChanges, cashDelta },
  };
}

/* ------------------------------------------------------------------ */
/* consequences, knowledge, achievements                               */
/* ------------------------------------------------------------------ */

export function fireDueConsequences(d: Draft<GameState>, content: ContentBundle, events: EngineEvent[]) {
  const done = d.campaign.completedOrder.length;
  const facts = computeFacts(d as GameState, content, null);
  const remaining = [];
  for (const c of d.consequences) {
    if (c.fireAtCompleted > done) {
      remaining.push(c);
      continue;
    }
    if (evaluate(c.def.when, facts)) {
      applyEffects(d, content, c.def.effects, events, c.missionId);
      addMail(d, c.def.mail, 'consequence', c.missionId, events);
      d.firedConsequences.push(c.id);
      d.timeline.push({ at: d.clock, kind: 'consequence', key: 'timeline.consequence', params: { id: c.id, from: c.missionId } });
      events.push({ type: 'consequence', key: 'consequence.fired', params: { id: c.id } });
    } else {
      d.timeline.push({ at: d.clock, kind: 'consequence', key: 'timeline.consequenceAvoided', params: { id: c.id, from: c.missionId } });
    }
  }
  d.consequences = remaining;
}

/** Monotonic knowledge progression; returns true when the level increased. */
export function raiseKnowledge(d: Draft<GameState>, id: string, level: KnowledgeLevel, score: number): boolean {
  const kp = d.knowledge[id] ?? (d.knowledge[id] = { state: 'locked', score: 0, lastPracticedAt: null });
  kp.score += score;
  if (KNOWLEDGE_LEVELS.indexOf(level) > KNOWLEDGE_LEVELS.indexOf(kp.state)) {
    kp.state = level;
    return true;
  }
  return false;
}

export function checkAchievements(d: Draft<GameState>, content: ContentBundle, facts: Record<string, unknown>, events: EngineEvent[]): string[] {
  const out: string[] = [];
  for (const ach of content.achievements) {
    if (!ach.when || d.achievements[ach.id]) continue;
    if (evaluate(ach.when, facts as never)) {
      d.achievements[ach.id] = d.clock;
      out.push(ach.id);
      events.push({ type: 'achievement', key: 'achievement.unlocked', params: { id: ach.id } });
      d.timeline.push({ at: d.clock, kind: 'achievement', key: 'timeline.achievement', params: { id: ach.id } });
    }
  }
  return out;
}

function resolveSideIncidents(d: Draft<GameState>, content: ContentBundle, facts: Record<string, unknown>, events: EngineEvent[]) {
  for (const inc of d.world.incidents) {
    if (!inc.active || !inc.resolvedWhen) continue;
    if (evaluate(inc.resolvedWhen, facts as never)) {
      inc.active = false;
      if (inc.reward) {
        d.budget.cash += inc.reward;
        d.budget.ledger.push({ at: d.clock, amount: inc.reward, key: `incident.${inc.id}` });
      }
      events.push({ type: 'toast', key: 'toast.incidentResolved', params: { id: inc.id } });
    }
  }
  void content;
}

/* ------------------------------------------------------------------ */
/* living production (after the campaign)                              */
/* ------------------------------------------------------------------ */

export interface LivingTemplate {
  kind: WorldIncident['kind'];
  target?: string;
  params?: Record<string, number | string>;
  title: { en: string; ru: string };
  resolvedWhen: WorldIncident['resolvedWhen'];
  reward: number;
}

/** Advance one "day" of living production: resolve what was fixed, maybe spawn a new incident. */
export function nextLivingDay(state: GameState, content: ContentBundle, pool: LivingTemplate[], sim: SimResult | null): CampaignResult {
  if (!state.campaign.finished) return fail(state, 'err.campaignNotFinished');
  const events: EngineEvent[] = [];
  const next = produce(state, (d) => {
    const facts = computeFacts(d as GameState, content, sim);
    resolveSideIncidents(d, content, facts, events);
    d.campaign.livingDay += 1;
    advanceTime(d, 1440);
    const rng = createRng(combineSeed(d.seed, 'living', d.campaign.livingDay));
    const revenue = revenuePerMonth(d as GameState, sim?.summary.availability ?? 1);
    const cost = sim?.cost.total ?? 0;
    const net = Math.round((revenue - cost) / 30);
    d.budget.cash += net;
    d.budget.ledger.push({ at: d.clock, amount: net, key: 'operations' });
    if (pool.length && d.world.incidents.filter((i) => i.active && i.source === 'living').length < 2 && rng.chance(0.7)) {
      const tpl = pool[rng.int(0, pool.length - 1)];
      const inc: WorldIncident = {
        id: `living-${d.campaign.livingDay}`,
        kind: tpl.kind,
        title: tpl.title,
        target: tpl.target,
        params: tpl.params,
        startTick: rng.int(5, 30),
        source: 'living',
        active: true,
        resolvedWhen: tpl.resolvedWhen,
        reward: tpl.reward,
      };
      d.world.incidents.push(inc);
      addMail(d, { id: `living-mail-${d.campaign.livingDay}`, from: 'alerts', subject: tpl.title, body: { en: `New production event: ${tpl.title.en}. Investigate with your tools.`, ru: `Новое событие в проде: ${tpl.title.ru}. Разберитесь с помощью инструментов.` } }, 'alert', undefined, events);
    }
    d.seq += 1;
  });
  return { state: next, events, ok: true };
}

export function nextMissionId(state: GameState): string | null {
  return state.campaign.currentMissionId;
}

export function missionAct(content: ContentBundle, id: string): number | null {
  return content.missionIndex.find((m) => m.id === id)?.act ?? null;
}

/** Ensure pending pins are re-matched after content for the mission arrives (lazy loading). */
export function rematchEvidence(state: GameState, content: ContentBundle): GameState {
  return produce(state, (d) => {
    matchEvidence(d, content, []);
  });
}
