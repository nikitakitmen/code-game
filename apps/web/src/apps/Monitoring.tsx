'use client';
import { useGame } from '@/game/store';
import { Panel, useT, ms, pct, num } from '@/ui/kit';
import { alertMetricAt } from '@prod/engine';

export function MonitoringApp() {
  const st = useGame();
  const { t } = useT();
  const sim = st.sim;
  const ticks = sim.ticks;

  const series: { key: string; label: string; fmt: (v: number) => string; get: (t: number) => number; danger?: number }[] = [
    { key: 'rps', label: t('metric.rps'), fmt: (v) => num(v), get: (i) => ticks[i].rps },
    { key: 'p95', label: t('metric.p95'), fmt: (v) => ms(v), get: (i) => ticks[i].p95, danger: 1000 },
    { key: 'err', label: t('metric.errorRate'), fmt: (v) => pct(v / 100, 1), get: (i) => ticks[i].errorRate * 100, danger: 5 },
    { key: 'cpu.backend', label: 'CPU backend %', fmt: (v) => `${Math.round(v)}%`, get: (i) => alertMetricAt(st.state, sim, 'cpu.backend', i), danger: 85 },
    { key: 'cpu.database', label: 'CPU database %', fmt: (v) => `${Math.round(v)}%`, get: (i) => alertMetricAt(st.state, sim, 'cpu.database', i), danger: 85 },
    { key: 'queue', label: t('metric.queue'), fmt: (v) => num(v), get: (i) => ticks[i].queueBacklog },
    { key: 'db.connections', label: 'DB conn %', fmt: (v) => `${Math.round(v)}%`, get: (i) => alertMetricAt(st.state, sim, 'db.connections', i), danger: 90 },
    { key: 'cache', label: t('metric.cacheHit'), fmt: (v) => pct(v / 100, 0), get: (i) => (ticks[i].cacheHitRate ?? 0) * 100 },
  ];

  return (
    <div className="col">
      <div className="grid2">
        {series.map((s) => <Chart key={s.key} s={s} n={ticks.length} />)}
      </div>
      <Alerts />
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
      <div className="spread tiny"><span>{s.label}</span><span className={`mono ${hot ? 'tag error' : ''}`}>{s.fmt(last)}</span></div>
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
    <Panel title={`Alerts (${alerts.length})`}>
      {alerts.length === 0 && <div className="tiny muted">No alerts firing.</div>}
      {alerts.map((a) => (
        <div key={a.id} className="spread tiny" style={{ borderBottom: '1px solid var(--line)', padding: '2px 0' }}>
          <span>{a.severity === 'page' ? '📟' : '🎫'} {a.metric} {a.actionable ? '' : '(no user impact)'}</span>
          <span className={`tag ${a.actionable ? 'error' : 'muted'}`}>peak {Math.round(a.peak)}</span>
        </div>
      ))}
    </Panel>
  );
}
