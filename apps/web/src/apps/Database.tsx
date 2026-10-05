'use client';
import { useState } from 'react';
import { useGame } from '@/game/store';
import { Btn, Empty, Panel, useT, num, ms } from '@/ui/kit';
import { explainQuery, tableIndexes, querySql, type TableDef } from '@prod/engine';

export function DatabaseApp() {
  const st = useGame();
  const { t } = useT();
  const tables = st.state.world.tables;
  const [sel, setSel] = useState<string | null>(tables[0]?.name ?? null);
  const current = tables.find((tb) => tb.name === sel);
  const hasDb = st.state.world.nodes.some((n) => n.type === 'mysql');
  const active = st.state.campaign.active;

  if (!hasDb) return <Empty>No database yet. Add MySQL in Architecture.</Empty>;

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ width: 150, borderRight: '2px solid var(--line)', overflow: 'auto', flex: 'none' }}>
        <div className="tiny muted" style={{ padding: 4 }}>{t('db.tables')}</div>
        {tables.map((tb) => (
          <div key={tb.name} onClick={() => setSel(tb.name)} style={{ padding: '3px 8px', cursor: 'pointer', background: sel === tb.name ? 'var(--accent)' : 'transparent', color: sel === tb.name ? 'var(--accent-ink)' : 'inherit' }}>
            <div className="tiny mono">{tb.name}</div>
            <div className="tiny" style={{ opacity: 0.7 }}>{num(tb.rows)} {t('db.rows')}</div>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        {current ? <TableView table={current} /> : <Empty>—</Empty>}
      </div>
    </div>
  );
}

function TableView({ table }: { table: TableDef }) {
  const st = useGame();
  const { t } = useT();
  const indexes = tableIndexes(table);
  const [cols, setCols] = useState<string[]>([]);
  // endpoints that query this table → EXPLAIN
  const queries = st.state.world.endpoints.flatMap((e) => e.queries.filter((q) => q.table === table.name).map((q) => ({ ep: e.id, q })));

  const toggle = (c: string) => setCols((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));
  const createIndex = () => {
    if (!cols.length) return;
    st.dispatch({ type: 'db.createIndex', table: table.name, columns: cols });
    setCols([]);
  };

  return (
    <div className="col">
      <div className="spread"><h3 style={{ margin: 0 }}>{table.name}</h3><span className="tag">{num(table.rows)} {t('db.rows')}</span></div>
      <Panel title="columns">
        <table>
          <thead><tr><th></th><th>column</th><th>type</th><th>key</th></tr></thead>
          <tbody>
            {table.columns.map((c) => (
              <tr key={c.name}>
                <td><input type="checkbox" checked={cols.includes(c.name)} onChange={() => toggle(c.name)} /></td>
                <td className="mono">{c.name}</td>
                <td className="tiny">{c.type}</td>
                <td className="tiny">{c.pk ? 'PK' : c.unique ? 'UNIQUE' : c.fk ? `FK→${c.fk}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 6 }}>
          <Btn sm disabled={!cols.length} onClick={createIndex}>{t('db.createIndex')} ({cols.join(', ') || '—'})</Btn>
        </div>
      </Panel>
      <Panel title={t('db.indexes')}>
        {indexes.map((i) => (
          <div key={i.name} className="spread tiny">
            <span className="mono">{i.name} ({i.columns.join(', ')}){i.unique ? ' UNIQUE' : ''}</span>
            {!['PRIMARY'].includes(i.name) && table.indexes.some((x) => x.name === i.name) && <Btn sm danger onClick={() => st.dispatch({ type: 'db.dropIndex', table: table.name, name: i.name })}>✕</Btn>}
          </div>
        ))}
      </Panel>
      {queries.length > 0 && (
        <Panel title={t('db.explain')}>
          {queries.map(({ ep, q }) => {
            const ex = explainQuery(q, st.state.world.tables);
            return (
              <div key={ep + q.id} className="panel inset tiny" style={{ cursor: st.state.campaign.active ? 'pointer' : 'default' }}
                onClick={() => st.state.campaign.active && st.dispatch({ type: 'mission.pin', token: { app: 'database', kind: 'explain', key: `${ex.table}:${ex.type}` } })}>
                <div className="mono" style={{ whiteSpace: 'pre-wrap' }}>{ex.sql}</div>
                <div className="spread">
                  <span className={`tag ${ex.type === 'ALL' ? 'error' : ex.type === 'ref' || ex.type === 'range' ? 'warn' : 'ok'}`}>type={ex.type}</span>
                  <span className="mono">{t('db.rowsScanned')}: {num(ex.rows)}</span>
                  <span className="mono">{ms(ex.costMs)}</span>
                </div>
                {ex.extra.length > 0 && <div className="muted">{ex.extra.join(' · ')}</div>}
              </div>
            );
          })}
        </Panel>
      )}
    </div>
  );
}
