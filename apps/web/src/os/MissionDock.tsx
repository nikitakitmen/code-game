'use client';
import { useState } from 'react';
import { useGame } from '@/game/store';
import { useWM } from './windows';
import { Btn, useT, Dot, Meter, ms, pct, num, money } from '@/ui/kit';
import type { MissionDef } from '@prod/engine';

export function MissionDock() {
  const st = useGame();
  const { t, tr } = useT();
  const wm = useWM();
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<'mission' | 'metrics'>('mission');
  const mission = st.state.campaign.currentMissionId ? st.content.missions[st.state.campaign.currentMissionId] : undefined;
  const active = st.state.campaign.active;
  const finished = st.state.campaign.finished;

  return (
    <div className="mission-dock">
      <div className="md-title">
        <span>
          {finished ? t('mission.solved') : mission ? `${t('mission.act')} ${mission.act} · ${tr(mission.title)}` : 'PROD'}
        </span>
        <span style={{ cursor: 'pointer' }} onClick={() => setCollapsed(!collapsed)}>{collapsed ? '▲' : '▼'}</span>
      </div>
      {!collapsed && (
        <div className="md-body">
          <div className="row" style={{ marginBottom: 6 }}>
            <Btn sm primary={tab === 'mission'} onClick={() => setTab('mission')}>{t('mission.objectives')}</Btn>
            <Btn sm primary={tab === 'metrics'} onClick={() => setTab('metrics')}>{t('metric.performance').slice(0, 7)}…</Btn>
          </div>
          {tab === 'metrics' ? <Metrics /> : mission && active ? <ActiveMission mission={mission} /> : mission ? <StartMission mission={mission} /> : <Finished />}
        </div>
      )}
    </div>
  );
}

function Metrics() {
  const st = useGame();
  const { t } = useT();
  const q = st.sim.quality;
  const s = st.sim.summary;
  const items: [string, number][] = [
    ['metric.performance', q.performance],
    ['metric.reliability', q.reliability],
    ['metric.security', q.security],
    ['metric.maintainability', q.maintainability],
    ['metric.cost', q.cost],
  ];
  return (
    <div className="col">
      {items.map(([k, v]) => (
        <div key={k}>
          <div className="spread tiny"><span>{t(k)}</span><span className="mono">{v}</span></div>
          <Meter value={v} max={100} tone={v > 70 ? 'ok' : v > 40 ? 'warn' : 'error'} />
        </div>
      ))}
      <div>
        <div className="spread tiny"><span>{t('metric.debt')}</span><span className="mono">{st.state.debt}</span></div>
        <Meter value={st.state.debt} max={100} tone={st.state.debt < 30 ? 'ok' : st.state.debt < 60 ? 'warn' : 'error'} />
      </div>
      <hr />
      <div className="grid2 tiny">
        <span>{t('metric.availability')}</span><span className="mono">{pct(s.availability, 2)}</span>
        <span>{t('metric.p95')}</span><span className="mono">{ms(s.p95)}</span>
        <span>{t('metric.errorRate')}</span><span className="mono">{pct(s.errorRate, 2)}</span>
        <span>{t('metric.users')}</span><span className="mono">{num(st.state.world.traffic.users)}</span>
        <span>{t('metric.budget')}</span><span className="mono">{money(st.state.budget.cash)}</span>
        <span>{t('metric.cost')}/mo</span><span className="mono">{money(st.sim.cost.total)}</span>
      </div>
    </div>
  );
}

function StartMission({ mission }: { mission: MissionDef }) {
  const st = useGame();
  const wm = useWM();
  const { t, tr } = useT();
  return (
    <div className="col">
      <div className="small">{tr(mission.summary)}</div>
      <Btn primary onClick={() => { st.startCurrentMission(); wm.open('mail'); }}>{t('common.next')} ▶</Btn>
      <div className="tiny muted">{tr(mission.trigger.subject)}</div>
    </div>
  );
}

function Finished() {
  const { t } = useT();
  return <div className="small">🏁 {t('mission.solved')}. PROD lives on.</div>;
}

function ActiveMission({ mission }: { mission: MissionDef }) {
  const st = useGame();
  const wm = useWM();
  const { t, tr } = useT();
  const active = st.state.campaign.active!;
  const objectives = st.objectives();
  const allMet = objectives.length > 0 && objectives.every((o) => o.met);
  const needEvidence = (mission.evidence?.length ?? 0) > 0 && active.evidence.length === 0;

  return (
    <div className="col">
      {mission.symptoms && mission.symptoms.length > 0 && (
        <div className="panel inset" style={{ margin: 0 }}>
          <div className="tiny muted">{t('mission.symptoms')}</div>
          {mission.symptoms.map((s, i) => (
            <div key={i} className="tiny">• {tr(s.text)} <a style={{ cursor: 'pointer' }} onClick={() => wm.open(s.app)}>[{t(`app.${s.app}`)}]</a></div>
          ))}
        </div>
      )}

      {mission.evidence && mission.evidence.length > 0 && (
        <div>
          <div className="tiny muted">{t('mission.evidence')} ({active.evidence.length}/{mission.evidence.length})</div>
          {mission.evidence.map((e) => {
            const got = active.evidence.includes(e.id);
            return (
              <div key={e.id} className="obj">
                <span className={`box ${got ? 'done' : ''}`}>{got ? '✓' : ''}</span>
                <span className="tiny">{got ? tr(e.text) : <>{tr(e.hint)} <a style={{ cursor: 'pointer' }} onClick={() => wm.open(e.app)}>[{t(`app.${e.app}`)}]</a></>}</span>
              </div>
            );
          })}
        </div>
      )}

      {mission.hypotheses && mission.hypotheses.length > 0 && (
        <Hypotheses mission={mission} disabled={needEvidence} />
      )}

      {mission.ops && mission.ops.length > 0 && <Ops mission={mission} />}

      <div>
        <div className="tiny muted">{t('mission.objectives')}</div>
        {objectives.map((o) => {
          const def = mission.objectives.find((x) => x.id === o.id)!;
          return (
            <div key={o.id} className="obj">
              <span className={`box ${o.met ? 'done' : ''}`}>{o.met ? '✓' : ''}</span>
              <span className="tiny">{tr(def.text)}</span>
            </div>
          );
        })}
      </div>

      <div className="row wrap">
        <Btn onClick={() => st.runSim()}>▷ {t('common.run')}</Btn>
        <Btn primary disabled={!allMet} onClick={() => st.completeMission()}>{t('mission.complete')}</Btn>
      </div>
      {!allMet && <div className="tiny muted">{needEvidence ? t('mission.needEvidence') : t('mission.needSim')}</div>}
    </div>
  );
}

function Hypotheses({ mission, disabled }: { mission: MissionDef; disabled: boolean }) {
  const st = useGame();
  const { t, tr } = useT();
  const active = st.state.campaign.active!;
  const chosen = active.hypothesis;
  const [sel, setSel] = useState<string | null>(chosen);
  const current = mission.hypotheses!.find((h) => h.id === chosen);
  return (
    <div className="panel inset" style={{ margin: 0 }}>
      <div className="tiny muted">{t('mission.hypothesis')}</div>
      {mission.hypotheses!.map((h) => (
        <label key={h.id} className="obj" style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}>
          <input type="radio" name="hyp" disabled={disabled} checked={sel === h.id} onChange={() => setSel(h.id)} />
          <span className="tiny">{tr(h.text)}</span>
        </label>
      ))}
      <Btn sm disabled={disabled || !sel} onClick={() => sel && st.hypothesis(sel)}>{t('mission.proposeHypothesis')}</Btn>
      {current && <div className={`tiny ${current.correct ? '' : 'tag error'}`} style={{ marginTop: 4 }}>{tr(current.feedback)}</div>}
    </div>
  );
}

function Ops({ mission }: { mission: MissionDef }) {
  const st = useGame();
  const { tr, t } = useT();
  const active = st.state.campaign.active!;
  const { evaluate } = require('@prod/engine') as typeof import('@prod/engine');
  return (
    <div className="col">
      {mission.ops!.map((o) => {
        if (o.when && !evaluate(o.when, st.facts as never)) return null;
        const done = o.once !== false && active.ops.includes(o.id);
        return (
          <Btn key={o.id} sm danger={o.danger} disabled={done} onClick={() => st.op(o.id)} title={o.description ? tr(o.description) : undefined}>
            {done ? '✓ ' : ''}{tr(o.label)}
          </Btn>
        );
      })}
      {mission.ops!.some((o) => o.code) && <div className="tiny muted">⌁ {t('toast.pendingDeploy')}</div>}
    </div>
  );
}
