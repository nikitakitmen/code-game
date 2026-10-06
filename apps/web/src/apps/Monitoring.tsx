'use client';
import { useState } from 'react';
import { useGame } from '@/game/store';
import { Btn, Panel, useT, ms, pct, num } from '@/ui/kit';
import { PinBtn } from '@/ui/Pin';
import { alertMetricAt, pin, type AlertMetric, type AlertRule } from '@prod/engine';

const ALERT_METRICS: AlertMetric[] = ['errorRate', 'p95', 'availability', 'cpu.backend', 'cpu.database', 'ram.backend', 'queue.backlog', 'db.connections', 'disk', 'slo.burn', 'uptime'];

export function MonitoringApp() {
  const st = useGame();
  const { t } = useT();
  const sim = st.sim;
  const ticks = sim.ticks;

  const series: { key: string; label: string; fmt: (v: number) => string; get: (t: number) => number; danger?: number }[] = [
    { key: 'rps', label: t('metric.rps'), fmt: (v) => num(v), get: (i) => ticks[i].rps },
    { key: 'p95', label: t('metric.p95'), fmt: (v) => ms(v), get: (i) => ticks[i].p95, danger: 1000 },
    { key: 'errorRate', label: t('metric.errorRate'), fmt: (v) => pct(v / 100, 1), get: (i) => ticks[i].errorRate * 100, danger: 5 },
    { key: 'cpu.backend', label: 'CPU backend %', fmt: (v) => `${Math.round(v)}%`, get: (i) => alertMetricAt(st.state, sim, 'cpu.backend', i), danger: 85 },
    { key: 'cpu.database', label: 'CPU database %', fmt: (v) => `${Math.round(v)}%`, get: (i) => alertMetricAt(st.state, sim, 'cpu.database', i), danger: 85 },
    { key: 'queue.backlog', label: t('metric.queue'), fmt: (v) => num(v), get: (i) => ticks[i].queueBacklog },
    { key: 'db.connections', label: 'DB conn %', fmt: (v) => `${Math.round(v)}%`, get: (i) => alertMetricAt(st.state, sim, 'db.connections', i), danger: 90 },
    { key: 'cacheHit', label: t('metric.cacheHit'), fmt: (v) => pct(v / 100, 0), get: (i) => (ticks[i].cacheHitRate ?? 0) * 100 },
  ];

  return (
    <div className="col">
      <div className="grid2">
        {series.map((s) => <Chart key={s.key} s={s} n={ticks.length} />)}
      </div>
      <Panel>
        <div className="spread tiny">
          <span title={t('mon.amplificationHelp')}>{t('mon.amplification')}: <span className="mono">×{sim.summary.providerAmplification}</span></span>
          <PinBtn token={pin.metric('monitoring', 'amplification')} />
        </div>
      </Panel>
      <Alerts />
      <AlertRules />
    </div>
  );
}

function Chart({ s, n }: { s: { key: string; label: string; fmt: (v: number) => string; get: (t: number) => number; danger?: number }; n: number }) {
  const values = Array.from({ length: n }, (_, i) => s.get(i));
  const max = Math.max(s.danger ?? 0, ...values, 1);
  const last = values[values.length - 1] ?? 0;
  const W = 240, H = 54;
  const pts = values.map((v, i) => `${(i / (n - 1)) * W},${H - (v / max) * H}`).join(' ');
  const hot = s.danger !== undefined && last >= s.danger;
  return (
    <div className="panel inset" style={{ margin: 0 }}>
      <div className="spread tiny">
        <span>{s.label}</span>
        <span className="row"><span className={`mono ${hot ? 'tag error' : ''}`}>{s.fmt(last)}</span><PinBtn token={pin.metric('monitoring', s.key)} /></span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, background: 'var(--paper)' }}>
        {s.danger !== undefined && <line x1={0} x2={W} y1={H - (s.danger / max) * H} y2={H - (s.danger / max) * H} stroke="var(--error)" strokeDasharray="3 3" strokeWidth={1} />}
        <polyline points={pts} fill="none" stroke={hot ? 'var(--error)' : 'var(--accent)'} strokeWidth={1.5} />
      </svg>
    </div>
  );
}

function Alerts() {
  const st = useGame();
  const { t } = useT();
  const alerts = st.sim.alerts;
  return (
    <Panel title={`${t('mon.firing')} (${alerts.length})`}>
      {alerts.length === 0 && <div className="tiny muted">{t('mon.noAlerts')}</div>}
      {alerts.map((a) => (
        <div key={a.id} className="spread tiny" style={{ borderBottom: '1px solid var(--line)', padding: '2px 0' }}>
          <span>{a.severity === 'page' ? '📟' : '🎫'} {a.metric} {a.actionable ? '' : `(${t('mon.noImpact')})`}</span>
          <span className="row">
            <span className={`tag ${a.actionable ? 'error' : 'muted'}`}>peak {Math.round(a.peak)}</span>
            <PinBtn token={pin.alert(a.metric)} />
          </span>
        </div>
      ))}
    </Panel>
  );
}

/** Alert rules: what pages someone, when, and how long a condition must hold. */
function AlertRules() {
  const st = useGame();
  const { t } = useT();
  const rules = st.state.world.observability.alertRules;
  const add = () => {
    let i = rules.length + 1;
    while (rules.some((r) => r.id === `alert-${i}`)) i++;
    st.dispatch({ type: 'alerts.upsert', rule: { id: `alert-${i}`, metric: 'errorRate', op: '>', threshold: 5, forMinutes: 5, severity: 'page', enabled: true } });
  };
  return (
    <Panel title={t('mon.rules')}>
      {rules.map((r) => <AlertRuleRow key={`${r.id}:${JSON.stringify(r)}`} rule={r} />)}
      <Btn sm onClick={add}>+ {t('mon.addAlert')}</Btn>
    </Panel>
  );
}

function AlertRuleRow({ rule }: { rule: AlertRule }) {
  const st = useGame();
  const { t } = useT();
  const [draft, setDraft] = useState<AlertRule>(rule);
  const dirty = JSON.stringify(draft) !== JSON.stringify(rule);
  const edit = (patch: Partial<AlertRule>) => setDraft({ ...draft, ...patch });
  return (
    <div className="row wrap tiny" data-alert={rule.id} style={{ borderBottom: '1px solid var(--line)', padding: '3px 0' }}>
      <input type="checkbox" title={t('mon.enabled')} checked={draft.enabled} onChange={(e) => edit({ enabled: e.target.checked })} />
      <select aria-label={t('mon.metric')} value={draft.metric} onChange={(e) => edit({ metric: e.target.value as AlertMetric })}>
        {ALERT_METRICS.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <select aria-label="op" value={draft.op} onChange={(e) => edit({ op: e.target.value as AlertRule['op'] })}>
        <option value=">">&gt;</option>
        <option value="<">&lt;</option>
      </select>
      <input aria-label={t('mon.threshold')} type="number" style={{ width: 64 }} value={draft.threshold} onChange={(e) => edit({ threshold: Number(e.target.value) })} />
      <label className="row">{t('mon.for')} <input aria-label={t('mon.for')} type="number" min={1} style={{ width: 48 }} value={draft.forMinutes} onChange={(e) => edit({ forMinutes: Number(e.target.value) })} /></label>
      <select aria-label={t('mon.severity')} value={draft.severity} onChange={(e) => edit({ severity: e.target.value as AlertRule['severity'] })}>
        <option value="page">page</option>
        <option value="ticket">ticket</option>
      </select>
      <Btn sm primary={dirty} disabled={!dirty} onClick={() => st.dispatch({ type: 'alerts.upsert', rule: draft })}>{t('common.save')}</Btn>
      <Btn sm danger onClick={() => st.dispatch({ type: 'alerts.delete', id: rule.id })}>✕</Btn>
    </div>
  );
}
