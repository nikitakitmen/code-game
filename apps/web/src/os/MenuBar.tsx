'use client';
import { useEffect, useRef, useState } from 'react';
import { useGame } from '@/game/store';
import { useWM } from './windows';
import { APPS } from './registry';
import { useT } from '@/ui/kit';

function Clock() {
  const [now, setNow] = useState('');
  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    tick();
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
  }, []);
  return <span className="mono">{now}</span>;
}

export function MenuBar() {
  const { t, locale } = useT();
  const [menu, setMenu] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const st = useGame();
  const wm = useWM();
  const unlockedApps = st.state.unlocks.apps;
  const open = (id: string) => { wm.open(id); setMenu(null); };

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const saveLabel =
    st.saveStatus === 'saving' ? t('menu.saving') : st.saveStatus === 'saved' ? t('menu.saved') : st.saveStatus === 'conflict' ? '⚠' : t('menu.offline');

  return (
    <div className="menubar" ref={ref}>
      <span className="brand">◆ PROD</span>
      <div className={`menu-item ${menu === 'prod' ? 'open' : ''}`} onClick={() => setMenu(menu === 'prod' ? null : 'prod')}>
        {t('menu.prod')}
        {menu === 'prod' && (
          <div className="menu-drop" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => { wm.open('help'); setMenu(null); }}>{t('menu.about')}</button>
            <div className="sep" />
            <button onClick={() => { void st.save(); setMenu(null); }}>{t('menu.save')}</button>
            <div className="sep" />
            {st.authed ? (
              <button onClick={() => { void useGame.getState(); setMenu(null); import('@/game/api').then((m) => m.api.logout().then(() => useGame.setState({ authed: false }))); }}>{t('menu.logout')}</button>
            ) : (
              <button onClick={() => { st.openModal({ kind: 'auth' }); setMenu(null); }}>{t('menu.login')}</button>
            )}
          </div>
        )}
      </div>

      <div className={`menu-item ${menu === 'apps' ? 'open' : ''}`} onClick={() => setMenu(menu === 'apps' ? null : 'apps')}>
        {t('menu.apps')}
        {menu === 'apps' && (
          <div className="menu-drop" onClick={(e) => e.stopPropagation()} style={{ maxHeight: 420, overflow: 'auto' }}>
            {APPS.filter((a) => unlockedApps.includes(a.id)).map((a) => (
              <button key={a.id} onClick={() => open(a.id)}>
                <span>{a.icon} {t(`app.${a.id}`)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={`menu-item ${menu === 'win' ? 'open' : ''}`} onClick={() => setMenu(menu === 'win' ? null : 'win')}>
        {t('menu.apps') === 'Apps' ? 'Windows' : 'Окна'}
        {menu === 'win' && (
          <div className="menu-drop" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => { wm.cascade(); setMenu(null); }}>{t('menu.cascade')}</button>
            <button onClick={() => { wm.tile(); setMenu(null); }}>{t('menu.tile')}</button>
          </div>
        )}
      </div>

      <div className={`menu-item ${menu === 'sound' ? 'open' : ''}`} onClick={() => setMenu(menu === 'sound' ? null : 'sound')}>
        {t('menu.sound')}
        {menu === 'sound' && (
          <div className="menu-drop" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => st.toggleMute()}>
              <span>{t('menu.mute')}</span><span>{st.muted ? '✓' : ''}</span>
            </button>
            <div style={{ padding: '4px 8px' }}>
              <input type="range" min={0} max={1} step={0.05} value={st.volume} onChange={(e) => st.setVolume(Number(e.target.value))} />
            </div>
            <div className="sep" />
            <button onClick={() => st.toggleReduceMotion()}>
              <span>{t('menu.reduceMotion')}</span><span>{st.reduceMotion ? '✓' : ''}</span>
            </button>
          </div>
        )}
      </div>

      <div className={`menu-item ${menu === 'lang' ? 'open' : ''}`} onClick={() => setMenu(menu === 'lang' ? null : 'lang')}>
        {locale.toUpperCase()}
        {menu === 'lang' && (
          <div className="menu-drop" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => { st.setLocale('en'); setMenu(null); }}><span>English</span><span>{locale === 'en' ? '✓' : ''}</span></button>
            <button onClick={() => { st.setLocale('ru'); setMenu(null); }}><span>Русский</span><span>{locale === 'ru' ? '✓' : ''}</span></button>
          </div>
        )}
      </div>

      <div className="spacer" />
      <div className="tray">
        <span className="pill" title={st.state.company.name || ''}>{st.state.company.name || 'untitled'}</span>
        <span className="pill">{st.authed ? t('menu.account') : t('menu.guest')} · {saveLabel}</span>
        <Clock />
      </div>
    </div>
  );
}
