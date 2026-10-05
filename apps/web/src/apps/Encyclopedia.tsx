'use client';
import { useState } from 'react';
import { useGame } from '@/game/store';
import { Panel, useT, Empty } from '@/ui/kit';
import { Diagram } from '@/ui/Diagram';
import type { KnowledgeNodeDef } from '@prod/engine';

export function EncyclopediaApp({ arg }: { arg?: unknown }) {
  const st = useGame();
  const { t, tr } = useT();
  const nodes = st.content.knowledge;
  const unlocked = (id: string) => (st.state.knowledge[id]?.state ?? 'locked') !== 'locked';
  const start = (arg as { node?: string })?.node;
  const [sel, setSel] = useState<string | null>(start ?? nodes.find((n) => unlocked(n.id))?.id ?? null);
  const current = nodes.find((n) => n.id === sel);
  const cats = Array.from(new Set(nodes.map((n) => n.category)));

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ width: 200, borderRight: '2px solid var(--line)', overflow: 'auto', flex: 'none' }}>
        {cats.map((c) => {
          const items = nodes.filter((n) => n.category === c && unlocked(n.id));
          if (!items.length) return null;
          return (
            <div key={c}>
              <div className="tiny muted" style={{ padding: '2px 4px', background: 'var(--paper-2)', textTransform: 'uppercase' }}>{c}</div>
              {items.map((n) => (
                <div key={n.id} className="tiny" onClick={() => setSel(n.id)} style={{ padding: '2px 8px', cursor: 'pointer', background: sel === n.id ? 'var(--accent)' : 'transparent', color: sel === n.id ? 'var(--accent-ink)' : 'inherit' }}>
                  {tr(n.title)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 10 }}>
        {current ? <Article node={current} /> : <Empty>{t('common.locked')}</Empty>}
      </div>
    </div>
  );
}

function Article({ node }: { node: KnowledgeNodeDef }) {
  const st = useGame();
  const { t, tr } = useT();
  const [deep, setDeep] = useState(false);
  const a = node.article;
  const state = st.state.knowledge[node.id]?.state ?? 'discovered';
  return (
    <div className="col">
      <div className="spread">
        <h2 style={{ margin: 0 }}>{tr(node.title)}</h2>
        <span className="tag">{t('know.' + state)}</span>
      </div>
      <div className="small"><b>{t('mission.explain')}:</b> {tr(a.what)}</div>
      <div className="small"><b>{t('mission.whyNow')}:</b> {tr(a.why)}</div>
      {a.diagram && <Diagram def={a.diagram} />}
      {a.before && a.after && (
        <div className="grid2">
          <Panel title={t('common.before')}><div className="small">{tr(a.before)}</div></Panel>
          <Panel title={t('common.after')}><div className="small">{tr(a.after)}</div></Panel>
        </div>
      )}
      <div className="small"><b>{t('mission.limits')}:</b> {tr(a.limits)}</div>
      {deep && (
        <>
          {a.production && <div className="small"><b>In production:</b> {tr(a.production)}</div>}
          {a.underTheHood && <Panel inset><div className="small">{tr(a.underTheHood)}</div></Panel>}
        </>
      )}
      {(a.production || a.underTheHood) && <button className="btn sm" onClick={() => setDeep(!deep)}>{deep ? t('common.less') : t('common.more')}</button>}
    </div>
  );
}
