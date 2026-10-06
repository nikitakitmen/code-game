'use client';
import { useState } from 'react';
import { useGame } from '@/game/store';
import { Btn, Empty, Panel, useT } from '@/ui/kit';
import { utcMinutes, clockParts, type IncidentRecord, type SloConfig } from '@prod/engine';

export function IncidentsApp() {
  const st = useGame();
  const { t } = useT();
  const incidents = st.state.world.observability.incidents;
  const [sel, setSel] = useState<string | null>(incidents[incidents.length - 1]?.id ?? null);
  const current = incidents.find((i) => i.id === sel);
  if (!incidents.length) return <div className="col"><Empty>No incidents declared.</Empty><SloEditor /></div>;
  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ width: 160, borderRight: '2px solid var(--line)', overflow: 'auto', flex: 'none' }}>
        {incidents.map((i) => (
          <div key={i.id} onClick={() => setSel(i.id)} className="tiny" style={{ padding: '4px 6px', cursor: 'pointer', background: sel === i.id ? 'var(--accent)' : 'transparent', color: sel === i.id ? 'var(--accent-ink)' : 'inherit' }}>
            {i.title.en}<div style={{ opacity: 0.7 }}>{i.severity ?? 'undeclared'} · {i.status}</div>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        {current ? <IncidentView key={current.id} incident={current} /> : <Empty>—</Empty>}
        <SloEditor />
      </div>
    </div>
  );
}

function IncidentView({ incident }: { incident: IncidentRecord }) {
  const st = useGame();
  const { t, tr } = useT();
  const [order, setOrder] = useState<string[]>(incident.order.length ? incident.order : incident.events.map((e) => e.id));

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...order];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setOrder(next);
    st.dispatch({ type: 'incident.order', id: incident.id, order: next });
  };

  const correctOrder = incident.events.slice().sort((a, b) => utcMinutes(a.raw, a.tz) - utcMinutes(b.raw, b.tz)).map((e) => e.id);
  const ordered = order.length === correctOrder.length && order.every((id, i) => id === correctOrder[i]);

  return (
    <div className="col">
      <div className="spread"><h3 style={{ margin: 0 }}>{tr(incident.title)}</h3><span className="tag">{incident.status}</span></div>
      <div className="row wrap">
        {(['SEV1', 'SEV2', 'SEV3'] as const).map((s) => (
          <Btn key={s} sm primary={incident.severity === s} onClick={() => st.dispatch({ type: 'incident.declare', id: incident.id, severity: s })}>{s}</Btn>
        ))}
        <label className="tiny row"><input type="checkbox" checked={incident.utcView} onChange={(e) => st.dispatch({ type: 'incident.utc', id: incident.id, utc: e.target.checked })} /> show UTC</label>
      </div>
      <Panel title={`Timeline ${ordered ? '✓ ordered' : '(drag into order)'}`}>
        {order.map((id, i) => {
          const e = incident.events.find((x) => x.id === id)!;
          const shown = incident.utcView ? clockParts(utcMinutes(e.raw, e.tz) < 0 ? utcMinutes(e.raw, e.tz) + 1440 : utcMinutes(e.raw, e.tz)).hhmm + 'Z' : `${e.raw}+${e.tz}`;
          return (
            <div key={id} className="spread tiny" style={{ borderBottom: '1px solid var(--line)', padding: '2px 0' }}>
              <span><span className="mono">{shown}</span> [{e.source}] {tr(e.text)}</span>
              <span className="row">
                <Btn sm onClick={() => move(i, -1)}>↑</Btn>
                <Btn sm onClick={() => move(i, 1)}>↓</Btn>
              </span>
            </div>
          );
        })}
      </Panel>
      <Postmortem incidentId={incident.id} />
    </div>
  );
}

function Postmortem({ incidentId }: { incidentId: string }) {
  const st = useGame();
  const { t } = useT();
  const pm = st.state.world.observability.postmortems.find((p) => p.incidentId === incidentId);
  const [cause, setCause] = useState(String(pm?.answers.rootCause ?? ''));
  const [action, setAction] = useState(String(pm?.answers.action ?? ''));
  return (
    <Panel title="Postmortem (blameless)">
      {pm?.submitted ? <div className="tag ok tiny">submitted</div> : (
        <div className="col">
          <label className="tiny">Root cause<input value={cause} onChange={(e) => setCause(e.target.value)} onBlur={() => st.dispatch({ type: 'postmortem.answer', incidentId, key: 'rootCause', value: cause })} /></label>
          <label className="tiny">Action item<input value={action} onChange={(e) => setAction(e.target.value)} onBlur={() => st.dispatch({ type: 'postmortem.answer', incidentId, key: 'action', value: action })} /></label>
          <Btn sm disabled={!cause || !action} onClick={() => { st.dispatch({ type: 'postmortem.answer', incidentId, key: 'rootCause', value: cause }); st.dispatch({ type: 'postmortem.answer', incidentId, key: 'action', value: action }); st.dispatch({ type: 'postmortem.submit', incidentId }); }}>Submit</Btn>
        </div>
      )}
    </Panel>
  );
}

/** Service level objective: the reliability target and the error budget it leaves. */
function SloEditor() {
  const st = useGame();
  const { t } = useT();
  const current = st.state.world.observability.slo;
  const [draft, setDraft] = useState<SloConfig>(current ?? { availability: 0.99, latencyMs: 800, slaAvailability: 0.98, freezeOnBudgetExhausted: true });
  const edit = (patch: Partial<SloConfig>) => setDraft({ ...draft, ...patch });
  const used = st.sim.summary.errorBudgetUsed;
  return (
    <Panel title={t('slo.title')}>
      <div className="col tiny">
        <label className="row">
          {t('slo.availability')}
          <select aria-label={t('slo.availability')} value={String(draft.availability)} onChange={(e) => edit({ availability: Number(e.target.value) })}>
            {[0.99, 0.995, 0.999, 0.9995, 0.9999].map((v) => <option key={v} value={String(v)}>{(v * 100).toFixed(2)}%</option>)}
          </select>
        </label>
        <label className="row">{t('slo.latency')} <input aria-label={t('slo.latency')} type="number" min={50} style={{ width: 70 }} value={draft.latencyMs} onChange={(e) => edit({ latencyMs: Number(e.target.value) })} /></label>
        <label className="row">
          {t('slo.sla')}
          <select aria-label={t('slo.sla')} value={String(draft.slaAvailability ?? '')} onChange={(e) => edit({ slaAvailability: e.target.value ? Number(e.target.value) : null })}>
            <option value="">—</option>
            {[0.98, 0.99, 0.995, 0.999].map((v) => <option key={v} value={String(v)}>{(v * 100).toFixed(1)}%</option>)}
          </select>
        </label>
        <label className="row"><input type="checkbox" checked={draft.freezeOnBudgetExhausted} onChange={(e) => edit({ freezeOnBudgetExhausted: e.target.checked })} /> {t('slo.freeze')}</label>
        <div className="row">
          <Btn sm primary onClick={() => st.dispatch({ type: 'slo.set', slo: draft })}>{t('slo.save')}</Btn>
          {current && used !== null && <span className={`tag ${used > 1 ? 'error' : 'ok'}`}>{t('slo.used')}: {Math.round(used * 100)}%</span>}
        </div>
      </div>
    </Panel>
  );
}
