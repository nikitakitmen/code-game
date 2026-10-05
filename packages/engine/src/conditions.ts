import type { Condition, FactValue } from './types';

export type Facts = Record<string, FactValue>;

export function evaluate(cond: Condition | undefined, facts: Facts): boolean {
  if (cond === undefined || cond === true) return true;
  if (cond === false) return false;
  if ('all' in cond) return cond.all.every((c) => evaluate(c, facts));
  if ('any' in cond) return cond.any.some((c) => evaluate(c, facts));
  if ('not' in cond) return !evaluate(cond.not, facts);
  const v = facts[cond.fact];
  if (cond.eq !== undefined && v !== cond.eq) return false;
  if (cond.ne !== undefined && v === cond.ne) return false;
  if (cond.in !== undefined && !cond.in.includes(v ?? null)) return false;
  if (cond.truthy && !v) return false;
  if (cond.falsy && v) return false;
  const num = typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : NaN;
  if (cond.lt !== undefined && !(num < cond.lt)) return false;
  if (cond.lte !== undefined && !(num <= cond.lte)) return false;
  if (cond.gt !== undefined && !(num > cond.gt)) return false;
  if (cond.gte !== undefined && !(num >= cond.gte)) return false;
  return true;
}

/** All fact names referenced by a condition (used by content validation). */
export function referencedFacts(cond: Condition | undefined, out: Set<string> = new Set()): Set<string> {
  if (cond === undefined || typeof cond === 'boolean') return out;
  if ('all' in cond) cond.all.forEach((c) => referencedFacts(c, out));
  else if ('any' in cond) cond.any.forEach((c) => referencedFacts(c, out));
  else if ('not' in cond) referencedFacts(cond.not, out);
  else out.add(cond.fact);
  return out;
}
