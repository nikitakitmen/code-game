'use client';
import { useGame } from '@/game/store';
import { useWM } from '@/os/windows';
import { useT } from '@/ui/kit';
import type { KnowledgeLevel } from '@prod/engine';

const LEVEL_TONE: Record<KnowledgeLevel, string> = {
  locked: 'var(--muted)',
  discovered: 'var(--paper-2)',
  understood: 'var(--warn)',
  practiced: 'var(--accent)',
  mastered: 'var(--ok)',
};

/** Knowledge Map: the graph of topics with mastery states, grouped by category. */
export function KnowledgeApp() {
  const st = useGame();
  const wm = useWM();
  const { t, tr } = useT();
  const nodes = st.content.knowledge;
  const cats = Array.from(new Set(nodes.map((n) => n.category)));
  const stateOf = (id: string): KnowledgeLevel => (st.state.knowledge[id]?.state ?? 'locked') as KnowledgeLevel;
  const mastered = nodes.filter((n) => stateOf(n.id) !== 'locked').length;

  return (
    <div className="col">
      <div className="spread">
        <h2 style={{ margin: 0 }}>{t('app.knowledge')}</h2>
        <span className="tag">{mastered}/{nodes.length}</span>
      </div>
      <div className="row wrap tiny">
        {(['discovered', 'understood', 'practiced', 'mastered'] as KnowledgeLevel[]).map((l) => (
          <span key={l} className="tag" style={{ background: LEVEL_TONE[l], color: '#fff' }}>{t('know.' + l)}</span>
        ))}
      </div>
      {cats.map((c) => (
        <div key={c} className="panel" style={{ margin: 0, marginTop: 6 }}>
          <div className="tiny muted" style={{ textTransform: 'uppercase' }}>{c}</div>
          <div className="row wrap" style={{ marginTop: 4 }}>
            {nodes.filter((n) => n.category === c).map((n) => {
              const s = stateOf(n.id);
              const locked = s === 'locked';
              return (
                <div
                  key={n.id}
                  onClick={() => !locked && wm.open('encyclopedia', { node: n.id })}
                  title={locked ? t('common.locked') : tr(n.summary)}
                  style={{
                    border: '2px solid var(--line)', padding: '2px 6px', fontSize: 11, cursor: locked ? 'default' : 'pointer',
                    background: LEVEL_TONE[s], color: s === 'locked' || s === 'discovered' ? 'var(--ink)' : '#fff', opacity: locked ? 0.5 : 1,
                  }}
                >
                  {locked ? '🔒 ' : ''}{tr(n.title)}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
