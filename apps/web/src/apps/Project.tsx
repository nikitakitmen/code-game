'use client';
import { useGame } from '@/game/store';
import { useWM } from '@/os/windows';
import { Btn, Panel, useT, num, money, pct } from '@/ui/kit';
import { SettingsPanel } from '@/ui/Settings';

export function ProjectApp() {
  const st = useGame();
  const wm = useWM();
  const { t, tr } = useT();
  const done = st.state.campaign.completedOrder.length;
  const total = st.content.missionIndex.length;
  const acts = st.content.acts;

  return (
    <div className="col">
      <Panel>
        <div className="spread">
          <h2 style={{ margin: 0 }}>{st.state.company.name || 'untitled'}</h2>
          <span className="tag">{done}/{total}</span>
        </div>
        <div className="tiny muted">{st.state.company.domain ?? 'no domain yet'}</div>
        <div className="grid3" style={{ marginTop: 8 }}>
          <div><div className="tiny muted">{t('metric.users')}</div><div className="mono">{num(st.state.world.traffic.users)}</div></div>
          <div><div className="tiny muted">{t('metric.budget')}</div><div className="mono">{money(st.state.budget.cash)}</div></div>
          <div><div className="tiny muted">{t('metric.availability')}</div><div className="mono">{pct(st.sim.summary.availability, 2)}</div></div>
        </div>
      </Panel>

      <Panel title={t('menu.apps')}>
        <div className="row wrap">
          {acts.map((a) => {
            const missions = st.content.missionIndex.filter((m) => m.act === a.act);
            const doneInAct = missions.filter((m) => st.state.campaign.completed[m.id]).length;
            const open = missions.some((m) => st.state.campaign.completed[m.id]) || a.act === 1;
            return (
              <div key={a.act} className="panel inset" style={{ margin: 0, width: 150, opacity: open ? 1 : 0.5 }}>
                <div className="tiny muted">{t('mission.act')} {a.act}</div>
                <div className="tiny" style={{ fontWeight: 700 }}>{tr(a.title)}</div>
                <div className="tiny muted">{doneInAct}/{missions.length}</div>
              </div>
            );
          })}
        </div>
      </Panel>

      <SettingsPanel app="project" title={t('set.title.project')} />

      <div className="row">
        <Btn primary onClick={() => wm.open('mail')}>{t('app.mail')}</Btn>
        <Btn onClick={() => wm.open('architecture')} disabled={!st.state.unlocks.apps.includes('architecture')}>{t('app.architecture')}</Btn>
        <Btn onClick={() => wm.open('knowledge')} disabled={!st.state.unlocks.apps.includes('knowledge')}>{t('app.knowledge')}</Btn>
      </div>
    </div>
  );
}
