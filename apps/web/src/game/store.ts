'use client';
/**
 * The game store: a thin reactive shell around @prod/engine. It never puts game
 * rules here — it calls the engine and keeps the resulting GameState, the latest
 * simulation, derived facts, and UI concerns (locale, toasts, save status).
 */
import { create } from 'zustand';
import {
  newGame,
  reduce,
  simulate,
  computeFacts,
  startMission as engStart,
  recordSimulation,
  completeMission as engComplete,
  performOp as engOp,
  chooseHypothesis as engHyp,
  chooseDialogue as engDialogue,
  runAttackLab as engAttack,
  objectiveStatus,
  createCheckpoint,
  restoreCheckpoint,
  pruneCheckpoints,
  loadState,
  SAVE_SCHEMA_VERSION,
  type GameState,
  type GameAction,
  type ContentBundle,
  type SimResult,
  type Checkpoint,
  type Locale,
  type EngineEvent,
  type CompletionReport,
  type ObjectiveState,
} from '@prod/engine';
import { loadContent } from '@prod/content';
import { api } from './api';
import { t as i18nT } from '@/i18n';
import { play as playSfx } from '@/os/sounds';

const LOCAL_KEY = 'prod.save.v3';
const CP_KEY = 'prod.checkpoints.v3';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'warn' | 'error' | 'good';
}

export interface Modal {
  kind: 'company' | 'auth' | 'guestConflict' | 'debrief' | 'achievement';
  report?: CompletionReport;
  achievementId?: string;
}

interface GameStore {
  content: ContentBundle;
  state: GameState;
  sim: SimResult;
  facts: Record<string, unknown>;
  locale: Locale;
  volume: number;
  muted: boolean;
  reduceMotion: boolean;
  revision: number;
  saveStatus: 'idle' | 'saving' | 'saved' | 'local' | 'conflict';
  toasts: Toast[];
  modal: Modal | null;
  checkpoints: Checkpoint[];
  booted: boolean;
  authed: boolean;

  boot(): void;
  dispatch(action: GameAction): boolean;
  runSim(): void;
  setLocale(l: Locale): void;
  setVolume(v: number): void;
  toggleMute(): void;
  toggleReduceMotion(): void;
  toast(text: string, tone?: Toast['tone']): void;
  dismissToast(id: number): void;
  openModal(m: Modal): void;
  closeModal(): void;

  // campaign
  startCurrentMission(): void;
  op(opId: string): void;
  hypothesis(id: string): void;
  dialogue(dialogueId: string, choiceId: string): void;
  attack(attackId: string): void;
  objectives(): ObjectiveState[];
  completeMission(): void;

  // time machine
  checkpoint(label: string): void;
  restore(id: string): void;

  // persistence
  save(): Promise<void>;
  syncFromServer(): Promise<void>;

  resetGame(): void;
}

let toastId = 1;

function applyEvents(get: () => GameStore, events: EngineEvent[]) {
  const { locale, toast, content } = get();
  for (const e of events) {
    if (e.type === 'error') toast(trKey(locale, e.key, e.params), 'error');
    else if (e.type === 'toast' || e.type === 'unlock' || e.type === 'deploy' || e.type === 'incident') toast(trKey(locale, e.key, e.params), e.type === 'incident' ? 'warn' : 'info');
    else if (e.type === 'consequence') toast(trKey(locale, e.key, e.params), 'warn');
    else if (e.type === 'achievement') {
      const id = String(e.params?.id ?? '');
      const def = content.achievements.find((a) => a.id === id);
      toast(def ? `🏆 ${def.title[locale] ?? def.title.en}` : trKey(locale, e.key), 'good');
    }
    if (e.type === 'sound') playSound(get, e.key);
  }
}

function trKey(locale: Locale, key: string, params?: Record<string, string | number>): string {
  return i18nT(locale, key, params);
}

function playSound(get: () => GameStore, key: string) {
  const { muted, volume } = get();
  if (muted) return;
  playSfx(key, volume);
}

function persistLocal(state: GameState, revision: number) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ revision, state }));
  } catch {
    /* ignore */
  }
}
function persistCheckpoints(cps: Checkpoint[]) {
  try {
    localStorage.setItem(CP_KEY, JSON.stringify(cps));
  } catch {
    /* ignore */
  }
}

function freshSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
}

export const useGame = create<GameStore>((set, get) => {
  const content = loadContent();
  const state = newGame(content, freshSeed());
  const sim = simulate(state, content);
  return {
    content,
    state,
    sim,
    facts: computeFacts(state, content, sim),
    locale: 'en',
    volume: 0.5,
    muted: false,
    reduceMotion: false,
    revision: 0,
    saveStatus: 'idle',
    toasts: [],
    modal: null,
    checkpoints: [],
    booted: false,
    authed: false,

    boot() {
      set({ booted: true });
      void get().syncFromServer();
    },

    dispatch(action) {
      const { state, content } = get();
      const r = reduce(state, action, content);
      applyEvents(get, r.events);
      if (r.ok) {
        const sim = simulate(r.state, content);
        set({ state: r.state, sim, facts: computeFacts(r.state, content, sim) });
        maybeAutoSave(get, set);
      }
      return r.ok;
    },

    runSim() {
      const { state, content } = get();
      const sim = simulate(state, content);
      const rec = recordSimulation(state, content, sim);
      applyEvents(get, rec.events);
      const sim2 = simulate(rec.state, content);
      set({ state: rec.state, sim: sim2, facts: computeFacts(rec.state, content, sim2) });
      syncMeta(get);
    },

    setLocale(l) {
      set({ locale: l });
      void persistSettings(get);
    },
    setVolume(v) {
      set({ volume: v });
      void persistSettings(get);
    },
    toggleMute() {
      set({ muted: !get().muted });
      void persistSettings(get);
    },
    toggleReduceMotion() {
      set({ reduceMotion: !get().reduceMotion });
      void persistSettings(get);
    },
    toast(text, tone = 'info') {
      const id = toastId++;
      set({ toasts: [...get().toasts, { id, text, tone }] });
      setTimeout(() => get().dismissToast(id), 4200);
    },
    dismissToast(id) {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    },
    openModal(m) {
      set({ modal: m });
    },
    closeModal() {
      set({ modal: null });
    },

    startCurrentMission() {
      const { state, content } = get();
      const id = state.campaign.currentMissionId;
      if (!id || state.campaign.active || !content.missions[id]) return;
      const mission = content.missions[id];
      if (mission.checkpoint) {
        const cp = createCheckpoint(state, 'mission-start', titleOf(get, mission.id));
        const cps = pruneCheckpoints([...get().checkpoints, cp]);
        set({ checkpoints: cps });
        persistCheckpoints(cps);
        void api.saveCheckpoint(state, 'mission-start', titleOf(get, mission.id), mission.id);
      }
      const r = engStart(state, content, id);
      applyEvents(get, r.events);
      if (r.ok) {
        const sim = simulate(r.state, content);
        const rec = recordSimulation(r.state, content, sim);
        const sim2 = simulate(rec.state, content);
        set({ state: rec.state, sim: sim2, facts: computeFacts(rec.state, content, sim2) });
        maybeAutoSave(get, set);
      }
    },

    op(opId) {
      const { state, content, sim } = get();
      const r = engOp(state, content, opId, sim);
      applyEvents(get, r.events);
      if (r.ok) {
        const s2 = simulate(r.state, content);
        set({ state: r.state, sim: s2, facts: computeFacts(r.state, content, s2) });
        maybeAutoSave(get, set);
      }
    },
    hypothesis(id) {
      const { state, content } = get();
      const r = engHyp(state, content, id);
      applyEvents(get, r.events);
      if (r.ok) set({ state: r.state, facts: computeFacts(r.state, content, get().sim) });
    },
    dialogue(dialogueId, choiceId) {
      const { state, content } = get();
      const r = engDialogue(state, content, dialogueId, choiceId);
      applyEvents(get, r.events);
      if (r.ok) {
        const s2 = simulate(r.state, content);
        set({ state: r.state, sim: s2, facts: computeFacts(r.state, content, s2) });
      }
    },
    attack(attackId) {
      const { state, content, sim } = get();
      const r = engAttack(state, content, attackId, sim);
      applyEvents(get, r.events);
      if (r.ok) set({ state: r.state, facts: computeFacts(r.state, content, get().sim) });
    },
    objectives() {
      const { state, content, sim } = get();
      return objectiveStatus(state, content, sim);
    },
    completeMission() {
      const { state, content } = get();
      const sim = simulate(state, content);
      const rec = recordSimulation(state, content, sim).state;
      const r = engComplete(rec, content, sim);
      applyEvents(get, r.events);
      if (r.ok) {
        const s2 = simulate(r.state, content);
        set({ state: r.state, sim: s2, facts: computeFacts(r.state, content, s2), modal: r.report ? { kind: 'debrief', report: r.report } : null });
        syncMeta(get);
        void get().save();
      } else if (r.events.some((e) => e.type === 'error')) {
        // objectives not met — surfaced via toast already
      }
    },

    checkpoint(label) {
      const { state } = get();
      const cp = createCheckpoint(state, 'manual', label || 'Checkpoint');
      const cps = pruneCheckpoints([...get().checkpoints, cp]);
      set({ checkpoints: cps });
      persistCheckpoints(cps);
      void api.saveCheckpoint(state, 'manual', label || 'Checkpoint', state.campaign.currentMissionId);
      get().toast(trKey(get().locale, 'tm.create'), 'good');
    },
    restore(id) {
      const { state, content, checkpoints } = get();
      const cp = checkpoints.find((c) => c.id === id);
      if (!cp) return;
      const { state: restored, backup } = restoreCheckpoint(state, cp);
      const cps = pruneCheckpoints([...checkpoints, backup]);
      const sim = simulate(restored, content);
      set({ state: restored, sim, facts: computeFacts(restored, content, sim), checkpoints: cps });
      persistCheckpoints(cps);
      maybeAutoSave(get, set);
    },

    async save() {
      const { state, revision } = get();
      persistLocal(state, revision);
      set({ saveStatus: 'saving' });
      const r = await api.putSave(state, revision);
      if (r === 'conflict') set({ saveStatus: 'conflict' });
      else if (r) set({ revision: r.revision, saveStatus: 'saved' });
      else set({ saveStatus: 'local' });
    },

    async syncFromServer() {
      set({ authed: api.isAuthed() });
      await api.ensureGuest();
      const remote = await api.loadSave();
      const local = readLocal();
      const { content } = get();
      let chosen: { state: GameState; revision: number } | null = null;
      if (remote && local) {
        chosen = completed(remote.state) >= completed(local.state) ? remote : { state: local.state, revision: remote.revision };
      } else chosen = remote ?? local;
      if (chosen) {
        try {
          const loaded = loadState(chosen.state, content);
          const sim = simulate(loaded, content);
          set({ state: loaded, sim, facts: computeFacts(loaded, content, sim), revision: chosen.revision, saveStatus: remote ? 'saved' : 'local' });
        } catch {
          /* corrupt save: keep the fresh game */
        }
      }
      const cps = readCheckpoints();
      if (cps.length) set({ checkpoints: cps });
      set({ authed: api.isAuthed() });
    },

    resetGame() {
      const content = get().content;
      const state = newGame(content, freshSeed());
      const sim = simulate(state, content);
      set({ state, sim, facts: computeFacts(state, content, sim), revision: 0, checkpoints: [], modal: null });
      persistLocal(state, 0);
    },
  };
});

/* ----- helpers outside the store ----- */

function readLocal(): { state: GameState; revision: number } | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return { state: parsed.state, revision: parsed.revision ?? 0 };
  } catch {
    return null;
  }
}
function readCheckpoints(): Checkpoint[] {
  try {
    const raw = localStorage.getItem(CP_KEY);
    return raw ? (JSON.parse(raw) as Checkpoint[]) : [];
  } catch {
    return [];
  }
}
function completed(s: GameState): number {
  return s.campaign.completedOrder?.length ?? 0;
}
function titleOf(get: () => GameStore, missionId: string): string {
  const { content, locale } = get();
  const m = content.missions[missionId];
  return m ? m.title[locale] ?? m.title.en : missionId;
}

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
function maybeAutoSave(get: () => GameStore, set: (p: Partial<GameStore>) => void) {
  persistLocal(get().state, get().revision);
  set({ saveStatus: 'idle' });
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => void get().save(), 2500);
}

function syncMeta(get: () => GameStore) {
  const { state } = get();
  const prog = Object.entries(state.knowledge)
    .filter(([, k]) => k.state !== 'locked')
    .map(([id, k]) => ({ id, state: k.state, score: k.score }));
  void api.putKnowledge(prog);
  void api.unlockAchievements(Object.keys(state.achievements));
}

async function persistSettings(get: () => GameStore) {
  const { locale, volume, muted, reduceMotion } = get();
  try {
    localStorage.setItem('prod.settings', JSON.stringify({ locale, volume, muted, reduceMotion }));
  } catch {
    /* ignore */
  }
}

export function loadSettings(): Partial<Pick<GameStore, 'locale' | 'volume' | 'muted' | 'reduceMotion'>> {
  try {
    const raw = localStorage.getItem('prod.settings');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export { SAVE_SCHEMA_VERSION };
