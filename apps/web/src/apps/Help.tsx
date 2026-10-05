'use client';
import { useGame } from '@/game/store';
import { useWM } from '@/os/windows';
import { Btn, Panel, useT } from '@/ui/kit';

export function HelpApp() {
  const { t } = useT();
  const wm = useWM();
  return (
    <div className="col">
      <Panel>
        <h2>PROD OS</h2>
        <div className="small">Build it. Break it. Scale it.</div>
        <div className="tiny muted">An engineering simulator. You never write code — you diagnose and shape a real production system by placing components, flipping settings, and running simulations.</div>
      </Panel>
      <Panel title="How to play">
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Read <b>{t('app.mail')}</b> for the next task and NPC messages.</li>
          <li>The mission dock (bottom-left) shows symptoms, evidence, hypotheses and objectives.</li>
          <li>Investigate with the tool apps; <b>{t('common.pin')}</b> findings as evidence.</li>
          <li>Make changes in <b>{t('app.architecture')}</b> and the other apps, then <b>{t('common.run')}</b>.</li>
          <li>When objectives are met, complete the mission to see before/after and why it worked.</li>
          <li>Press <b>{t('common.why')}</b> anywhere to open the Encyclopedia.</li>
        </ul>
      </Panel>
      <div className="row wrap">
        <Btn onClick={() => wm.open('encyclopedia')}>{t('app.encyclopedia')}</Btn>
        <Btn onClick={() => wm.open('knowledge')}>{t('app.knowledge')}</Btn>
        <Btn onClick={() => wm.open('timemachine')}>{t('app.timemachine')}</Btn>
      </div>
    </div>
  );
}
