'use client';
/**
 * App ("code") settings, shown in the PROD OS app each one belongs to. A control dispatches the
 * generic `app.set` action; code changes wait in the release train once deploys are required.
 */
import { useGame } from '@/game/store';
import { Panel, useT } from '@/ui/kit';
import type { ConfigValue, SettingDef } from '@prod/engine';

/**
 * Where every setting is changed. A few appear in two apps: the auth/password settings are part of
 * the codebase (Project) from Act II and also live in Security Center once it exists (Act IX).
 */
export const SETTING_HOMES: Record<string, string[]> = {
  // data
  dataSource: ['database'],
  readRouting: ['database'],
  inventoryUpdate: ['database'],
  lockOrdering: ['database'],
  deadlockRetry: ['database'],
  outbox: ['database'],
  uploadsTarget: ['files'],
  timezone: ['logs'],
  // accounts & login (the codebase), later also Security Center
  authMode: ['project', 'security'],
  sessionStore: ['project', 'security'],
  authErrors: ['project', 'security'],
  adminRoleCheck: ['project', 'security'],
  passwordStorage: ['project', 'security'],
  cookieHttpOnly: ['project', 'security'],
  // API
  inputValidation: ['api', 'project'],
  cors: ['api'],
  apiStatusCodes: ['api'],
  deleteMethod: ['api'],
  apiVersioning: ['api'],
  apiContract: ['api'],
  // security hardening
  loginRateLimit: ['security'],
  lockout: ['security'],
  queryMode: ['security'],
  outputEscaping: ['security'],
  csp: ['security'],
  csrfProtection: ['security'],
  ownershipChecks: ['security'],
  uploadValidation: ['security'],
  ssrfProtection: ['security'],
  leastPrivilegeKeys: ['security'],
  // cache
  cacheInvalidation: ['cache'],
  cacheFailOpen: ['cache'],
  cacheWarming: ['cache'],
  // async work
  asyncEmail: ['queue'],
  asyncInvoice: ['queue'],
  queueSeparation: ['queue'],
  retryPolicy: ['queue'],
  maxRetries: ['queue'],
  deadLetterQueue: ['queue'],
  jobIdempotency: ['queue'],
  paymentIdempotency: ['queue'],
  webhookIdempotency: ['queue'],
  webhookAsync: ['queue'],
  // calls between services and to providers
  providerTimeoutMs: ['architecture'],
  retries: ['architecture'],
  retryJitter: ['architecture'],
  circuitBreaker: ['architecture'],
  fallbacks: ['architecture'],
  autoRestart: ['servers'],
  // observability
  requestIds: ['logs'],
  tracing: ['logs'],
};

export function settingsFor(app: string, settings: SettingDef[], unlocked: string[]): SettingDef[] {
  return settings.filter((s) => SETTING_HOMES[s.key]?.includes(app) && unlocked.includes(s.key));
}

/** Settings of one app; renders nothing until at least one of them is unlocked. */
export function SettingsPanel({ app, title }: { app: string; title?: string }) {
  const st = useGame();
  const { t } = useT();
  const w = st.state.world;
  const list = settingsFor(app, st.content.settings, st.state.unlocks.settings);
  if (!list.length) return null;
  return (
    <Panel title={title ?? t('set.title')}>
      {list.map((s) => (
        <SettingRow key={s.key} setting={s} value={w.app[s.key]} pending={w.deploy.pending[s.key]} onChange={(v) => st.dispatch({ type: 'app.set', key: s.key, value: v })} />
      ))}
    </Panel>
  );
}

export function SettingRow({ setting, value, pending, onChange }: { setting: SettingDef; value: ConfigValue; pending?: ConfigValue; onChange: (v: ConfigValue) => void }) {
  const { tr, t } = useT();
  const shown = pending !== undefined ? pending : value;
  return (
    <label className="tiny" title={tr(setting.help)} data-setting={setting.key}>
      <div className="spread">
        <span>
          {tr(setting.label)}
          {pending !== undefined && <span className="tag warn" style={{ marginLeft: 4 }}>{t('set.pending')}</span>}
        </span>
        {setting.type === 'bool' ? (
          <input type="checkbox" checked={shown === true} onChange={(e) => onChange(e.target.checked)} />
        ) : setting.type === 'enum' ? (
          <select value={String(shown)} onChange={(e) => { const opt = setting.options!.find((o) => String(o.value) === e.target.value); onChange(opt ? (opt.value as ConfigValue) : e.target.value); }}>
            {setting.options!.map((o) => <option key={String(o.value)} value={String(o.value)}>{tr(o.label)}</option>)}
          </select>
        ) : (
          <input type="number" value={Number(shown)} min={setting.min} max={setting.max} step={setting.step} style={{ width: 80 }} onChange={(e) => onChange(Number(e.target.value))} />
        )}
      </div>
    </label>
  );
}
