'use client';
import { useState } from 'react';
import { useGame } from '@/game/store';
import { api } from '@/game/api';
import { Btn, useT, ms, pct, money } from '@/ui/kit';
import type { CompletionReport, MetricsSnapshot } from '@prod/engine';

export function Modals() {
  const modal = useGame((s) => s.modal);
  if (!modal) return null;
  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && useGame.getState().closeModal()}>
      {modal.kind === 'company' && <CompanyModal />}
      {modal.kind === 'auth' && <AuthModal />}
      {modal.kind === 'guestConflict' && <ConflictModal />}
      {modal.kind === 'debrief' && modal.report && <DebriefModal report={modal.report} />}
    </div>
  );
}

function CompanyModal() {
  const st = useGame();
  const { t } = useT();
  const [name, setName] = useState('');
  const submit = () => {
    if (name.trim().length < 2) return;
    st.dispatch({ type: 'company.setName', name: name.trim() });
    st.closeModal();
    void st.save();
  };
  return (
    <div className="modal">
      <div className="modal-title">PROD</div>
      <div className="modal-body col">
        <h2>{t('company.prompt')}</h2>
        <input type="text" autoFocus value={name} placeholder={t('company.placeholder')} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        <div className="row"><Btn primary onClick={submit} disabled={name.trim().length < 2}>{t('company.confirm')}</Btn></div>
      </div>
    </div>
  );
}

function AuthModal() {
  const st = useGame();
  const { t, locale } = useT();
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const submit = async () => {
    setErr('');
    try {
      if (mode === 'register') {
        await api.register(email, password, locale);
        useGame.setState({ authed: true });
        // the guest save now lives in the account profile under its own revision: adopt it before saving
        await st.syncFromServer();
        await st.save();
        st.closeModal();
      } else {
        const r = await api.login(email, password);
        useGame.setState({ authed: true });
        if (r.guest_conflict) st.openModal({ kind: 'guestConflict' });
        else {
          await st.syncFromServer();
          st.closeModal();
        }
      }
    } catch (e) {
      setErr((e as Error).message?.includes('422') ? (mode === 'register' ? 'Email taken or weak password.' : 'Invalid email or password.') : 'Could not reach the server.');
    }
  };
  return (
    <div className="modal">
      <div className="modal-title">{t('menu.account')}</div>
      <div className="modal-body col">
        <div className="row">
          <Btn sm primary={mode === 'register'} onClick={() => setMode('register')}>{t('auth.register')}</Btn>
          <Btn sm primary={mode === 'login'} onClick={() => setMode('login')}>{t('auth.haveAccount')}</Btn>
        </div>
        <label className="tiny muted">{t('auth.email')}</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="tiny muted">{t('auth.password')}</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        {err && <div className="tag error">{err}</div>}
        <div className="row">
          <Btn primary onClick={submit}>{mode === 'register' ? t('auth.register') : t('menu.login')}</Btn>
          <Btn onClick={() => st.closeModal()}>{t('auth.keepGuest')}</Btn>
        </div>
      </div>
    </div>
  );
}

function ConflictModal() {
  const st = useGame();
  const { t } = useT();
  const resolve = async (strategy: 'keep_account' | 'use_guest') => {
    await api.mergeGuest(strategy);
    await st.syncFromServer();
    st.closeModal();
  };
  return (
    <div className="modal">
      <div className="modal-title">{t('menu.account')}</div>
      <div className="modal-body col">
        <div>{t('auth.conflict')}</div>
        <div className="row">
          <Btn primary onClick={() => resolve('keep_account')}>{t('auth.keepAccount')}</Btn>
          <Btn onClick={() => resolve('use_guest')}>{t('auth.useGuest')}</Btn>
        </div>
      </div>
    </div>
  );
}

function DebriefModal({ report }: { report: CompletionReport }) {
  const st = useGame();
  const { t, tr } = useT();
  const mission = st.content.missions[report.summary.id];
  const [deep, setDeep] = useState(false);
  if (!mission) return null;
  const exp = mission.explanation;
  const before = report.summary.before;
  const after = report.summary.after;
  return (
    <div className="modal" style={{ maxWidth: 640 }}>
      <div className="modal-title">✓ {tr(mission.title)}</div>
      <div className="modal-body col">
        {report.solution && <div className="tag" style={{ alignSelf: 'flex-start' }}>{tr(report.solution.text)}</div>}
        {before && after && <BeforeAfter before={before} after={after} />}
        <h3>{t('mission.explain')}</h3>
        <div className="small">{tr(exp.what)}</div>
        <div className="small"><b>{t('mission.whyNow')}:</b> {tr(exp.whyNow)}</div>
        <div className="small"><b>{t('mission.limits')}:</b> {tr(exp.limits)}</div>
        {deep && exp.underTheHood && <div className="panel inset small">{tr(exp.underTheHood)}</div>}
        {deep && exp.production && <div className="small"><b>In production:</b> {tr(exp.production)}</div>}
        {(exp.underTheHood || exp.production) && <Btn sm onClick={() => setDeep(!deep)}>{deep ? t('common.less') : t('common.more')}</Btn>}
        {report.knowledge.length > 0 && (
          <div className="tiny muted">{report.knowledge.map((k) => `${k.id} → ${t('know.' + k.level)}`).join(' · ')}</div>
        )}
        <div className="row spread">
          <span className="tiny muted">{report.cashDelta >= 0 ? '+' : ''}{money(report.cashDelta)}</span>
          <Btn primary onClick={() => { st.closeModal(); const next = st.state.campaign.currentMissionId; if (next) st.startCurrentMission(); }}>{t('common.next')} ▶</Btn>
        </div>
      </div>
    </div>
  );
}

function BeforeAfter({ before, after }: { before: MetricsSnapshot; after: MetricsSnapshot }) {
  const { t } = useT();
  const rows: [string, string, string][] = [
    [t('metric.p95'), ms(before.p95), ms(after.p95)],
    [t('metric.errorRate'), pct(before.errorRate, 2), pct(after.errorRate, 2)],
    [t('metric.availability'), pct(before.availability, 2), pct(after.availability, 2)],
    [t('metric.cost') + '/mo', money(before.costPerMonth), money(after.costPerMonth)],
    [t('metric.debt'), String(before.debt), String(after.debt)],
  ];
  return (
    <table>
      <thead><tr><th></th><th>{t('common.before')}</th><th>{t('common.after')}</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r[0]}><td>{r[0]}</td><td className="mono">{r[1]}</td><td className="mono">{r[2]}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
