import type { Locale, LText } from '@prod/engine';
import { STRINGS } from './strings';
import { ERROR_KEYS } from './keys';

export function t(locale: Locale, key: string, params?: Record<string, string | number>): string {
  let s = STRINGS[locale]?.[key] ?? STRINGS.en[key] ?? ERROR_KEYS[locale]?.[key] ?? ERROR_KEYS.en[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : `{${k}}`));
  return s;
}

export function tr(text: LText | string | undefined, locale: Locale): string {
  if (!text) return '';
  if (typeof text === 'string') return text;
  return text[locale] ?? text.en;
}
