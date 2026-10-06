'use client';
import { useGame } from '@/game/store';
import { Empty, Panel, useT, num, Why } from '@/ui/kit';
import { PinBtn } from '@/ui/Pin';
import { SettingsPanel } from '@/ui/Settings';
import { pin } from '@prod/engine';

export function QueueApp() {
  const st = useGame();
  const { t } = useT();
  const queues = Object.values(st.sim.queues);
  if (!st.state.world.nodes.some((n) => n.type === 'queue')) return <div className="col"><Empty>No queue yet. Add one in Architecture.</Empty><SettingsPanel app="queue" /></div>;
  return (
    <div className="col">
      {queues.length === 0 && <div className="tiny muted">No jobs flowing. Enable async work in a mission.</div>}
      {queues.map((q) => (
        <Panel key={q.name} title={`queue: ${q.name}`}>
          <div className="row" style={{ justifyContent: 'flex-end' }}><PinBtn token={pin.queue(q.name)} /></div>
          <div className="grid2 tiny">
            <span>incoming</span><span className="mono">{q.inRate.toFixed(1)}/s</span>
            <span>throughput</span><span className="mono">{q.throughput.toFixed(1)}/s</span>
            <span>backlog</span><span className={`mono ${q.backlogEnd > 1000 ? 'tag error' : ''}`}>{num(q.backlogEnd)}</span>
            <span>wait</span><span className="mono">{Number.isFinite(q.waitSec) ? `${Math.round(q.waitSec)}s` : '∞'}</span>
            <span>workers</span><span className="mono">{q.workers}</span>
            <span>retries/h</span><span className="mono">{q.retriesPerHour.toFixed(0)}</span>
            <span>failed/h</span><span className={`mono ${q.failedPerHour > 0 ? 'tag warn' : ''}`}>{q.failedPerHour.toFixed(0)}</span>
            <span>dead-letter/h</span><span className="mono">{q.dlqPerHour.toFixed(0)}</span>
            <span>duplicates/h</span><span className={`mono ${q.duplicatesPerHour > 1 ? 'tag warn' : ''}`}>{q.duplicatesPerHour.toFixed(0)}</span>
          </div>
        </Panel>
      ))}
      <SettingsPanel app="queue" />
      <Why node="async.queue" />
    </div>
  );
}
