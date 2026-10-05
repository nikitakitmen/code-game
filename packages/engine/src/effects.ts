import type { Draft } from 'immer';
import { componentDef } from './catalog';
import { mergeAt, pushAt, removeAt, setAt, getAt } from './paths';
import type { ArchNode, ContentBundle, Effect, GameState, MailDef, Unlocks, World } from './types';

export interface EngineEvent {
  type: 'toast' | 'sound' | 'mail' | 'achievement' | 'error' | 'unlock' | 'consequence' | 'deploy' | 'incident';
  key: string;
  params?: Record<string, string | number>;
}

const PUBLIC_ROLES = new Set(['proxy', 'lb', 'cdn', 'waf', 'backend']);

export function nextIp(world: World | Draft<World>, isPublic: boolean): string {
  const used = new Set(world.nodes.map((n) => n.ip));
  for (let i = isPublic ? 20 : 10; i < 250; i++) {
    const ip = isPublic ? `203.0.113.${i}` : `10.0.0.${i}`;
    if (!used.has(ip)) return ip;
  }
  return isPublic ? '203.0.113.250' : '10.0.0.250';
}

export function uniqueNodeId(world: World | Draft<World>, type: string): string {
  let i = 1;
  const ids = new Set(world.nodes.map((n) => n.id));
  while (ids.has(`${type}-${i}`)) i++;
  return `${type}-${i}`;
}

export function makeNode(content: ContentBundle, world: World | Draft<World>, partial: Partial<ArchNode> & { type: string; id?: string }, clock: number): ArchNode {
  const def = componentDef(content, partial.type);
  const id = partial.id ?? uniqueNodeId(world, partial.type);
  const sameType = world.nodes.filter((n) => n.type === partial.type).length;
  const isPublic = PUBLIC_ROLES.has(def.role);
  return {
    id,
    type: partial.type,
    name: partial.name ?? (sameType ? `${def.label.en}-${sameType + 1}` : def.label.en),
    region: partial.region ?? world.primaryRegion,
    pos: partial.pos ?? { x: 4, y: 4 },
    size: partial.size ?? 's',
    config: { ...def.defaults, ...(partial.config ?? {}) },
    ip: partial.ip ?? (def.external ? 'external' : nextIp(world, isPublic)),
    ports: partial.ports ?? [...def.defaultPorts],
    publicPorts: partial.publicPorts ?? (def.role === 'proxy' || def.role === 'lb' ? [80, 22] : def.role === 'client' || def.external ? [] : [22]),
    offline: partial.offline,
    locked: partial.locked,
    createdAt: partial.createdAt ?? clock,
  };
}

export function mergeUnlocks(target: Unlocks | Draft<Unlocks>, add: Partial<Unlocks> | undefined, events?: EngineEvent[]) {
  if (!add) return;
  for (const k of Object.keys(add) as (keyof Unlocks)[]) {
    for (const v of add[k] ?? []) {
      if (!target[k].includes(v)) {
        target[k].push(v);
        if (events && (k === 'apps' || k === 'components')) events.push({ type: 'unlock', key: `unlock.${k}`, params: { id: v } });
      }
    }
  }
}

export function addMail(state: Draft<GameState>, mail: MailDef, kind: GameState['mail'][number]['kind'], missionId?: string, events?: EngineEvent[]) {
  const id = state.mail.some((m) => m.id === mail.id) ? `${mail.id}#${state.mail.length}` : mail.id;
  state.mail.push({
    id,
    from: mail.from,
    subject: mail.subject,
    body: mail.body,
    at: state.clock,
    read: false,
    kind,
    missionId,
    dialogue: mail.dialogue,
  });
  events?.push({ type: 'mail', key: 'mail.new', params: { from: mail.from } });
}

/**
 * Apply data-driven effects (mission setup, ops, dialogue choices, solutions, consequences).
 * Paths in set/inc/push/remove/merge are relative to `world`.
 */
export function applyEffects(state: Draft<GameState>, content: ContentBundle, effects: Effect[] | undefined, events: EngineEvent[], missionId?: string) {
  if (!effects) return;
  const w = state.world;
  for (const e of effects) {
    if ('set' in e) setAt(w, e.set, structuredCloneSafe(e.value));
    else if ('inc' in e) setAt(w, e.inc, Number(getAt(w, e.inc) ?? 0) + e.by);
    else if ('push' in e) pushAt(w, e.push, structuredCloneSafe(e.value));
    else if ('remove' in e) removeAt(w, e.remove);
    else if ('merge' in e) mergeAt(w, e.merge, structuredCloneSafe(e.value) as Record<string, unknown>);
    else if ('addNode' in e) {
      if (!w.nodes.some((n) => n.id === e.addNode.id)) w.nodes.push(makeNode(content, w, e.addNode, state.clock));
    } else if ('removeNode' in e) {
      w.nodes = w.nodes.filter((n) => n.id !== e.removeNode);
      w.edges = w.edges.filter((x) => x.from !== e.removeNode && x.to !== e.removeNode);
    } else if ('connect' in e) {
      const [a, b] = e.connect;
      if (!w.edges.some((x) => x.from === a && x.to === b)) w.edges.push({ id: `${a}>${b}`, from: a, to: b });
    } else if ('disconnect' in e) {
      const [a, b] = e.disconnect;
      w.edges = w.edges.filter((x) => !(x.from === a && x.to === b));
    } else if ('debt' in e) state.debt = Math.max(0, Math.min(100, state.debt + e.debt));
    else if ('cash' in e) {
      state.budget.cash += e.cash;
      state.budget.ledger.push({ at: state.clock, amount: e.cash, key: missionId ? `mission.${missionId}` : 'event' });
    } else if ('users' in e) w.traffic.users = Math.max(0, w.traffic.users + e.users);
    else if ('mail' in e) addMail(state, e.mail, 'info', missionId, events);
    else if ('unlock' in e) mergeUnlocks(state.unlocks, e.unlock, events);
    else if ('flag' in e) w.flags[e.flag] = e.value;
    else if ('incident' in e) {
      const idx = w.incidents.findIndex((i) => i.id === e.incident.id);
      if (idx >= 0) w.incidents[idx] = structuredCloneSafe(e.incident);
      else w.incidents.push(structuredCloneSafe(e.incident));
      events.push({ type: 'incident', key: 'incident.new', params: { id: e.incident.id } });
    } else if ('resolveIncident' in e) {
      const inc = w.incidents.find((i) => i.id === e.resolveIncident);
      if (inc) inc.active = false;
    } else if ('fixBug' in e) {
      const bug = w.bugs.find((b) => b.id === e.fixBug);
      if (bug) bug.fixed = true;
    } else if ('addBug' in e) {
      const idx = w.bugs.findIndex((b) => b.id === e.addBug.id);
      if (idx >= 0) w.bugs[idx] = structuredCloneSafe(e.addBug);
      else w.bugs.push(structuredCloneSafe(e.addBug));
    } else if ('advance' in e) state.clock += e.advance;
  }
}

function structuredCloneSafe<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}
