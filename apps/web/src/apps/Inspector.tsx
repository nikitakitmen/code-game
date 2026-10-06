'use client';
import { useState } from 'react';
import { useGame } from '@/game/store';
import { Btn, Empty, useT, ms } from '@/ui/kit';
import { PinBtn } from '@/ui/Pin';
import { pin } from '@prod/engine';
import type { RequestTrace, StageTrace } from '@prod/engine';

type Layer = 'all' | 'product' | 'application' | 'network' | 'infrastructure';

/** Request Inspector — click a request, read its full path, switch Layer Mode. */
export function InspectorApp({ arg }: { arg?: unknown }) {
  const st = useGame();
  const { t, tr } = useT();
  const traces = st.sim.traces.filter((x) => x.sample !== 'asset');
  const startEp = (arg as { endpointId?: string })?.endpointId;
  const [sel, setSel] = useState<string | null>(
    (startEp && traces.find((x) => x.endpointId === startEp)?.id) ?? traces[0]?.id ?? null,
  );
  const [layer, setLayer] = useState<Layer>('all');
  const trace = traces.find((x) => x.id === sel);

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ width: 200, borderRight: '2px solid var(--line)', overflow: 'auto', flex: 'none' }}>
        {traces.length === 0 && <Empty>{t('mission.needSim')}</Empty>}
        {traces.map((x) => {
          const ep = st.state.world.endpoints.find((e) => e.id === x.endpointId);
          return (
            <div key={x.id} onClick={() => setSel(x.id)} style={{ padding: '3px 6px', cursor: 'pointer', borderBottom: '1px solid var(--line)', background: sel === x.id ? 'var(--accent)' : 'transparent', color: sel === x.id ? 'var(--accent-ink)' : 'inherit' }}>
              <div className="tiny mono">{x.method} {x.path}</div>
              <div className="tiny" style={{ opacity: 0.8 }}>{x.status} · {ms(x.totalMs)} {x.sample === 'error' ? '· ✕' : x.sample === 'slow' ? '· slow' : ''}</div>
            </div>
          );
        })}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        {!trace ? <Empty>{t('inspector.pick')}</Empty> : <TraceView trace={trace} layer={layer} setLayer={setLayer} />}
      </div>
    </div>
  );
}

const LAYERS: Layer[] = ['all', 'product', 'application', 'network', 'infrastructure'];

function TraceView({ trace, layer, setLayer }: { trace: RequestTrace; layer: Layer; setLayer: (l: Layer) => void }) {
  const st = useGame();
  const { t, tr } = useT();
  const ep = st.state.world.endpoints.find((e) => e.id === trace.endpointId);
  const stages = trace.stages.filter((s) => layer === 'all' || s.layer === layer || (layer === 'network' && s.layer === 'network'));
  const maxEnd = Math.max(1, ...trace.stages.map((s) => s.startMs + s.durationMs));
  const active = st.state.campaign.active;

  return (
    <div className="col">
      <div className="spread">
        <h3 style={{ margin: 0 }}>{trace.method} {trace.path}</h3>
        <span className={`tag ${trace.status >= 500 || trace.status === 0 ? 'error' : trace.status >= 400 ? 'warn' : 'ok'}`}>{trace.status || 'ERR'} · {ms(trace.totalMs)}</span>
      </div>
      {ep && <div className="tiny muted">{tr(ep.product)}</div>}
      <div className="row wrap tiny">
        <span className="muted">{t('inspector.layer')}:</span>
        {LAYERS.map((l) => (
          <Btn key={l} sm primary={layer === l} onClick={() => setLayer(l)}>{l === 'all' ? '★' : t('inspector.' + (l === 'network' ? 'networkL' : l))}</Btn>
        ))}
      </div>
      {active && <div className="row tiny"><PinBtn token={pin.request('inspector', trace.endpointId)} /> {t('common.pin')}</div>}
      <div className="panel inset">
        {stages.map((s) => <StageRow key={s.id} s={s} max={maxEnd} />)}
      </div>
      <Headers trace={trace} />
    </div>
  );
}

function StageRow({ s, max }: { s: StageTrace; max: number }) {
  const left = (s.startMs / max) * 100;
  const width = Math.max(1.5, (s.durationMs / max) * 100);
  const color = s.status === 'error' ? 'var(--error)' : s.status === 'warn' ? 'var(--warn)' : 'var(--accent)';
  return (
    <div style={{ marginBottom: 4 }}>
      <div className="spread tiny">
        <span>{s.label}</span>
        <span className="mono">{ms(s.durationMs)}</span>
      </div>
      <div style={{ position: 'relative', height: 8, background: 'var(--paper)', border: '1px solid var(--line)' }}>
        <div style={{ position: 'absolute', left: `${left}%`, width: `${width}%`, top: 0, bottom: 0, background: color }} />
      </div>
      {Object.keys(s.details).length > 0 && (
        <div className="tiny muted">{Object.entries(s.details).map(([k, v]) => `${k}=${v}`).join(' · ')}</div>
      )}
    </div>
  );
}

function Headers({ trace }: { trace: RequestTrace }) {
  const [open, setOpen] = useState(false);
  const { t } = useT();
  return (
    <div>
      <Btn sm onClick={() => setOpen(!open)}>{open ? t('common.less') : 'Headers / body'}</Btn>
      {open && (
        <div className="grid2" style={{ marginTop: 6 }}>
          <div className="panel inset tiny">
            <div className="muted">Request</div>
            {Object.entries(trace.request.headers).map(([k, v]) => <div key={k} className="mono">{k}: {v}</div>)}
          </div>
          <div className="panel inset tiny">
            <div className="muted">Response · {trace.response.sizeKb} KB</div>
            {Object.entries(trace.response.headers).map(([k, v]) => <div key={k} className="mono">{k}: {v}</div>)}
            {trace.response.body && <pre className="mono" style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{trace.response.body.slice(0, 300)}</pre>}
          </div>
        </div>
      )}
    </div>
  );
}
