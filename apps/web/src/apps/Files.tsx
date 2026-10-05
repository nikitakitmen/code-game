'use client';
import { useState } from 'react';
import { useGame } from '@/game/store';
import { Btn, Empty, useT } from '@/ui/kit';

export function FilesApp() {
  const st = useGame();
  const { t } = useT();
  const files = st.state.world.files;
  const [sel, setSel] = useState<string | null>(null);
  const current = files.find((f) => f.path === sel);

  // group by directory
  const dirs = Array.from(new Set(files.map((f) => f.path.split('/').slice(0, -1).join('/') || '/'))).sort();

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ width: 260, borderRight: '2px solid var(--line)', overflow: 'auto', flex: 'none' }}>
        {files.length === 0 && <Empty>—</Empty>}
        {dirs.map((d) => (
          <div key={d}>
            <div className="tiny muted" style={{ padding: '2px 4px', background: 'var(--paper-2)' }}>🗀 {d}/</div>
            {files.filter((f) => (f.path.split('/').slice(0, -1).join('/') || '/') === d).map((f) => (
              <div key={f.path} onClick={() => setSel(f.path)} style={{ padding: '2px 10px', cursor: 'pointer', background: sel === f.path ? 'var(--accent)' : 'transparent', color: sel === f.path ? 'var(--accent-ink)' : 'inherit' }}>
                <span className="tiny">{f.secret ? '🔑 ' : icon(f.kind)} {f.path.split('/').pop()}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        {!current ? <Empty>—</Empty> : (
          <div className="col">
            <div className="spread">
              <span className="small mono">{current.path}</span>
              <span className="tiny muted">{current.sizeKb} KB · {current.kind}{current.optimized ? ' · optimized' : ''}</span>
            </div>
            <hr />
            {current.kind === 'image' ? (
              <div style={{ padding: 20, textAlign: 'center' }} className="muted">🖼 {current.sizeKb} KB image {current.optimized ? '(optimized)' : '(unoptimized)'}</div>
            ) : (
              <pre className="panel inset small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{current.content ?? '(binary)'}</pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function icon(kind: string): string {
  return ({ html: '📄', css: '🎨', js: '📜', image: '🖼', config: '⚙', env: '🔑', sql: '🛢', log: '📋', code: '📜', text: '📄', dir: '🗀' } as Record<string, string>)[kind] ?? '📄';
}
