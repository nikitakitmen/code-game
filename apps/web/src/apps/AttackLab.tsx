'use client';
import { useGame } from '@/game/store';
import { Btn, Empty, Panel, useT, Why } from '@/ui/kit';

/** Attack Lab — run scenarios against the fictional game system, see Attack Replay. */
export function AttackLabApp() {
  const st = useGame();
  const { t, tr } = useT();
  const attacks = st.content.attacks.filter((a) => st.state.unlocks.attacks.includes(a.id));
  if (!attacks.length) return <Empty>{t('common.locked')}</Empty>;

  return (
    <div className="col">
      <div className="tiny muted">Run each attack against your own system. Fix the weakness, then re-run to confirm it’s blocked (Attack Replay).</div>
      {attacks.map((a) => {
        const result = st.state.attackResults[a.id];
        const fresh = result && result.seq === st.state.seq;
        return (
          <Panel key={a.id} title={tr(a.name)}>
            <div className="tiny muted">{tr(a.description)}</div>
            <div className="tiny" style={{ margin: '4px 0' }}>Impact: {tr(a.impact)}</div>
            <div className="col">
              {a.steps.map((s, i) => {
                const sr = result?.steps.find((x) => x.id === s.id);
                const icon = !sr ? '·' : sr.status === 'passed' ? '→' : sr.status === 'blocked' ? '🛡' : '·';
                return (
                  <div key={s.id} className="tiny" style={{ opacity: sr?.status === 'skipped' ? 0.4 : 1 }}>
                    {icon} {i + 1}. {tr(s.label)}
                    {sr?.status === 'blocked' && <div className="tag ok" style={{ marginLeft: 16 }}>{tr(s.blockedBy)}</div>}
                    {sr?.status === 'passed' && <div className="tiny muted" style={{ marginLeft: 16 }}>{tr(s.succeeded)}</div>}
                  </div>
                );
              })}
            </div>
            <div className="row" style={{ marginTop: 6 }}>
              <Btn sm danger onClick={() => st.attack(a.id)}>{t('attack.run')}</Btn>
              {result && <span className={`tag ${result.success ? 'error' : 'ok'}`}>{result.success ? t('attack.succeeded') : t('attack.blocked')}{fresh ? '' : ' (stale)'}</span>}
              <Why node={a.knowledge} />
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
