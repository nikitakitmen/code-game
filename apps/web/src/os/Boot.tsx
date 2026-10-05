'use client';
import { useEffect, useState } from 'react';
import { useGame } from '@/game/store';
import { useT } from '@/ui/kit';
import { play, resumeAudio } from './sounds';

export function Boot() {
  const boot = useGame((s) => s.boot);
  const muted = useGame((s) => s.muted);
  const volume = useGame((s) => s.volume);
  const { t } = useT();
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let p = 0;
    const id = setInterval(() => {
      p += Math.random() * 22 + 8;
      if (p >= 100) {
        p = 100;
        setDone(true);
        clearInterval(id);
      }
      setProgress(p);
    }, 180);
    return () => clearInterval(id);
  }, []);

  const start = () => {
    resumeAudio();
    if (!muted) play('boot', volume);
    boot();
  };

  return (
    <div className="boot" onClick={done ? start : undefined} role="button" aria-label="Boot PROD OS">
      <div className="boot-inner">
        <div className="boot-logo">PROD&nbsp;OS</div>
        <div className="boot-tag">{t('boot.tagline')}</div>
        <div className="boot-bar">
          <span style={{ width: `${progress}%` }} />
        </div>
        {!done ? (
          <div className="boot-press">{t('boot.loading')}…</div>
        ) : (
          <div className="boot-press blink">{t('boot.press')}</div>
        )}
      </div>
    </div>
  );
}
