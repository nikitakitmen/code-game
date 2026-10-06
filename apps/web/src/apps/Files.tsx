'use client';
import { useState } from 'react';
import { useGame } from '@/game/store';
import { Btn, Empty, useT } from '@/ui/kit';
import { SettingsPanel } from '@/ui/Settings';

const WEB_ROOT = '/var/www/html/';
/** the developer's working copy: files here can be published to the web root */
const WORKSPACE = '/home/dev/';

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
        <SettingsPanel app="files" />
        {!current ? <Empty>—</Empty> : (
          <div className="col">
            <div className="spread">
              <span className="small mono">{current.path}</span>
              <span className="tiny muted">{current.sizeKb} KB · {current.kind}{current.optimized ? ' · optimized' : ''}</span>
            </div>
            <FileActions path={current.path} />
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

/** What you can do with a file: publish it to the web root, shrink it, load it lazily. */
function FileActions({ path }: { path: string }) {
  const st = useGame();
  const { t } = useT();
  const f = st.state.world.files.find((x) => x.path === path);
  if (!f) return null;
  const inRoot = f.path.startsWith(WEB_ROOT);
  const publishable = f.path.startsWith(WORKSPACE) && f.kind !== 'env' && f.kind !== 'dir' && f.kind !== 'text';
  const optimizable = !f.optimized && ['image', 'css', 'js'].includes(f.kind);
  return (
    <div className="row wrap">
      {publishable && <Btn sm primary onClick={() => st.dispatch({ type: 'files.publish', path: f.path })}>{t('files.publish')}</Btn>}
      {optimizable && <Btn sm onClick={() => st.dispatch({ type: 'files.optimize', path: f.path })}>{t('files.optimize')}</Btn>}
      {inRoot && f.kind === 'image' && (
        <label className="tiny row"><input type="checkbox" checked={!!f.lazy} onChange={(e) => st.dispatch({ type: 'files.lazy', path: f.path, lazy: e.target.checked })} /> {t('files.lazy')}</label>
      )}
    </div>
  );
}

function icon(kind: string): string {
  return ({ html: '📄', css: '🎨', js: '📜', image: '🖼', config: '⚙', env: '🔑', sql: '🛢', log: '📋', code: '📜', text: '📄', dir: '🗀' } as Record<string, string>)[kind] ?? '📄';
}
