'use client';
import { useGame } from '@/game/store';
import { Btn, Dot, Meter, Panel, useT, pct, money } from '@/ui/kit';
import { maybeComponent } from '@prod/engine';

export function ServersApp() {
  const st = useGame();
  const { t, tr } = useT();
  const w = st.state.world;
  const hosts = w.nodes.filter((n) => maybeComponent(st.content, n.type)?.role !== 'client');
  return (
    <div className="col">
      <div className="tiny muted">Processes, ports and the firewall. Open a public port by connecting the Users node to a server in Architecture, or toggle below.</div>
      {hosts.map((n) => {
        const ns = st.sim.nodes[n.id];
        const def = maybeComponent(st.content, n.type);
        return (
          <Panel key={n.id} title={n.name}>
            <div className="spread tiny">
              <span><Dot status={n.offline ? 'offline' : ns?.status ?? 'ok'} /> {tr(def?.label)} · {n.ip}</span>
              <span className="mono">{money(ns?.costPerMonth ?? 0)}/mo</span>
            </div>
            {ns && def?.role !== 'region' && (
              <div className="tiny" style={{ marginTop: 4 }}>
                <div className="spread"><span>CPU</span><span className="mono">{pct(ns.utilMax)}</span></div>
                <Meter value={ns.utilMax} max={1} />
                <div className="spread"><span>RAM</span><span className="mono">{Math.round(ns.ram)}%</span></div>
                <Meter value={ns.ram} max={100} />
              </div>
            )}
            <div className="tiny" style={{ marginTop: 4 }}>
              listening: <span className="mono">{n.ports.join(', ') || '—'}</span>
            </div>
            <div className="tiny">public (firewall): <span className="mono">{n.publicPorts.join(', ') || 'none'}</span></div>
            <div className="row wrap" style={{ marginTop: 4 }}>
              {n.ports.map((p) => (
                <Btn key={p} sm primary={n.publicPorts.includes(p)} onClick={() => st.dispatch({ type: 'node.port', id: n.id, port: p, open: !n.publicPorts.includes(p) })}>
                  {n.publicPorts.includes(p) ? '🔓' : '🔒'} {p}
                </Btn>
              ))}
              <Btn sm onClick={() => st.dispatch({ type: 'node.power', id: n.id, offline: !n.offline })}>{n.offline ? t('arch.online') : t('arch.offline')}</Btn>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
