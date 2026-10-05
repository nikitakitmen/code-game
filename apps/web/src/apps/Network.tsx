'use client';
import { useGame } from '@/game/store';
import { Panel, useT, ms, Why } from '@/ui/kit';
import { rtt, type RegionId } from '@prod/engine';

export function NetworkApp() {
  const st = useGame();
  const { t } = useT();
  const w = st.state.world;
  const regions: RegionId[] = ['eu', 'us', 'ap'];
  const tls = w.tls;

  return (
    <div className="col">
      <Panel title="TLS / HTTPS">
        <div className="grid2 tiny">
          <span>HTTPS</span><span>{tls.enabled ? `on (${tls.issuer})` : 'off'}</span>
          <span>TLS version</span><span>{tls.version}</span>
          <span>HTTP→HTTPS redirect</span><span>{tls.redirectHttp ? 'yes' : 'no'}</span>
          <span>HSTS</span><span>{tls.hsts ? 'yes' : 'no'}</span>
          <span>Expires in</span><span>{tls.expiresAt === null ? '—' : `${Math.floor((tls.expiresAt - st.state.clock) / 1440)} days`}</span>
        </div>
        <Why node="net.tls" />
      </Panel>

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
            <div key={r}><div className="muted">{r.toUpperCase()}</div><div className="mono">{ms(v as number)}</div></div>
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
