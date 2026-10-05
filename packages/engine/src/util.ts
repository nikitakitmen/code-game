import type { LText, Locale } from './types';

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
export const round = (v: number, digits = 0) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
export const max = (xs: number[]) => (xs.length ? Math.max(...xs) : 0);

export function tr(text: LText | string | undefined, locale: Locale): string {
  if (!text) return '';
  if (typeof text === 'string') return text;
  return text[locale] ?? text.en;
}

/** Fill {placeholders} in a string. */
export function fmt(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : `{${k}}`));
}

export function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Weighted percentile over (value, weight) pairs. */
export function weightedPercentile(points: { v: number; w: number }[], p: number): number {
  const pts = points.filter((x) => x.w > 0).sort((a, b) => a.v - b.v);
  const total = sum(pts.map((x) => x.w));
  if (!pts.length || total <= 0) return 0;
  let acc = 0;
  for (const pt of pts) {
    acc += pt.w;
    if (acc / total >= p) return pt.v;
  }
  return pts[pts.length - 1].v;
}

/** Minutes → "Day 3, 14:05" style parts */
export function clockParts(minutes: number) {
  const day = Math.floor(minutes / 1440) + 1;
  const m = ((minutes % 1440) + 1440) % 1440;
  const hh = Math.floor(m / 60);
  const mm = Math.floor(m % 60);
  return { day, hh, mm, hhmm: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` };
}

/** Day of week of the game clock: day 1 is a Monday. 0=Mon … 6=Sun */
export function weekday(minutes: number): number {
  return Math.floor(minutes / 1440) % 7;
}
