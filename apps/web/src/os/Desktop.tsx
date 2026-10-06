'use client';
import { useEffect } from 'react';
import { useGame } from '@/game/store';
import { useWM } from './windows';
import { APPS } from './registry';
import { MenuBar } from './MenuBar';
import { WindowFrame } from './Window';
import { MissionDock } from './MissionDock';
import { Toasts } from './Toasts';
import { Modals } from './Modals';
import { useT } from '@/ui/kit';

export function Desktop() {
  const st = useGame();
  const wm = useWM();
  const { t } = useT();
  const unlocked = st.state.unlocks.apps;

  // first run: open mail; once the saved game is loaded, ask for the company name if there is none
  useEffect(() => {
    if (!wm.windows.length) wm.open('mail');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (st.hydrated && !st.state.company.name && !st.modal) st.openModal({ kind: 'company' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.hydrated]);

  const icons = APPS.filter((a) => a.desktop && unlocked.includes(a.id));

  return (
    <>
      <MenuBar />
      <div className="desktop" onPointerDown={() => wm.focusedId && null}>
        <div className="desktop-icons">
          {icons.map((a) => (
            <div key={a.id} className="dicon" tabIndex={0} onDoubleClick={() => wm.open(a.id)} onKeyDown={(e) => e.key === 'Enter' && wm.open(a.id)} role="button">
              <div className="dicon-img">{a.icon}</div>
              <div className="dicon-label">{t(`app.${a.id}`)}</div>
            </div>
          ))}
        </div>
        {wm.windows.map((w) => (
          <WindowFrame key={w.id} win={w} />
        ))}
        <MissionDock />
      </div>
      <Toasts />
      <Modals />
    </>
  );
}
