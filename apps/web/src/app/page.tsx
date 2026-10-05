'use client';
import { useEffect, useState } from 'react';
import { useGame, loadSettings } from '@/game/store';
import { Boot } from '@/os/Boot';
import { Desktop } from '@/os/Desktop';
import { ClientOnly } from '@/ui/kit';

export default function Page() {
  return (
    <ClientOnly>
      <App />
    </ClientOnly>
  );
}

function App() {
  const booted = useGame((s) => s.booted);
  const reduceMotion = useGame((s) => s.reduceMotion);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // restore local settings before first paint of the desktop
    const s = loadSettings();
    const st = useGame.getState();
    if (s.locale) st.setLocale(s.locale);
    if (typeof s.volume === 'number') st.setVolume(s.volume);
    if (s.muted) useGame.setState({ muted: true });
    if (s.reduceMotion) useGame.setState({ reduceMotion: true });
    setReady(true);
  }, []);

  if (!ready) return null;
  return (
    <div className={reduceMotion ? 'rm' : ''}>
      {!booted ? <Boot /> : <Desktop />}
    </div>
  );
}
