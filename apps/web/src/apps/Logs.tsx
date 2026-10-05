'use client';
import { useState } from 'react';
import { useGame } from '@/game/store';
import { Btn, Empty, useT } from '@/ui/kit';
import { clockParts } from '@prod/engine';

export function LogsApp() {
  const st = useGame();
  const { t } = useT();
  const [level, setLevel] = useState<string>('all');
  const [q, setQ] = useState('');
  const utc = String(st.state.world.app.timezone) === 'utc';
  const active = st.state.campaign.active;

  let logs = st.sim.logs;
  if (level !== 'all') logs = logs.filter((l) => (level === 'err' ? l.level === 'ERROR' || l.level === 'FATAL' : l.level === level));
  if (q) logs = logs.filter((l) => (l.message + l.code + (l.requestId ?? '')).toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="row wrap">
        {['all', 'INFO', 'WARN', 'err'].map((l) => <Btn key={l} sm primary={level === l} onClick={() => setLevel(l)}>{l === 'err' ? 'ERROR+' : l}</Btn>)}
        <input placeholder="filter / request id" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
      </div>
      <div className="panel inset" style={{ flex: 1, overflow: 'auto', background: '#101317', fontSize: 12 }}>
        {logs.length === 0 && <Empty>No log lines.</Empty>}
        {logs.map((l) => {
          const localMin = l.t + (utc ? 0 : l.tz * 60);
          const cp = clockParts(localMin);
          const color = l.level === 'ERROR' || l.level === 'FATAL' ? '#ef6b63' : l.level === 'WARN' ? '#e0a53a' : '#9fb2c9';
          return (
            <div key={l.id} className="mono" style={{ color, whiteSpace: 'pre-wrap', padding: '0 4px', cursor: active ? 'pointer' : 'default' }}
              onClick={() => active && st.dispatch({ type: 'mission.pin', token: { app: 'logs', kind: 'log', key: l.code } })}
              title={active ? t('common.pin') : undefined}>
              <span style={{ color: '#5f6b80' }}>{cp.hhmm}{utc ? 'Z' : `+${l.tz}`}</span> {l.level.padEnd(5)} <span style={{ color: '#7f8aa0' }}>[{l.source}]</span> {l.requestId ? <span style={{ color: '#6f8fff' }}>{l.requestId.slice(0, 10)} </span> : ''}{l.message}
            </div>
          );
        })}
      </div>
      <div className="tiny muted">{utc ? 'Logs shown in UTC.' : 'Logs shown in each server’s local time (see Incident Manager to normalise).'}</div>
    </div>
  );
}
