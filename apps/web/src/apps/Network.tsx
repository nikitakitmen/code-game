'use client';
import { useGame } from '@/game/store';
import { Btn, Panel, useT, ms, Why } from '@/ui/kit';
import { PinBtn } from '@/ui/Pin';
import { pin, rtt, tlsStatus, type RegionId, type TlsState } from '@prod/engine';

export function NetworkApp() {
  const st = useGame();
  const { t } = useT();
  const w = st.state.world;
  const regions: RegionId[] = ['eu', 'us', 'ap'];

  return (
    <div className="col">
      <TlsPanel />

      <Panel title={t('metric.p95') + ' by region'}>
        <table>
          <thead><tr><th>user → server</th>{regions.map((r) => <th key={r}>{r.toUpperCase()}</th>)}</tr></thead>
          <tbody>
            {regions.map((u) => (
              <tr key={u}>
                <td>{u.toUpperCase()}</td>
                {regions.map((s) => <td key={s} className="mono">{ms(rtt(u, s))}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="tiny muted">Round-trip time between a user region and a data centre. Distance is a hard floor on latency.</div>
        <Why node="net.latency" />
      </Panel>

      <Panel title="Observed p95">
        <div className="grid3 tiny">
          {Object.entries(st.sim.summary.regionP95).map(([r, v]) => (
            <div key={r}>
              <div className="muted">{r.toUpperCase()}</div>
              <div className="row"><span className="mono">{ms(v as number)}</span><PinBtn token={pin.metric('network', `p95.${r}`)} /></div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Regions / CDN">
        <div className="tiny">Active regions: {w.regions.map((r) => r.toUpperCase()).join(', ')}</div>
        <div className="tiny">CDN: {w.nodes.some((n) => n.type === 'cdn') ? `edges ${String(w.nodes.find((n) => n.type === 'cdn')?.config.edges)}` : 'none'}</div>
        <Why node="cache.cdn" />
      </Panel>
    </div>
  );
}

/** The site's TLS certificate: issue (simulated ACME), renew and HTTPS options. */
function TlsPanel() {
  const st = useGame();
  const { t } = useT();
  const w = st.state.world;
  const tls = w.tls;
  const status = tlsStatus(st.state);
  const days = tls.expiresAt === null ? null : Math.floor((tls.expiresAt - st.state.clock) / 1440);
  const canIssue = !!w.dns.domain && w.dns.records.some((r) => r.name === '@');
  const configure = (patch: Partial<Pick<TlsState, 'autoRenew' | 'redirectHttp' | 'hsts' | 'version' | 'sessionResumption'>>) => st.dispatch({ type: 'tls.configure', patch });

  return (
    <Panel title={t('net.tls')}>
      <div className="spread tiny">
        <span>
          HTTPS: <b>{tls.enabled ? `on (${tls.issuer})` : 'off'}</b>
          {days !== null && <> · {t('net.expires')} <span className={`mono ${status === 'expired' ? 'tag error' : status === 'expiring' ? 'tag warn' : ''}`}>{days} d</span></>}
        </span>
        <PinBtn token={pin.tls(status)} />
      </div>
      <div className="row wrap" style={{ marginTop: 6 }}>
        <Btn sm primary disabled={!canIssue} onClick={() => st.dispatch({ type: 'tls.issue', issuer: 'letsencrypt' })}>{t('net.issue')}</Btn>
        <Btn sm disabled={!w.dns.domain} onClick={() => st.dispatch({ type: 'tls.issue', issuer: 'self-signed' })}>{t('net.selfSigned')}</Btn>
        <Btn sm disabled={!tls.enabled} onClick={() => st.dispatch({ type: 'tls.renew' })}>{t('net.renew')}</Btn>
      </div>
      {!canIssue && <div className="tiny muted">{t('net.needDomain')}</div>}
      {tls.enabled && (
        <div className="col tiny" style={{ marginTop: 6 }}>
          <label className="row"><input type="checkbox" checked={tls.redirectHttp} onChange={(e) => configure({ redirectHttp: e.target.checked })} /> {t('net.redirect')}</label>
          <label className="row"><input type="checkbox" checked={tls.hsts} onChange={(e) => configure({ hsts: e.target.checked })} /> {t('net.hsts')}</label>
          <label className="row"><input type="checkbox" checked={tls.autoRenew} onChange={(e) => configure({ autoRenew: e.target.checked })} /> {t('net.autoRenew')}</label>
          <label className="row"><input type="checkbox" checked={tls.sessionResumption} onChange={(e) => configure({ sessionResumption: e.target.checked })} /> {t('net.resumption')}</label>
          <label className="row">
            {t('net.version')}
            <select value={tls.version} onChange={(e) => configure({ version: e.target.value as TlsState['version'] })}>
              <option value="1.2">TLS 1.2</option>
              <option value="1.3">TLS 1.3</option>
            </select>
          </label>
        </div>
      )}
      <Why node="net.tls" />
    </Panel>
  );
}
