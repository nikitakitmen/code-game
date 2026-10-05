'use client';
import { useState } from 'react';
import { useGame } from '@/game/store';
import { Btn, Empty, Panel, useT, ms, pct, money } from '@/ui/kit';
import { compareStates, clockParts } from '@prod/engine';

export function TimeMachineApp() {
  const st = useGame();
  const { t } = useT();
  const [label, setLabel] = useState('');
  const [cmp, setCmp] = useState<{ a: string; b: string } | null>(null);
  const cps = [...st.checkpoints].reverse();

  return (
    <div className="col">
      <div className="tiny muted">{t('tm.safe')}</div>
      <div className="row">
        <input placeholder="label" value={label} onChange={(e) => setLabel(e.target.value)} style={{ flex: 1 }} />
        <Btn onClick={() => { st.checkpoint(label); setLabel(''); }}>{t('tm.create')}</Btn>
      </div>
      {cps.length === 0 && <Empty>No checkpoints yet. One is made before each major mission.</Empty>}
      {cps.map((cp) => {
        const d = clockParts(cp.clock);
        return (
          <Panel key={cp.id}>
            <div className="spread tiny">
              <span>{cp.label} <span className="muted">({cp.type} · D{d.day} {d.hhmm})</span></span>
              <span className="row">
                <Btn sm onClick={() => st.restore(cp.id)}>{t('tm.restore')}</Btn>
                <Btn sm primary={cmp?.a === cp.id} onClick={() => setCmp(cmp?.a ? { a: cmp.a, b: cp.id } : { a: cp.id, b: cp.id })}>{t('tm.compare')}</Btn>
              </span>
            </div>
          </Panel>
        );
      })}
      {cmp && cmp.a !== cmp.b && <Compare a={cmp.a} b={cmp.b} />}
    </div>
  );
}

function Compare({ a, b }: { a: string; b: string }) {
  const st = useGame();
  const { t } = useT();
  const ca = st.checkpoints.find((c) => c.id === a);
  const cb = st.checkpoints.find((c) => c.id === b);
  if (!ca || !cb) return null;
  const { rows } = compareStates(ca.state, cb.state, st.content);
  const fmt = (metric: string, v: number | null) => {
    if (v === null) return '—';
    if (['p50', 'p95', 'pageLoad'].includes(metric)) return ms(v);
    if (['errorRate', 'availability'].includes(metric)) return pct(v, 2);
    if (metric === 'cost') return money(v);
    return String(Math.round(v));
  };
  return (
    <Panel title={`${t('tm.compare')}: ${ca.label} ↔ ${cb.label}`}>
      <table>
        <thead><tr><th></th><th>{ca.label.slice(0, 12)}</th><th>{cb.label.slice(0, 12)}</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.metric}>
              <td>{r.metric}</td>
              <td className={`mono ${r.better === 'a' ? 'tag ok' : ''}`}>{fmt(r.metric, r.a)}</td>
              <td className={`mono ${r.better === 'b' ? 'tag ok' : ''}`}>{fmt(r.metric, r.b)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
