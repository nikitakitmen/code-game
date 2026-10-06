'use client';
import { useState } from 'react';
import { useGame } from '@/game/store';
import { Btn, Panel, useT } from '@/ui/kit';
import { PinBtn } from '@/ui/Pin';
import { pin } from '@prod/engine';

export function CicdApp() {
  const st = useGame();
  const { t } = useT();
  const w = st.state.world;
  const ci = w.ci;
  const d = w.deploy;
  const [canary, setCanary] = useState(10);
  const pending = Object.keys(d.pending).length + d.pendingFixes.length + d.pendingBugs.length;

  return (
    <div className="col">
      <Panel title="CI">
        <label className="tiny row"><input type="checkbox" checked={ci.enabled} onChange={(e) => st.dispatch({ type: 'ci.enable', enabled: e.target.checked })} /> enable CI</label>
        <div className="grid2 tiny" style={{ marginTop: 4 }}>
          {(['lint', 'unit', 'integration', 'contract', 'secretScan', 'depScan', 'build'] as const).map((s) => (
            <label key={s} className="row"><input type="checkbox" disabled={!ci.enabled} checked={ci.stages[s]} onChange={(e) => st.dispatch({ type: 'ci.stage', stage: s, enabled: e.target.checked })} /> {s}</label>
          ))}
        </div>
        {ci.tests.length > 0 && (
          <div className="tiny muted" style={{ marginTop: 4 }}>
            Regression tests: {ci.tests.map((x) => `${x.id} (${x.covers})`).join(', ')}
          </div>
        )}
        <AddTest />
        {ci.runs.length > 0 && (
          <div className="tiny" style={{ marginTop: 4 }}>
            Last run: <span className={`tag ${ci.runs[ci.runs.length - 1].status === 'passed' ? 'ok' : 'error'}`}>{ci.runs[ci.runs.length - 1].status}</span> {ci.runs[ci.runs.length - 1].reason ? `(${ci.runs[ci.runs.length - 1].reason})` : ''}
          </div>
        )}
      </Panel>

      <Panel title="Deploy">
        <div className="tiny">Live version: v{d.version} · pending changes: {pending}</div>
        {d.canary && <div className="tag warn tiny">Canary v{d.canary.version} at {d.canary.percent}%</div>}
        <div className="row wrap" style={{ marginTop: 6 }}>
          <Btn sm disabled={!pending || !!d.canary} onClick={() => st.dispatch({ type: 'deploy.run', strategy: 'all' })}>Deploy all</Btn>
          <label className="tiny row">canary <input type="number" style={{ width: 54 }} value={canary} onChange={(e) => setCanary(Number(e.target.value))} />%</label>
          <Btn sm disabled={!pending || !!d.canary} onClick={() => st.dispatch({ type: 'deploy.run', strategy: 'canary', percent: canary })}>Canary</Btn>
          {d.canary && <Btn sm primary onClick={() => st.dispatch({ type: 'deploy.promote' })}>Promote</Btn>}
          <Btn sm danger onClick={() => st.dispatch({ type: 'deploy.rollback' })}>Rollback</Btn>
        </div>
      </Panel>

      {d.flags.length > 0 && (
        <Panel title="Feature flags">
          {d.flags.map((f) => (
            <div key={f.id} className="spread tiny" style={{ borderBottom: '1px solid var(--line)', padding: '3px 0' }}>
              <span>{f.label.en}</span>
              <span className="row">
                <input type="range" min={0} max={100} step={5} value={f.rollout} onChange={(e) => st.dispatch({ type: 'flag.set', id: f.id, enabled: Number(e.target.value) > 0, rollout: Number(e.target.value) })} />
                <span className="mono">{f.enabled ? f.rollout : 0}%</span>
              </span>
            </div>
          ))}
        </Panel>
      )}

      <Panel title="Releases">
        {d.releases.slice(-6).reverse().map((r) => (
          <div key={r.version} style={{ borderBottom: '1px solid var(--line)', padding: '2px 0' }}>
            <div className="spread tiny"><span>v{r.version} {r.bugs.length ? '🐞' : ''}</span><span className={`tag ${r.status === 'live' ? 'ok' : r.status === 'rolled-back' ? 'error' : 'muted'}`}>{r.status}</span></div>
            {r.bugs.map((id) => {
              const bug = w.bugs.find((b) => b.id === id);
              if (!bug) return null;
              return (
                <div key={id} className="spread tiny mono" style={{ paddingLeft: 8 }}>
                  <span>{bug.logCode}: {bug.logMessage}</span>
                  <PinBtn token={pin.releaseLog(bug.logCode)} />
                </div>
              );
            })}
          </div>
        ))}
      </Panel>
    </div>
  );
}

const TEST_LEVELS = ['unit', 'integration', 'contract'] as const;

/** A regression test that exercises one endpoint at a level; CI runs it on every PR and deploy. */
function AddTest() {
  const st = useGame();
  const { t } = useT();
  const ci = st.state.world.ci;
  const eps = st.state.world.endpoints.filter((e) => !e.disabled && e.target === 'backend');
  const [ep, setEp] = useState(eps[0]?.id ?? '');
  const [level, setLevel] = useState<(typeof TEST_LEVELS)[number]>('unit');
  const id = `t-${ep}`;
  const exists = ci.tests.some((x) => x.id === id);
  const add = () => {
    const def = eps.find((e) => e.id === ep);
    st.dispatch({ type: 'ci.addTest', id, covers: level, label: { en: `${def?.method ?? ''} ${def?.path ?? ep} (${level})`, ru: `${def?.method ?? ''} ${def?.path ?? ep} (${level})` } });
  };
  if (!eps.length) return null;
  return (
    <div className="row wrap tiny" style={{ marginTop: 6 }}>
      <span>{t('ci.addTest')}:</span>
      <select aria-label={t('ci.endpoint')} value={ep} onChange={(e) => setEp(e.target.value)}>
        {eps.map((e) => <option key={e.id} value={e.id}>{e.method} {e.path}</option>)}
      </select>
      <select aria-label={t('ci.level')} value={level} onChange={(e) => setLevel(e.target.value as (typeof TEST_LEVELS)[number])}>
        {TEST_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
      </select>
      <Btn sm disabled={!ep || exists} onClick={add}>+</Btn>
    </div>
  );
}
