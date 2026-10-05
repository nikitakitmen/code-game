'use client';
import { useRef, useState, useEffect } from 'react';
import { useGame } from '@/game/store';
import { Btn, Dot, Meter, useT, money, pct, ms, Why } from '@/ui/kit';
import { canConnect, componentDef, maybeComponent, type ArchNode, type ConfigValue } from '@prod/engine';

export function ArchitectureApp() {
  const st = useGame();
  const { t, tr } = useT();
  const [sel, setSel] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [showPalette, setShowPalette] = useState(true);
  const canvasRef = useRef<HTMLDivElement>(null);
  const w = st.state.world;
  const sim = st.sim;

  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const node = (id: string) => w.nodes.find((n) => n.id === id);

  const onNodeDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    setSel(id);
    if (connectFrom && connectFrom !== id) {
      const r = canConnect(st.content, w, connectFrom, id);
      if (r.ok) st.dispatch({ type: 'edge.connect', from: connectFrom, to: id });
      else st.toast(t(`err.${r.reason}`, r.params), 'error');
      setConnectFrom(null);
      return;
    }
    const n = node(id)!;
    const rect = canvasRef.current!.getBoundingClientRect();
    dragRef.current = { id, dx: e.clientX - rect.left - n.pos.x, dy: e.clientY - rect.top - n.pos.y };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = Math.max(4, Math.min(rect.width - 96, e.clientX - rect.left - dragRef.current.dx));
    const y = Math.max(4, Math.min(rect.height - 60, e.clientY - rect.top - dragRef.current.dy));
    st.dispatch({ type: 'node.move', id: dragRef.current.id, pos: { x, y } });
  };
  const onUp = () => { dragRef.current = null; };

  const selNode = sel ? node(sel) : undefined;

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {showPalette && <Palette onAdd={(type) => st.dispatch({ type: 'node.add', nodeType: type })} />}
      <div style={{ flex: 1, position: 'relative' }}>
        <div className="row" style={{ position: 'absolute', top: 4, left: 4, zIndex: 5 }}>
          <Btn sm onClick={() => setShowPalette(!showPalette)}>{showPalette ? '◀' : '▶'} {t('arch.palette')}</Btn>
          <Btn sm primary={!!connectFrom} onClick={() => setConnectFrom(connectFrom ? null : sel)} disabled={!sel && !connectFrom}>{t('arch.connect')}</Btn>
          <Btn sm onClick={() => st.runSim()}>▷ {t('common.run')}</Btn>
        </div>
        <div className="arch-canvas" ref={canvasRef} onPointerMove={onMove} onPointerUp={onUp} onPointerDown={() => { setSel(null); setConnectFrom(null); }}>
          <Edges />
          <Packets />
          {w.nodes.map((n) => <NodeCard key={n.id} node={n} selected={sel === n.id} connecting={connectFrom === n.id} onDown={onNodeDown} />)}
          {connectFrom && <div className="tiny" style={{ position: 'absolute', bottom: 4, left: 4, background: 'var(--paper)', padding: '2px 6px', border: '2px solid var(--line)' }}>{t('arch.hintConnect')}</div>}
        </div>
      </div>
      {selNode && <Inspector node={selNode} onClose={() => setSel(null)} />}
    </div>
  );
}

function Palette({ onAdd }: { onAdd: (type: string) => void }) {
  const st = useGame();
  const { t, tr } = useT();
  const avail = st.content.components.filter((c) => st.state.unlocks.components.includes(c.type) && c.role !== 'client' && c.role !== 'region');
  return (
    <div style={{ width: 128, borderRight: '2px solid var(--line)', overflow: 'auto', flex: 'none', padding: 4 }}>
      <div className="tiny muted">{t('arch.palette')}</div>
      {avail.map((c) => (
        <div key={c.type} onClick={() => onAdd(c.type)} className="panel inset" style={{ margin: '4px 0', padding: '4px 6px', cursor: 'pointer' }} title={tr(c.purpose)}>
          <div className="tiny">{c.icon ? '' : ''}{tr(c.label)}</div>
          <div className="tiny muted">{money(c.costPerMonth)}/mo</div>
        </div>
      ))}
      {st.state.unlocks.features.includes('regions') && (
        <RegionAdder />
      )}
    </div>
  );
}

function RegionAdder() {
  const st = useGame();
  const { t } = useT();
  const all = ['eu', 'us', 'ap'] as const;
  const open = st.state.world.regions;
  return (
    <div className="panel inset" style={{ margin: '4px 0', padding: '4px 6px' }}>
      <div className="tiny muted">{t('arch.region')}</div>
      {all.filter((r) => !open.includes(r)).map((r) => (
        <Btn key={r} sm onClick={() => st.dispatch({ type: 'region.add', region: r })}>+ {r.toUpperCase()}</Btn>
      ))}
    </div>
  );
}

function NodeCard({ node, selected, connecting, onDown }: { node: ArchNode; selected: boolean; connecting: boolean; onDown: (e: React.PointerEvent, id: string) => void }) {
  const st = useGame();
  const { tr } = useT();
  const def = maybeComponent(st.content, node.type);
  const ns = st.sim.nodes[node.id];
  const status = node.offline ? 'offline' : ns?.status ?? 'ok';
  return (
    <div className={`node ${selected ? 'sel' : ''}`} style={{ left: node.pos.x, top: node.pos.y, outline: connecting ? '2px dashed var(--accent)' : undefined }} onPointerDown={(e) => onDown(e, node.id)}>
      <div className="node-head">
        <Dot status={status} /> <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{def ? tr(def.label).split(' ')[0] : node.type}</span>
      </div>
      <div className="node-body">
        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.name}</div>
        {ns && def?.role !== 'client' && <Meter value={ns.utilMax} max={1} />}
      </div>
    </div>
  );
}

function center(node: ArchNode) { return { x: node.pos.x + 46, y: node.pos.y + 24 }; }

function Edges() {
  const st = useGame();
  const w = st.state.world;
  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      {w.edges.map((e) => {
        const a = w.nodes.find((n) => n.id === e.from);
        const b = w.nodes.find((n) => n.id === e.to);
        if (!a || !b) return null;
        const ca = center(a); const cb = center(b);
        const err = (st.sim.edges[e.id]?.errorRate ?? 0) > 0.05;
        return <line key={e.id} className={`edge ${err ? 'err' : ''}`} x1={ca.x} y1={ca.y} x2={cb.x} y2={cb.y} />;
      })}
    </svg>
  );
}

/** Animated request packets travelling the busiest edges. */
function Packets() {
  const st = useGame();
  const reduce = st.reduceMotion;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setTick((x) => (x + 1) % 100), 90);
    return () => clearInterval(id);
  }, [reduce]);
  if (reduce) return null;
  const w = st.state.world;
  const busy = w.edges
    .map((e) => ({ e, rps: st.sim.edges[e.id]?.rps ?? 0 }))
    .filter((x) => x.rps > 0)
    .sort((a, b) => b.rps - a.rps)
    .slice(0, 6);
  return (
    <>
      {busy.map(({ e }, i) => {
        const a = w.nodes.find((n) => n.id === e.from);
        const b = w.nodes.find((n) => n.id === e.to);
        if (!a || !b) return null;
        const ca = center(a); const cb = center(b);
        const p = ((tick + i * 16) % 100) / 100;
        const x = ca.x + (cb.x - ca.x) * p;
        const y = ca.y + (cb.y - ca.y) * p;
        const err = (st.sim.edges[e.id]?.errorRate ?? 0) > 0.05;
        return <div key={e.id} className="packet" style={{ left: x - 3, top: y - 3, background: err ? 'var(--error)' : 'var(--accent)' }} />;
      })}
    </>
  );
}

function Inspector({ node, onClose }: { node: ArchNode; onClose: () => void }) {
  const st = useGame();
  const { t, tr } = useT();
  const def = componentDef(st.content, node.type);
  const ns = st.sim.nodes[node.id];
  const setConfig = (key: string, value: ConfigValue) => st.dispatch({ type: 'node.config', id: node.id, key, value });
  return (
    <div style={{ width: 210, borderLeft: '2px solid var(--line)', overflow: 'auto', flex: 'none', padding: 8 }}>
      <div className="spread">
        <h3 style={{ margin: 0 }}>{node.name}</h3>
        <button className="btn sm" onClick={onClose}>✕</button>
      </div>
      <div className="tiny muted">{tr(def.purpose)}</div>
      <Why node={def.knowledge} label={t('common.why')} />
      <hr />
      {ns && def.role !== 'client' && (
        <div className="col tiny">
          <div className="spread"><span>{t('arch.health')}</span><Dot status={node.offline ? 'offline' : ns.status} /></div>
          <div className="spread"><span>{t('arch.util')}</span><span className="mono">{pct(ns.utilMax)}</span></div>
          <Meter value={ns.utilMax} max={1} />
          {ns.connections !== undefined && <div className="spread"><span>connections</span><span className="mono">{ns.connections}/{ns.maxConnections}</span></div>}
          {ns.memoryUsedMb !== undefined && <div className="spread"><span>memory</span><span className="mono">{Math.round(ns.memoryUsedMb)}/{ns.memoryMb} MB</span></div>}
          <div className="spread"><span>{t('arch.cost')}</span><span className="mono">{money(ns.costPerMonth)}</span></div>
          {ns.reasons.length > 0 && <div className="tag warn">{ns.reasons.join(', ')}</div>}
        </div>
      )}
      {def.scalable && (
        <div style={{ marginTop: 6 }}>
          <div className="tiny muted">size</div>
          <select value={node.size} onChange={(e) => st.dispatch({ type: 'node.resize', id: node.id, size: e.target.value as ArchNode['size'] })}>
            {(['s', 'm', 'l', 'xl', '2xl'] as const).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}
      {def.config.length > 0 && (
        <div className="col" style={{ marginTop: 6 }}>
          <div className="tiny muted">{t('arch.settings')}</div>
          {def.config.filter((f) => !f.feature || st.state.unlocks.features.includes(f.feature)).map((f) => (
            <ConfigField key={f.key} node={node} field={f} value={node.config[f.key]} onChange={(v) => setConfig(f.key, v)} />
          ))}
        </div>
      )}
      {st.state.world.regions.length > 1 && def.role !== 'client' && !def.external && (
        <div style={{ marginTop: 6 }}>
          <div className="tiny muted">{t('arch.region')}</div>
          <select value={node.region} onChange={(e) => st.dispatch({ type: 'node.move', id: node.id, pos: node.pos, region: e.target.value as ArchNode['region'] })}>
            {st.state.world.regions.map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}
          </select>
        </div>
      )}
      <hr />
      <div className="row wrap">
        <Btn sm onClick={() => st.dispatch({ type: 'node.power', id: node.id, offline: !node.offline })}>{node.offline ? t('arch.online') : t('arch.offline')}</Btn>
        <Btn sm onClick={() => st.dispatch({ type: 'node.restart', id: node.id })}>{t('arch.restart')}</Btn>
        {!node.locked && <Btn sm danger onClick={() => { st.dispatch({ type: 'node.remove', id: node.id }); onClose(); }}>{t('arch.delete')}</Btn>}
      </div>
    </div>
  );
}

function ConfigField({ field, value, onChange }: { node: ArchNode; field: import('@prod/engine').ConfigFieldDef; value: ConfigValue; onChange: (v: ConfigValue) => void }) {
  const { tr } = useT();
  return (
    <label className="tiny" title={tr(field.help)}>
      <div className="muted">{tr(field.label)}</div>
      {field.type === 'bool' ? (
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
      ) : field.type === 'enum' ? (
        <select value={String(value)} onChange={(e) => { const raw = e.target.value; const opt = field.options!.find((o) => String(o) === raw); onChange(typeof opt === 'number' ? Number(raw) : raw); }}>
          {field.options!.map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
        </select>
      ) : (
        <input type="number" value={Number(value)} min={field.min} max={field.max} step={field.step} onChange={(e) => onChange(Number(e.target.value))} />
      )}
    </label>
  );
}
