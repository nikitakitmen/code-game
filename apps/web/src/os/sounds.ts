'use client';
/** Synthesised retro system sounds — no audio files, generated with the Web Audio API. */

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    } catch {
      return null;
    }
  }
  return ctx;
}

type Note = { f: number; d: number; type?: OscillatorType; v?: number };

const PATCHES: Record<string, Note[]> = {
  boot: [
    { f: 330, d: 0.12, type: 'triangle' },
    { f: 440, d: 0.12, type: 'triangle' },
    { f: 660, d: 0.22, type: 'triangle' },
  ],
  click: [{ f: 720, d: 0.03, type: 'square', v: 0.2 }],
  drop: [{ f: 320, d: 0.05, type: 'square' }, { f: 520, d: 0.05, type: 'square' }],
  connect: [{ f: 540, d: 0.04, type: 'square' }, { f: 820, d: 0.06, type: 'square' }],
  window: [{ f: 600, d: 0.05, type: 'sine' }],
  mail: [{ f: 880, d: 0.08, type: 'sine' }, { f: 1180, d: 0.08, type: 'sine' }],
  warning: [{ f: 300, d: 0.14, type: 'sawtooth', v: 0.25 }],
  incident: [{ f: 220, d: 0.16, type: 'sawtooth', v: 0.3 }, { f: 180, d: 0.22, type: 'sawtooth', v: 0.3 }],
  success: [{ f: 660, d: 0.08, type: 'triangle' }, { f: 880, d: 0.08, type: 'triangle' }, { f: 1100, d: 0.14, type: 'triangle' }],
  evidence: [{ f: 980, d: 0.05, type: 'sine' }, { f: 1320, d: 0.07, type: 'sine' }],
  deploy: [{ f: 440, d: 0.06, type: 'square' }, { f: 660, d: 0.06, type: 'square' }, { f: 990, d: 0.1, type: 'square' }],
  achievement: [{ f: 523, d: 0.1, type: 'triangle' }, { f: 659, d: 0.1, type: 'triangle' }, { f: 784, d: 0.1, type: 'triangle' }, { f: 1046, d: 0.2, type: 'triangle' }],
  rollback: [{ f: 520, d: 0.08, type: 'square' }, { f: 320, d: 0.12, type: 'square' }],
};

export function play(key: string, volume = 0.5) {
  const a = audio();
  const notes = PATCHES[key];
  if (!a || !notes) return;
  if (a.state === 'suspended') a.resume().catch(() => {});
  let t = a.currentTime;
  for (const n of notes) {
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = n.type ?? 'square';
    osc.frequency.setValueAtTime(n.f, t);
    const peak = (n.v ?? 0.3) * volume;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + n.d);
    osc.connect(gain).connect(a.destination);
    osc.start(t);
    osc.stop(t + n.d + 0.02);
    t += n.d;
  }
}

export function resumeAudio() {
  const a = audio();
  if (a && a.state === 'suspended') a.resume().catch(() => {});
}
