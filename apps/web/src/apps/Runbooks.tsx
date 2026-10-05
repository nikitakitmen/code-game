'use client';
import { useGame } from '@/game/store';
import { Empty, Panel, useT } from '@/ui/kit';

export function RunbooksApp() {
  const st = useGame();
  const { t } = useT();
  const runbooks = st.state.world.observability.runbooks;
  const slo = st.state.world.observability.slo;
  return (
    <div className="col">
      {slo && (
        <Panel title="SLO / error budget">
          <div className="grid2 tiny">
            <span>Availability SLO</span><span className="mono">{(slo.availability * 100).toFixed(2)}%</span>
            <span>Latency SLO</span><span className="mono">{slo.latencyMs} ms</span>
            <span>Error budget used</span><span className={`mono ${(st.sim.summary.errorBudgetUsed ?? 0) > 1 ? 'tag error' : ''}`}>{st.sim.summary.errorBudgetUsed !== null ? `${Math.round((st.sim.summary.errorBudgetUsed ?? 0) * 100)}%` : '—'}</span>
          </div>
        </Panel>
      )}
      {runbooks.length === 0 && <Empty>No runbooks yet.</Empty>}
      {runbooks.map((r) => (
        <Panel key={r.id} title={r.title}>
          <div className="tiny muted">trigger: {r.trigger}</div>
          <ol className="tiny" style={{ margin: '4px 0', paddingLeft: 18 }}>
            {r.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </Panel>
      ))}
    </div>
  );
}
