'use client';
import { useState } from 'react';
import { useGame } from '@/game/store';
import { Btn, Empty, Panel, useT, Why } from '@/ui/kit';
import { PinBtn } from '@/ui/Pin';
import { pin } from '@prod/engine';
import type { DnsRecord } from '@prod/engine';

export function DnsApp() {
  const st = useGame();
  const { t } = useT();
  const w = st.state.world;
  const [domain, setDomain] = useState(w.dns.domain ?? '');
  const servers = w.nodes.filter((n) => ['nginx', 'lb', 'cdn', 'waf'].includes(n.type));

  if (!st.state.unlocks.features.includes('domains')) return <Empty>{t('common.locked')}</Empty>;

  const addRecord = (type: DnsRecord['type'], name: string, value: string, ttl: number) => {
    st.dispatch({ type: 'dns.setRecord', record: { id: `${name}-${type}`, type, name, value, ttl } });
  };

  return (
    <div className="col">
      {!w.dns.domain ? (
        <Panel title="Register a domain">
          <div className="row">
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.shop" />
            <Btn primary onClick={() => st.dispatch({ type: 'dns.setDomain', domain: domain.trim() })}>Register</Btn>
          </div>
        </Panel>
      ) : (
        <>
          <div className="spread"><h3 style={{ margin: 0 }}>{w.dns.domain}</h3><Why node="net.dns" /></div>
          <Panel title="Records">
            <table>
              <thead><tr><th>name</th><th>type</th><th>value</th><th>TTL</th><th></th></tr></thead>
              <tbody>
                {w.dns.records.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.name}</td>
                    <td>{r.type}</td>
                    <td className="mono">{r.value}</td>
                    <td className="mono">{r.ttl}s</td>
                    <td className="row"><PinBtn token={pin.dns(r.name, r.type)} /><Btn sm danger onClick={() => st.dispatch({ type: 'dns.deleteRecord', id: r.id })}>✕</Btn></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <RecordAdder servers={servers} onAdd={addRecord} />
          {w.dns.changes.length > 0 && (
            <Panel title="Recent changes (TTL caching)">
              {w.dns.changes.slice(-4).map((c, i) => (
                <div key={i} className="tiny">{c.name} {c.type}: {c.oldValue} → (ttl {c.oldTtl}s). <Why node="net.ttl" /></div>
              ))}
            </Panel>
          )}
          {st.state.unlocks.features.includes('regions') && (
            <Panel title="Routing">
              <label className="tiny row"><input type="checkbox" checked={w.dns.geoRouting} onChange={(e) => st.dispatch({ type: 'dns.configure', geoRouting: e.target.checked })} /> GeoDNS (nearest region)</label>
              <label className="tiny row"><input type="checkbox" checked={w.dns.failover} onChange={(e) => st.dispatch({ type: 'dns.configure', failover: e.target.checked })} /> Failover on region outage <Why node="global.failover" /></label>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

function RecordAdder({ servers, onAdd }: { servers: import('@prod/engine').ArchNode[]; onAdd: (type: DnsRecord['type'], name: string, value: string, ttl: number) => void }) {
  const [name, setName] = useState('@');
  const [type, setType] = useState<DnsRecord['type']>('A');
  const [value, setValue] = useState(servers[0]?.ip ?? '');
  const [ttl, setTtl] = useState(300);
  return (
    <Panel title="Add / update record">
      <div className="row wrap tiny">
        <input style={{ width: 60 }} value={name} onChange={(e) => setName(e.target.value)} />
        <select value={type} onChange={(e) => setType(e.target.value as DnsRecord['type'])}>
          {['A', 'CNAME', 'MX', 'TXT'].map((tp) => <option key={tp} value={tp}>{tp}</option>)}
        </select>
        {type === 'A' ? (
          <select value={value} onChange={(e) => setValue(e.target.value)}>
            {servers.map((s) => <option key={s.id} value={s.ip}>{s.name} ({s.ip})</option>)}
          </select>
        ) : (
          <input style={{ width: 120 }} value={value} onChange={(e) => setValue(e.target.value)} />
        )}
        <input type="number" style={{ width: 70 }} value={ttl} onChange={(e) => setTtl(Number(e.target.value))} />
        <Btn sm onClick={() => onAdd(type, name, value, ttl)}>+</Btn>
      </div>
    </Panel>
  );
}
