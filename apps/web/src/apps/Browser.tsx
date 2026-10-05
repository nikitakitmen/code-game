'use client';
import { useState } from 'react';
import { useGame } from '@/game/store';
import { useWM } from '@/os/windows';
import { Btn, useT, ms } from '@/ui/kit';

/** The user's-eye view: types a URL, "loads" it via the simulation and shows the outcome. */
export function BrowserApp() {
  const st = useGame();
  const wm = useWM();
  const { t } = useT();
  const host = st.state.company.domain ?? st.state.world.site.ip;
  const tls = st.state.world.tls.enabled;
  const [url, setUrl] = useState(`${tls ? 'https' : 'http'}://${host}/`);
  const [path, setPath] = useState('/');
  const pageEps = st.state.world.endpoints.filter((e) => !e.disabled && (e.target === 'static' || !e.api));

  const ep = st.state.world.endpoints.find((e) => e.path === path && !e.disabled);
  const sim = ep ? st.sim.endpoints[ep.id] : undefined;
  const ok = sim ? sim.served && sim.errorRate < 0.2 : false;

  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="row">
        <Btn sm onClick={() => { const next = tls ? 'https' : 'http'; setUrl(`${next}://${host}${path}`); }}>⟳</Btn>
        <input style={{ flex: 1 }} value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
      <div className="row wrap tiny">
        {pageEps.map((e) => (
          <Btn key={e.id} sm primary={path === e.path} onClick={() => { setPath(e.path); setUrl(`${tls ? 'https' : 'http'}://${host}${e.path}`); }}>{e.path}</Btn>
        ))}
      </div>
      <div className="panel inset" style={{ flex: 1, overflow: 'auto', background: '#fff', color: '#111' }}>
        {!st.state.company.name ? (
          <div style={{ padding: 20 }}>No site yet.</div>
        ) : !ep ? (
          <Err code={404} msg="Not Found" />
        ) : !sim || !sim.served ? (
          <Err code={sim?.status ?? 0} msg="This site can’t be reached" />
        ) : sim.errorRate > 0.5 ? (
          <Err code={sim.status} msg="Something went wrong" />
        ) : (
          <SitePreview path={path} />
        )}
      </div>
      {sim && (
        <div className="row spread tiny">
          <span>{ok ? '🔒 ' : ''}{sim.status} · {ms(sim.pageLoadMs ?? sim.p95)}{sim.pageWeightKb ? ` · ${sim.pageWeightKb} KB` : ''}</span>
          <Btn sm onClick={() => wm.open('inspector', { endpointId: ep?.id })} disabled={!st.state.unlocks.apps.includes('inspector')}>{t('app.inspector')}</Btn>
        </div>
      )}
    </div>
  );
}

function Err({ code, msg }: { code: number; msg: string }) {
  return (
    <div style={{ padding: 24, textAlign: 'center', color: '#555' }}>
      <div style={{ fontSize: 40 }}>{code || '⚠'}</div>
      <div>{msg}</div>
    </div>
  );
}

function SitePreview({ path }: { path: string }) {
  const st = useGame();
  const name = st.state.company.name;
  const missing = st.sim.endpoints[st.state.world.endpoints.find((e) => e.path === path)?.id ?? '']?.missingAssets ?? [];
  return (
    <div style={{ padding: 16, fontFamily: 'sans-serif' }}>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{name}</div>
      {missing.length > 0 && <div style={{ color: '#b5241f', fontSize: 12 }}>⚠ {missing.length} asset(s) missing (404)</div>}
      <p style={{ color: '#444' }}>{path === '/' ? 'Welcome to our shop.' : `Page: ${path}`}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} style={{ width: 90, height: 70, background: '#eee', border: '1px solid #ccc', display: 'grid', placeItems: 'center', fontSize: 11, color: '#999' }}>product {i}</div>
        ))}
      </div>
    </div>
  );
}
