'use client';
import type { ComponentType } from 'react';
import { MailApp } from '@/apps/Mail';
import { ProjectApp } from '@/apps/Project';
import { BrowserApp } from '@/apps/Browser';
import { FilesApp } from '@/apps/Files';
import { TerminalApp } from '@/apps/Terminal';
import { HelpApp } from '@/apps/Help';
import { EncyclopediaApp } from '@/apps/Encyclopedia';
import { KnowledgeApp } from '@/apps/Knowledge';
import { ArchitectureApp } from '@/apps/Architecture';
import { ServersApp } from '@/apps/Servers';
import { DatabaseApp } from '@/apps/Database';
import { InspectorApp } from '@/apps/Inspector';
import { ApiApp } from '@/apps/ApiInspector';
import { NetworkApp } from '@/apps/Network';
import { DnsApp } from '@/apps/Dns';
import { MonitoringApp } from '@/apps/Monitoring';
import { LogsApp } from '@/apps/Logs';
import { TracesApp } from '@/apps/Traces';
import { SecurityApp } from '@/apps/Security';
import { AttackLabApp } from '@/apps/AttackLab';
import { GitApp } from '@/apps/Git';
import { CicdApp } from '@/apps/Cicd';
import { QueueApp } from '@/apps/Queue';
import { CacheApp } from '@/apps/Cache';
import { IncidentsApp } from '@/apps/Incidents';
import { RunbooksApp } from '@/apps/Runbooks';
import { FinanceApp } from '@/apps/Finance';
import { TimeMachineApp } from '@/apps/TimeMachine';

export interface AppDef {
  id: string;
  icon: string;
  Component: ComponentType<{ arg?: unknown }>;
  desktop: boolean; // show an icon on the desktop
}

export const APPS: AppDef[] = [
  { id: 'mail', icon: '✉', Component: MailApp, desktop: true },
  { id: 'project', icon: '◰', Component: ProjectApp, desktop: true },
  { id: 'browser', icon: '🌐', Component: BrowserApp, desktop: true },
  { id: 'files', icon: '🗀', Component: FilesApp, desktop: true },
  { id: 'terminal', icon: '▶', Component: TerminalApp, desktop: true },
  { id: 'help', icon: '?', Component: HelpApp, desktop: true },
  { id: 'encyclopedia', icon: '📖', Component: EncyclopediaApp, desktop: true },
  { id: 'knowledge', icon: '🕸', Component: KnowledgeApp, desktop: true },
  { id: 'architecture', icon: '⬡', Component: ArchitectureApp, desktop: true },
  { id: 'servers', icon: '🖧', Component: ServersApp, desktop: true },
  { id: 'database', icon: '🛢', Component: DatabaseApp, desktop: true },
  { id: 'inspector', icon: '🔎', Component: InspectorApp, desktop: false },
  { id: 'api', icon: '⇄', Component: ApiApp, desktop: true },
  { id: 'network', icon: '🌍', Component: NetworkApp, desktop: true },
  { id: 'dns', icon: '🧭', Component: DnsApp, desktop: true },
  { id: 'monitoring', icon: '📈', Component: MonitoringApp, desktop: true },
  { id: 'logs', icon: '☰', Component: LogsApp, desktop: true },
  { id: 'traces', icon: '⏱', Component: TracesApp, desktop: true },
  { id: 'security', icon: '🛡', Component: SecurityApp, desktop: true },
  { id: 'attacklab', icon: '☠', Component: AttackLabApp, desktop: true },
  { id: 'git', icon: '⑂', Component: GitApp, desktop: true },
  { id: 'cicd', icon: '⚙', Component: CicdApp, desktop: true },
  { id: 'queue', icon: '⟲', Component: QueueApp, desktop: true },
  { id: 'cache', icon: '⚡', Component: CacheApp, desktop: true },
  { id: 'incidents', icon: '🚨', Component: IncidentsApp, desktop: true },
  { id: 'runbooks', icon: '📓', Component: RunbooksApp, desktop: true },
  { id: 'finance', icon: '$', Component: FinanceApp, desktop: true },
  { id: 'timemachine', icon: '⏳', Component: TimeMachineApp, desktop: true },
];

export const APP_MAP: Record<string, AppDef> = Object.fromEntries(APPS.map((a) => [a.id, a]));
