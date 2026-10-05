'use client';
import { useGame } from '@/game/store';
import { Panel, useT, money } from '@/ui/kit';
import { revenuePerMonth } from '@prod/engine';

export function FinanceApp() {
  const st = useGame();
  const { t } = useT();
  const cost = st.sim.cost;
  const revenue = revenuePerMonth(st.state, st.sim.summary.availability);
  const net = revenue - cost.total;
  return (
    <div className="col">
      <div className="grid3">
        <Panel><div className="tiny muted">{t('metric.budget')}</div><div className="mono" style={{ fontSize: 18 }}>{money(st.state.budget.cash)}</div></Panel>
        <Panel><div className="tiny muted">{t('metric.revenue')}</div><div className="mono" style={{ fontSize: 18 }}>{money(revenue)}</div></Panel>
        <Panel><div className="tiny muted">{t('metric.cost')}/mo</div><div className="mono" style={{ fontSize: 18 }}>{money(cost.total)}</div></Panel>
      </div>
      <div className={`tag ${net >= 0 ? 'ok' : 'error'}`}>Net/mo: {money(net)}</div>
      <Panel title={t('fin.breakdown')}>
        <table>
          <tbody>
            {cost.breakdown.sort((a, b) => b.amount - a.amount).map((b) => (
              <tr key={b.id}><td>{b.label}</td><td className="mono" style={{ textAlign: 'right' }}>{money(b.amount)}</td></tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="Ledger">
        {st.state.budget.ledger.slice(-8).reverse().map((l, i) => (
          <div key={i} className="spread tiny"><span>{l.key}</span><span className={`mono ${l.amount >= 0 ? '' : 'tag error'}`}>{l.amount >= 0 ? '+' : ''}{money(l.amount)}</span></div>
        ))}
      </Panel>
    </div>
  );
}
