'use client';
import { useState } from 'react';
import { useGame } from '@/game/store';
import { Btn, Empty, Panel, useT } from '@/ui/kit';

/** Standard first-response steps a runbook is assembled from. */
const STEPS = [
  'Check the latest release in CI/CD',
  'Roll back if a recent deploy correlates',
  'Check DB connections',
  'Check the error logs by request ID',
  'Check the queue backlog',
  'Check the TLS certificate expiry',
  'Fail over to another region',
  'Declare an incident if not resolved in 10 min',
];

/** What a runbook is for: an endpoint failing or slow, or an infrastructure symptom. */
function triggers(endpoints: string[]): string[] {
  return [...endpoints.flatMap((id) => [`${id}-5xx`, `${id}-latency`]), 'db-connections', 'queue-backlog', 'disk-full', 'cert-expiry', 'region-down'];
}

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
          <div className="spread tiny">
            <span className="muted">trigger: {r.trigger}</span>
            <Btn sm danger onClick={() => st.dispatch({ type: 'runbook.delete', id: r.id })}>✕</Btn>
          </div>
          <ol className="tiny" style={{ margin: '4px 0', paddingLeft: 18 }}>
            {r.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </Panel>
      ))}
      <NewRunbook />
      <div className="tiny muted">{t('rb.hint')}</div>
    </div>
  );
}

function NewRunbook() {
  const st = useGame();
  const { t } = useT();
  const eps = st.state.world.endpoints.filter((e) => !e.disabled && e.target === 'backend').map((e) => e.id);
  const options = triggers(eps);
  const [title, setTitle] = useState('');
  const [trigger, setTrigger] = useState(options[0] ?? '');
  const [steps, setSteps] = useState<string[]>([]);
  const toggle = (s: string) => setSteps((xs) => (xs.includes(s) ? xs.filter((x) => x !== s) : [...xs, s]));
  const save = () => {
    const id = `rb-${trigger}`;
    st.dispatch({ type: 'runbook.save', runbook: { id, title: title.trim() || trigger, trigger, steps: STEPS.filter((s) => steps.includes(s)) } });
    setTitle('');
    setSteps([]);
  };
  return (
    <Panel title={t('rb.new')}>
      <div className="col tiny">
        <label>{t('rb.title')} <input aria-label={t('rb.title')} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label>
          {t('rb.trigger')}{' '}
          <select aria-label={t('rb.trigger')} value={trigger} onChange={(e) => setTrigger(e.target.value)}>
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <div className="muted">{t('rb.steps')}</div>
        {STEPS.map((s) => (
          <label key={s} className="row"><input type="checkbox" checked={steps.includes(s)} onChange={() => toggle(s)} /> {s}</label>
        ))}
        <Btn sm primary disabled={!trigger || steps.length === 0} onClick={save}>{t('rb.save')}</Btn>
      </div>
    </Panel>
  );
}
