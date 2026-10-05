'use client';
import { useWM } from '@/os/windows';
import { useGame } from '@/game/store';
import { Empty, useT, ms } from '@/ui/kit';

/** Trace Viewer — reuses the Inspector's trace rendering but lists the slowest requests. */
export function TracesApp() {
  const st = useGame();
  const wm = useWM();
  const { t, tr } = useT();
  const traces = [...st.sim.traces.filter((x) => x.sample !== 'asset')].sort((a, b) => b.totalMs - a.totalMs);
  if (!st.state.unlocks.apps.includes('traces')) return <Empty>{t('common.locked')}</Empty>;
  return (
    <div className="col">
      <div className="tiny muted">Slowest requests this window. Click to open in the Request Inspector.</div>
      {traces.length === 0 && <Empty>{t('mission.needSim')}</Empty>}
      {traces.map((x) => {
        const ep = st.state.world.endpoints.find((e) => e.id === x.endpointId);
        const dbMs = x.stages.filter((s) => s.layer === 'data').reduce((a, s) => a + s.durationMs, 0);
        const appMs = x.stages.filter((s) => s.layer === 'application').reduce((a, s) => a + s.durationMs, 0);
        const netMs = x.stages.filter((s) => s.layer === 'network').reduce((a, s) => a + s.durationMs, 0);
        const parts: [string, number, string][] = [['net', netMs, 'var(--muted)'], ['app', appMs, 'var(--accent)'], ['db', dbMs, 'var(--warn)']];
        return (
          <div key={x.id} className="panel inset" style={{ margin: 0, cursor: 'pointer' }} onClick={() => wm.open('inspector', { endpointId: x.endpointId })}>
            <div className="spread tiny"><span className="mono">{x.method} {x.path}</span><span className="mono">{ms(x.totalMs)}</span></div>
            <div style={{ display: 'flex', height: 8, border: '1px solid var(--line)' }}>
              {parts.map(([k, v, c]) => <div key={k} title={`${k} ${ms(v)}`} style={{ width: `${(v / Math.max(1, x.totalMs)) * 100}%`, background: c }} />)}
            </div>
            {ep && <div className="tiny muted">{tr(ep.product)}</div>}
          </div>
        );
      })}
    </div>
  );
}
