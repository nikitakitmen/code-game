'use client';
import { create } from 'zustand';

export interface WinState {
  id: string; // app id
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  minimized: boolean;
  maximized: boolean;
  /** opaque payload the app can read (e.g. which request/node to focus) */
  arg?: unknown;
  prev?: { x: number; y: number; w: number; h: number };
}

interface WM {
  windows: WinState[];
  focusedId: string | null;
  topZ: number;
  open(id: string, arg?: unknown, size?: { w: number; h: number }): void;
  close(id: string): void;
  focus(id: string): void;
  move(id: string, x: number, y: number): void;
  resize(id: string, w: number, h: number): void;
  minimize(id: string): void;
  toggleMax(id: string): void;
  cascade(): void;
  tile(): void;
  setArg(id: string, arg: unknown): void;
}

type AppOpenedListener = (id: string) => void;
const openListeners = new Set<AppOpenedListener>();

/**
 * Subscribe to app launches. Fires when a window is created (closed → open) — not when an
 * already open window is focused or restored from minimize. Returns an unsubscribe function.
 */
export function onAppOpened(fn: AppOpenedListener): () => void {
  openListeners.add(fn);
  return () => openListeners.delete(fn);
}

const DEFAULTS: Record<string, { w: number; h: number }> = {
  mail: { w: 560, h: 420 },
  project: { w: 520, h: 420 },
  browser: { w: 560, h: 440 },
  files: { w: 520, h: 400 },
  terminal: { w: 600, h: 400 },
  help: { w: 520, h: 440 },
  encyclopedia: { w: 640, h: 500 },
  architecture: { w: 820, h: 560 },
  servers: { w: 560, h: 420 },
  database: { w: 680, h: 480 },
  inspector: { w: 680, h: 520 },
  api: { w: 640, h: 500 },
  network: { w: 620, h: 460 },
  dns: { w: 600, h: 440 },
  security: { w: 640, h: 500 },
  attacklab: { w: 620, h: 480 },
  monitoring: { w: 720, h: 500 },
  logs: { w: 720, h: 460 },
  traces: { w: 700, h: 480 },
  cicd: { w: 640, h: 500 },
  git: { w: 620, h: 460 },
  queue: { w: 600, h: 440 },
  cache: { w: 600, h: 440 },
  incidents: { w: 680, h: 500 },
  runbooks: { w: 600, h: 460 },
  finance: { w: 560, h: 440 },
  knowledge: { w: 760, h: 540 },
  timemachine: { w: 640, h: 480 },
};

function viewport() {
  if (typeof window === 'undefined') return { w: 1280, h: 800 };
  return { w: window.innerWidth, h: window.innerHeight };
}

export const useWM = create<WM>((set, get) => ({
  windows: [],
  focusedId: null,
  topZ: 10,

  open(id, arg, size) {
    const existing = get().windows.find((w) => w.id === id);
    const z = get().topZ + 1;
    if (existing) {
      set({
        windows: get().windows.map((w) => (w.id === id ? { ...w, minimized: false, z, arg: arg ?? w.arg } : w)),
        focusedId: id,
        topZ: z,
      });
      return;
    }
    const vp = viewport();
    const def = size ?? DEFAULTS[id] ?? { w: 560, h: 440 };
    const w = Math.min(def.w, vp.w - 40);
    const h = Math.min(def.h, vp.h - 80);
    const count = get().windows.length;
    const x = Math.min(60 + count * 26, vp.w - w - 20);
    const y = Math.min(48 + count * 22, vp.h - h - 20);
    set({
      windows: [...get().windows, { id, x, y, w, h, z, minimized: false, maximized: false, arg }],
      focusedId: id,
      topZ: z,
    });
    for (const fn of openListeners) fn(id);
  },
  close(id) {
    set({ windows: get().windows.filter((w) => w.id !== id), focusedId: get().focusedId === id ? null : get().focusedId });
  },
  focus(id) {
    const z = get().topZ + 1;
    set({ windows: get().windows.map((w) => (w.id === id ? { ...w, z, minimized: false } : w)), focusedId: id, topZ: z });
  },
  move(id, x, y) {
    set({ windows: get().windows.map((w) => (w.id === id ? { ...w, x, y } : w)) });
  },
  resize(id, w, h) {
    set({ windows: get().windows.map((win) => (win.id === id ? { ...win, w: Math.max(320, w), h: Math.max(220, h) } : win)) });
  },
  minimize(id) {
    set({ windows: get().windows.map((w) => (w.id === id ? { ...w, minimized: true } : w)) });
  },
  toggleMax(id) {
    const vp = viewport();
    set({
      windows: get().windows.map((w) => {
        if (w.id !== id) return w;
        if (w.maximized && w.prev) return { ...w, ...w.prev, maximized: false, prev: undefined };
        return { ...w, prev: { x: w.x, y: w.y, w: w.w, h: w.h }, x: 8, y: 36, w: vp.w - 16, h: vp.h - 52, maximized: true };
      }),
    });
  },
  cascade() {
    const vp = viewport();
    let i = 0;
    set({
      windows: get().windows
        .filter((w) => !w.minimized)
        .sort((a, b) => a.z - b.z)
        .map((w) => {
          const win: WinState = { ...w, x: 48 + i * 28, y: 44 + i * 24, maximized: false, prev: undefined };
          i++;
          return win;
        })
        .concat(get().windows.filter((w) => w.minimized)),
    });
    void vp;
  },
  tile() {
    const vp = viewport();
    const visible = get().windows.filter((w) => !w.minimized);
    const n = visible.length || 1;
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const gw = Math.floor((vp.w - 16) / cols);
    const gh = Math.floor((vp.h - 52) / rows);
    let i = 0;
    const tiled = visible.map((w) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      i++;
      const win: WinState = { ...w, x: 8 + c * gw, y: 36 + r * gh, w: gw - 8, h: gh - 8, maximized: false, prev: undefined };
      return win;
    });
    set({ windows: tiled.concat(get().windows.filter((w) => w.minimized)) });
  },
  setArg(id, arg) {
    set({ windows: get().windows.map((w) => (w.id === id ? { ...w, arg } : w)) });
  },
}));
