'use client';
import { useState } from 'react';
import { useGame } from '@/game/store';
import { Btn, Empty, Panel, useT } from '@/ui/kit';

/** The project's (simulated) repository. Nothing here runs real git. */
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
  const hasSecrets = g.commits.some((c) => c.secret);
  return (
    <div className="col">
      <Panel title="Branches">
        <div className="row wrap tiny">
          {Object.keys(g.branches).map((b) => <Btn key={b} sm primary={g.current === b} onClick={() => st.dispatch({ type: 'git.checkout', name: b })}>{b}</Btn>)}
        </div>
        <NewBranch />
      </Panel>

      <Commit />
      <Merge />

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

      <GitIgnore />

      <Panel title="git log">
        {g.commits.slice(-12).reverse().map((c) => (
          <div key={c.id} className="tiny mono" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <span className="muted">{c.id}</span> ({c.branch}) {c.message}{c.secret ? ' 🔑' : ''}
          </div>
        ))}
        {hasSecrets && !g.historyRewritten && (
          <Btn sm danger onClick={() => st.dispatch({ type: 'git.rewriteHistory' })}>{t('git.purge')}</Btn>
        )}
      </Panel>
    </div>
  );
}

function NewBranch() {
  const st = useGame();
  const { t } = useT();
  const [name, setName] = useState('');
  return (
    <div className="row tiny" style={{ marginTop: 4 }}>
      <input aria-label={t('git.branch')} placeholder="feature/…" value={name} onChange={(e) => setName(e.target.value)} />
      <Btn sm disabled={!name.trim()} onClick={() => { if (st.dispatch({ type: 'git.branch', name: name.trim() })) setName(''); }}>{t('git.branch')}</Btn>
    </div>
  );
}

function Commit() {
  const st = useGame();
  const { t } = useT();
  const g = st.state.world.git;
  const pending = Object.keys(st.state.world.deploy.pending);
  const [message, setMessage] = useState('');
  return (
    <Panel title={`${t('git.commit')} → ${g.current}`}>
      {pending.length > 0 && <div className="tiny muted">changes: {pending.join(', ')}</div>}
      <div className="row tiny">
        <input aria-label={t('git.message')} style={{ flex: 1 }} placeholder={t('git.message')} value={message} onChange={(e) => setMessage(e.target.value)} />
        <Btn sm primary disabled={!message.trim()} onClick={() => { if (st.dispatch({ type: 'git.commit', message: message.trim() })) setMessage(''); }}>{t('git.commit')}</Btn>
      </div>
    </Panel>
  );
}

function Merge() {
  const st = useGame();
  const { t } = useT();
  const branches = Object.keys(st.state.world.git.branches);
  const [from, setFrom] = useState(branches.find((b) => b !== 'main') ?? '');
  const [into, setInto] = useState('main');
  if (branches.length < 2) return null;
  return (
    <Panel title={t('git.merge')}>
      <div className="row tiny">
        <select aria-label="from" value={from} onChange={(e) => setFrom(e.target.value)}>{branches.map((b) => <option key={b}>{b}</option>)}</select>
        {t('git.into')}
        <select aria-label="into" value={into} onChange={(e) => setInto(e.target.value)}>{branches.map((b) => <option key={b}>{b}</option>)}</select>
        <Btn sm disabled={!from || from === into} onClick={() => st.dispatch({ type: 'git.merge', from, into })}>{t('git.merge')}</Btn>
      </div>
    </Panel>
  );
}

function GitIgnore() {
  const st = useGame();
  const { t } = useT();
  const entries = st.state.world.git.gitignore;
  const [entry, setEntry] = useState('.env');
  return (
    <Panel title=".gitignore">
      <div className="tiny mono">{entries.length ? entries.join('  ') : '(empty)'}</div>
      <div className="row tiny">
        <input aria-label=".gitignore" value={entry} onChange={(e) => setEntry(e.target.value)} />
        <Btn sm disabled={!entry.trim() || entries.includes(entry.trim())} onClick={() => st.dispatch({ type: 'git.ignore', entry: entry.trim() })}>{t('git.add')}</Btn>
      </div>
    </Panel>
  );
}
