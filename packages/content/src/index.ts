import type {
  AchievementDef,
  ActDef,
  AttackDef,
  CommandDef,
  ComponentDef,
  ContentBundle,
  InitialStateDef,
  KnowledgeNodeDef,
  MissionDef,
  MissionIndexEntry,
  NpcDef,
  SettingDef,
} from '@prod/engine';

import components from '../data/components.json';
import settings from '../data/settings.json';
import knowledge from '../data/knowledge.json';
import achievements from '../data/achievements.json';
import npcs from '../data/npcs.json';
import attacks from '../data/attacks.json';
import commands from '../data/commands.json';
import acts from '../data/acts.json';
import initial from '../data/initial-state.json';

import act01 from '../data/missions/act-01.json';
import act02 from '../data/missions/act-02.json';
import act03 from '../data/missions/act-03.json';
import act04 from '../data/missions/act-04.json';
import act05 from '../data/missions/act-05.json';
import act06 from '../data/missions/act-06.json';
import act07 from '../data/missions/act-07.json';
import act08 from '../data/missions/act-08.json';
import act09 from '../data/missions/act-09.json';
import act10 from '../data/missions/act-10.json';
import act11 from '../data/missions/act-11.json';
import act12 from '../data/missions/act-12.json';

export const CONTENT_VERSION = '1.0.0';

export const ACT_MISSIONS: Record<number, MissionDef[]> = {
  1: act01 as unknown as MissionDef[],
  2: act02 as unknown as MissionDef[],
  3: act03 as unknown as MissionDef[],
  4: act04 as unknown as MissionDef[],
  5: act05 as unknown as MissionDef[],
  6: act06 as unknown as MissionDef[],
  7: act07 as unknown as MissionDef[],
  8: act08 as unknown as MissionDef[],
  9: act09 as unknown as MissionDef[],
  10: act10 as unknown as MissionDef[],
  11: act11 as unknown as MissionDef[],
  12: act12 as unknown as MissionDef[],
};

export const ALL_MISSIONS: MissionDef[] = Object.values(ACT_MISSIONS)
  .flat()
  .sort((a, b) => a.order - b.order);

export const MISSION_INDEX: MissionIndexEntry[] = ALL_MISSIONS.map((m) => ({ id: m.id, slug: m.slug, act: m.act, order: m.order, title: m.title }));

function buildMissionMap(entries: MissionDef[]): Record<string, MissionDef> {
  const map: Record<string, MissionDef> = {};
  for (const m of entries) map[m.id] = m;
  return map;
}

/** Full content bundle with every mission loaded (used by the backend seeder and tests). */
export function loadContent(): ContentBundle {
  return {
    version: CONTENT_VERSION,
    components: components as unknown as ComponentDef[],
    settings: settings as unknown as SettingDef[],
    knowledge: knowledge as unknown as KnowledgeNodeDef[],
    achievements: achievements as unknown as AchievementDef[],
    npcs: npcs as unknown as NpcDef[],
    attacks: attacks as unknown as AttackDef[],
    commands: commands as unknown as CommandDef[],
    acts: acts as unknown as ActDef[],
    initial: initial as unknown as InitialStateDef,
    missionIndex: MISSION_INDEX,
    missions: buildMissionMap(ALL_MISSIONS),
  };
}

/** Bundle with only the given acts' missions loaded (the web client lazy-loads acts). */
export function loadContentForActs(actNumbers: number[]): ContentBundle {
  const bundle = loadContent();
  const loaded = new Set(actNumbers);
  bundle.missions = buildMissionMap(ALL_MISSIONS.filter((m) => loaded.has(m.act)));
  return bundle;
}

export function missionsForAct(act: number): MissionDef[] {
  return ACT_MISSIONS[act] ?? [];
}

export function missionById(id: string): MissionDef | undefined {
  return ALL_MISSIONS.find((m) => m.id === id);
}

export const CONTENT = loadContent();
