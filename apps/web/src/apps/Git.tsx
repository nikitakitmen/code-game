'use client';
import { useGame } from '@/game/store';
import { Btn, Empty, Panel, useT } from '@/ui/kit';

export function GitApp() {
  const st = useGame();
  const { t } = useT();
  const g = st.state.world.git;
  if (!g.initialized) {
    return (
      <div className="col">
        <Empty>No repository yet.</Empty>
        <Btn primary onClick={() => st.dispatch({ type: 'git.init' })}>git init</Btn>
      </div>
    );
  }
  return (
    <div className="col">
      <Panel title="Branches">
        <div className="row wrap tiny">
          {Object.keys(g.branches).map((b) => <Btn key={b} sm primary={g.current === b} onClick={() => st.dispatch({ type: 'git.checkout', name: b })}>{b}</Btn>)}
        </div>
      </Panel>

      {g.conflict && (
        <Panel title={`⚠ Conflict: ${g.conflict.file}`}>
          <div className="tiny muted">Two branches changed the same line. Choose the correct resolution.</div>
          <div className="grid3" style={{ marginTop: 6 }}>
            {(['ours', 'theirs', 'combined'] as const).map((r) => (
              <div key={r} className="panel inset tiny">
                <div className="muted">{r}</div>
                <code>{g.conflict![r]}</code>
                <Btn sm onClick={() => st.dispatch({ type: 'git.resolve', resolution: r })}>use</Btn>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel title="Branch protection">
        <label className="tiny row"><input type="checkbox" checked={g.protection.requirePr} onChange={(e) => st.dispatch({ type: 'git.protect', requirePr: e.target.checked })} /> require pull request to main</label>
        <label className="tiny row"><input type="checkbox" checked={g.protection.requireChecks} onChange={(e) => st.dispatch({ type: 'git.protect', requireChecks: e.target.checked })} /> require passing CI</label>
        <label className="tiny row"><input type="checkbox" checked={g.protection.requireReview} onChange={(e) => st.dispatch({ type: 'git.protect', requireReview: e.target.checked })} /> require review</label>
      </Panel>

      {g.prs.filter((p) => p.status === 'open').length > 0 && (
        <Panel title="Pull requests">
          {g.prs.filter((p) => p.status === 'open').map((pr) => (
            <div key={pr.id} className="spread tiny" style={{ borderBottom: '1px solid var(--line)', padding: '3px 0' }}>
              <span>#{pr.id} {pr.title} <span className={`tag ${pr.checks === 'failed' ? 'error' : pr.checks === 'passed' ? 'ok' : 'muted'}`}>{pr.checks}</span></span>
              <span className="row">
                <Btn sm disabled={st.state.world.git.protection.requireChecks && pr.checks !== 'passed'} onClick={() => st.dispatch({ type: 'git.prMerge', id: pr.id })}>merge</Btn>
                <Btn sm onClick={() => st.dispatch({ type: 'git.prClose', id: pr.id })}>close</Btn>
              </span>
            </div>
          ))}
        </Panel>
      )}

      <Panel title="git log">
        {g.commits.slice(-12).reverse().map((c) => (
          <div key={c.id} className="tiny mono" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <span className="muted">{c.id}</span> ({c.branch}) {c.message}{c.secret ? ' 🔑' : ''}
            {c.secret && <Btn sm danger onClick={() => st.dispatch({ type: 'git.rewriteHistory' })}>purge history</Btn>}
          </div>
        ))}
      </Panel>
    </div>
  );
}
