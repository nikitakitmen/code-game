'use client';
import { useGame } from '@/game/store';
import { Btn, Empty, Panel, useT, pct, Why } from '@/ui/kit';
import { SettingsPanel } from '@/ui/Settings';

export function CacheApp() {
  const st = useGame();
  const { t } = useT();
  const w = st.state.world;
  const redis = w.nodes.filter((n) => n.type === 'redis');
  if (!redis.length) return <Empty>No Redis yet. Add one in Architecture.</Empty>;
  const cacheable = w.endpoints.filter((e) => !e.disabled && e.cache);

  return (
    <div className="col">
      {redis.map((r) => {
        const ns = st.sim.nodes[r.id];
        return (
          <Panel key={r.id} title={`${r.name} (${String(r.config.purpose)})`}>
            <div className="grid2 tiny">
              <span>memory</span><span className="mono">{Math.round(ns?.memoryUsedMb ?? 0)}/{ns?.memoryMb} MB</span>
              <span>policy</span><span className="mono">{String(r.config.maxmemoryPolicy)}</span>
            </div>
            {(ns?.memoryUsedMb ?? 0) >= (ns?.memoryMb ?? 1e9) && <div className="tag error tiny">⚠ Out of memory</div>}
          </Panel>
        );
      })}
      <Panel title="Cache rules">
        {cacheable.map((e) => {
          const rule = w.cacheRules.find((r) => r.endpoint === e.id);
          const s = st.sim.endpoints[e.id];
          return (
            <div key={e.id} className="spread tiny" style={{ borderBottom: '1px solid var(--line)', padding: '3px 0' }}>
              <span className="mono">{e.path}</span>
              <span className="row">
                {s?.cacheHitRate !== null && s?.cacheHitRate !== undefined && <span className="tag">{pct(s.cacheHitRate, 0)} hit</span>}
                <label className="tiny">ttl <input type="number" style={{ width: 60 }} value={rule?.ttl ?? 60} onChange={(ev) => st.dispatch({ type: 'cache.rule', endpoint: e.id, enabled: rule?.enabled ?? true, ttl: Number(ev.target.value) })} /></label>
                <Btn sm primary={rule?.enabled} onClick={() => st.dispatch({ type: 'cache.rule', endpoint: e.id, enabled: !rule?.enabled, ttl: rule?.ttl ?? 60 })}>{rule?.enabled ? 'on' : 'off'}</Btn>
              </span>
            </div>
          );
        })}
      </Panel>
      <SettingsPanel app="cache" />
      <div className="row"><Why node="cache.redis" /><Why node="cache.invalidation" /><Why node="cache.eviction" /></div>
    </div>
  );
}
