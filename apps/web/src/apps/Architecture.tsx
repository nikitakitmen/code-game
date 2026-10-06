'use client';
import { useRef, useState, useEffect } from 'react';
import { useGame } from '@/game/store';
import { Btn, Dot, Meter, useT, money, pct, ms, Why } from '@/ui/kit';
import { canConnect, componentDef, maybeComponent, pin, tableOwners, type ArchNode, type ConfigValue, type RegionId } from '@prod/engine';
import { PinBtn } from '@/ui/Pin';
import { SettingsPanel } from '@/ui/Settings';

export function ArchitectureApp() {
  const st = useGame();
  const { t, tr } = useT();
  const [sel, setSel] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [showPalette, setShowPalette] = useState(true);
  const [showSystem, setShowSystem] = useState(false);
  const [addRegion, setAddRegion] = useState<RegionId>(st.state.world.primaryRegion);
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
    const y = Math.max(40, Math.min(rect.height - 60, e.clientY - rect.top - dragRef.current.dy)); // keep clear of the toolbar
    st.dispatch({ type: 'node.move', id: dragRef.current.id, pos: { x, y } });
  };
  const onUp = () => { dragRef.current = null; };

  const selNode = sel ? node(sel) : undefined;

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {showPalette && <Palette region={addRegion} setRegion={setAddRegion} onAdd={(type) => st.dispatch({ type: 'node.add', nodeType: type, region: maybeComponent(st.content, type)?.external ? undefined : addRegion })} />}
      <div style={{ flex: 1, position: 'relative', overflow: 'auto' }}>
        <div className="row" style={{ position: 'absolute', top: 4, left: 4, zIndex: 5 }}>
          <Btn sm onClick={() => setShowPalette(!showPalette)}>{showPalette ? '◀' : '▶'} {t('arch.palette')}</Btn>
          <Btn sm primary={!!connectFrom} onClick={() => setConnectFrom(connectFrom ? null : sel)} disabled={!sel && !connectFrom}>{t('arch.connect')}</Btn>
          <Btn sm onClick={() => st.runSim()}>▷ {t('common.run')}</Btn>
          <Btn sm primary={showSystem} onClick={() => setShowSystem(!showSystem)}>⚙ {t('arch.system')}</Btn>
          <Btn sm onClick={() => { for (const m of arrangeMoves(st.content, w.nodes)) st.dispatch(m); }}>▦ {t('arch.arrange')}</Btn>
        </div>
        <div className="arch-canvas" ref={canvasRef} style={{ minWidth: Math.max(0, ...w.nodes.map((n) => n.pos.x)) + 110, minHeight: Math.max(0, ...w.nodes.map((n) => n.pos.y)) + 70 }} onPointerMove={onMove} onPointerUp={onUp} onPointerDown={() => { setSel(null); setConnectFrom(null); }}>
          <Edges />
          <Packets />
          {w.nodes.map((n) => <NodeCard key={n.id} node={n} selected={sel === n.id} connecting={connectFrom === n.id} onDown={onNodeDown} />)}
          {connectFrom && <div className="tiny" style={{ position: 'absolute', bottom: 4, left: 4, background: 'var(--paper)', padding: '2px 6px', border: '2px solid var(--line)' }}>{t('arch.hintConnect')}</div>}
        </div>
      </div>
      {selNode ? <Inspector node={selNode} onClose={() => setSel(null)} /> : showSystem && <SystemPanel />}
    </div>
  );
}

function Palette({ onAdd, region, setRegion }: { onAdd: (type: string) => void; region: RegionId; setRegion: (r: RegionId) => void }) {
  const st = useGame();
  const { t, tr } = useT();
  const avail = st.content.components.filter((c) => st.state.unlocks.components.includes(c.type) && c.role !== 'client' && c.role !== 'region');
  const regions = st.state.world.regions;
  return (
    <div style={{ width: 128, borderRight: '2px solid var(--line)', overflow: 'auto', flex: 'none', padding: 4 }}>
      <div className="tiny muted">{t('arch.palette')}</div>
      {regions.length > 1 && (
        <label className="tiny">
          {t('arch.region')}{' '}
          <select aria-label={t('arch.addRegion')} value={region} onChange={(e) => setRegion(e.target.value as RegionId)}>
            {regions.map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}
          </select>
        </label>
      )}
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
    <div data-node={node.id} className={`node ${selected ? 'sel' : ''}`} style={{ left: node.pos.x, top: node.pos.y, outline: connecting ? '2px dashed var(--accent)' : undefined }} onPointerDown={(e) => onDown(e, node.id)}>
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
      <Connections node={node} />
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
    <label className="tiny" title={tr(field.help)} data-config={field.key}>
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

/** Links of the selected node; a link can be removed (adding one goes through the connection rules). */
function Connections({ node }: { node: ArchNode }) {
  const st = useGame();
  const { t } = useT();
  const w = st.state.world;
  const name = (id: string) => w.nodes.find((n) => n.id === id)?.name ?? id;
  const links = w.edges.filter((e) => e.from === node.id || e.to === node.id);
  if (!links.length) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <div className="tiny muted">{t('arch.connections')}</div>
      {links.map((e) => (
        <div key={e.id} className="spread tiny" data-edge={e.id}>
          <span>{e.from === node.id ? `→ ${name(e.to)}` : `← ${name(e.from)}`}</span>
          <button className="btn sm" title={t('arch.disconnect')} onClick={() => st.dispatch({ type: 'edge.disconnect', from: e.from, to: e.to })}>✕</button>
        </div>
      ))}
    </div>
  );
}

/** System-wide view: resilience settings of service/provider calls and which services use which tables. */
function SystemPanel() {
  const st = useGame();
  const { t } = useT();
  const owners = tableOwners(st.state);
  return (
    <div style={{ width: 230, borderLeft: '2px solid var(--line)', overflow: 'auto', flex: 'none', padding: 8 }}>
      <SettingsPanel app="architecture" title={t('arch.resilience')} />
      {Object.keys(owners).length > 0 && (
        <div className="panel">
          <h3>{t('arch.dataOwners')}</h3>
          {Object.entries(owners).map(([table, services]) => (
            <div key={table} className="spread tiny">
              <span className="mono">{table}: {services.join(', ')}</span>
              <PinBtn token={pin.tableOwners(table, services)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Columns by role, left to right in the direction requests travel; one band of rows per region. */
const ROLE_COLUMN: Record<string, number> = { client: 0, dns: 1, cdn: 1, waf: 1, proxy: 2, lb: 2, backend: 3, queue: 4, worker: 4, cache: 4, storage: 4, database: 5, replica: 5, backup: 5, provider: 6, monitoring: 6, logs: 6, region: 6 };

function arrangeMoves(content: import('@prod/engine').ContentBundle, nodes: ArchNode[]): import('@prod/engine').GameAction[] {
  const regions = [...new Set(nodes.map((n) => n.region))];
  const used = new Map<string, number>();
  const bandRows = new Map<string, number>();
  // rows each region band needs = its tallest column
  for (const r of regions) {
    const perCol = new Map<number, number>();
    for (const n of nodes.filter((x) => x.region === r)) {
      const c = ROLE_COLUMN[maybeComponent(content, n.type)?.role ?? 'region'] ?? 6;
      perCol.set(c, (perCol.get(c) ?? 0) + 1);
    }
    bandRows.set(r, Math.max(1, ...perCol.values()));
  }
  const moves: import('@prod/engine').GameAction[] = [];
  for (const n of nodes) {
    const col = ROLE_COLUMN[maybeComponent(content, n.type)?.role ?? 'region'] ?? 6;
    const bandIdx = regions.indexOf(n.region);
    const bandTop = regions.slice(0, bandIdx).reduce((a, r) => a + (bandRows.get(r) ?? 1), 0);
    const key = `${n.region}|${col}`;
    const row = used.get(key) ?? 0;
    used.set(key, row + 1);
    const pos = { x: 20 + col * 112, y: 60 + (bandTop + row) * 66 + bandIdx * 20 };
    if (pos.x !== n.pos.x || pos.y !== n.pos.y) moves.push({ type: 'node.move', id: n.id, pos });
  }
  return moves;
}
