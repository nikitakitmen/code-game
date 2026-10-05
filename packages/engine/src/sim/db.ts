import type { IndexDef, QueryDef, TableDef } from '../types';

export interface ExplainRow {
  queryId: string;
  table: string;
  /** MySQL access type: const (PK/unique lookup), ref (non-unique index), range, index, ALL (full scan) */
  type: 'const' | 'ref' | 'range' | 'index' | 'ALL';
  possibleKeys: string[];
  key: string | null;
  rows: number;
  matched: number;
  extra: string[];
  /** estimated execution time on an idle 1-core database, ms */
  costMs: number;
  sql: string;
}

/** All indexes of a table, including the implicit PRIMARY and UNIQUE ones. */
export function tableIndexes(table: TableDef): IndexDef[] {
  const out: IndexDef[] = [];
  const pk = table.columns.filter((c) => c.pk).map((c) => c.name);
  if (pk.length) out.push({ name: 'PRIMARY', columns: pk, unique: true });
  for (const c of table.columns) {
    if (c.unique && !c.pk && !table.indexes.some((i) => i.columns[0] === c.name && i.unique)) {
      out.push({ name: `${c.name}_unique`, columns: [c.name], unique: true });
    }
  }
  return out.concat(table.indexes);
}

/** Length of the leftmost prefix of the index covered by the WHERE columns. */
function prefixMatch(index: IndexDef, where: string[]): number {
  let n = 0;
  for (const col of index.columns) {
    if (where.includes(col)) n++;
    else break;
  }
  return n;
}

export function querySql(q: QueryDef): string {
  const where = q.where?.length
    ? ` WHERE ${q.where.map((c) => (q.like ? `${c} LIKE '%?%'` : `${c} = ?`)).join(' AND ')}`
    : '';
  const join = q.join ? ` JOIN ${q.join.table} ON ${q.join.table}.id = ${q.table}.${q.join.on}` : '';
  const order = q.orderBy ? ` ORDER BY ${q.orderBy} DESC` : '';
  const limit = q.limit ? ` LIMIT ${q.limit}` : '';
  const lock = q.lockRows ? ' FOR UPDATE' : '';
  switch (q.op) {
    case 'insert':
      return `INSERT INTO ${q.table} (…) VALUES (…)`;
    case 'update':
      return `UPDATE ${q.table} SET …${where}`;
    case 'delete':
      return `DELETE FROM ${q.table}${where}`;
    default:
      return `SELECT * FROM ${q.table}${join}${where}${order}${limit}${lock}`;
  }
}

/** Per-row costs (ms) — orders of magnitude of an in-memory InnoDB scan / B-tree lookup. */
const SCAN_MS_PER_ROW = 0.0004;
const LOOKUP_MS = 0.05;
const SORT_MS_PER_ROW = 0.0015;
const WRITE_MS = 0.3;
const INDEX_MAINT_MS = 0.08;

export function explainQuery(q: QueryDef, tables: TableDef[]): ExplainRow {
  const table = tables.find((t) => t.name === q.table);
  const sql = querySql(q);
  if (!table) {
    return { queryId: q.id, table: q.table, type: 'ALL', possibleKeys: [], key: null, rows: 0, matched: 0, extra: ['Table missing'], costMs: 0, sql };
  }
  const rows = Math.max(1, table.rows);
  const where = q.where ?? [];
  const indexes = tableIndexes(table);

  if (q.op === 'insert') {
    const costMs = WRITE_MS + INDEX_MAINT_MS * indexes.length;
    return { queryId: q.id, table: q.table, type: 'const', possibleKeys: [], key: null, rows: 1, matched: 1, extra: [], costMs, sql };
  }

  const candidates = q.like
    ? []
    : indexes
        .map((idx) => ({ idx, prefix: prefixMatch(idx, where) }))
        .filter((c) => c.prefix > 0)
        .sort((a, b) => b.prefix - a.prefix || (b.idx.unique ? 1 : 0) - (a.idx.unique ? 1 : 0));
  const best = candidates[0];
  const fullyCovered = best && best.prefix >= where.length;
  const uniqueHit = best && best.idx.unique && best.prefix === best.idx.columns.length && fullyCovered;

  const selectivity = q.match === 'one' ? 1 / rows : (q.selectivity ?? 0.01);
  const matched = Math.max(1, Math.round(rows * selectivity));

  let type: ExplainRow['type'];
  let scanned: number;
  const extra: string[] = [];
  if (!where.length) {
    type = q.orderBy && indexes.some((i) => i.columns[0] === q.orderBy) ? 'index' : 'ALL';
    scanned = type === 'index' && q.limit ? q.limit : rows;
  } else if (uniqueHit) {
    type = 'const';
    scanned = 1;
  } else if (best) {
    type = 'ref';
    // a partial prefix narrows the scan; remaining WHERE columns are filtered row by row
    const narrowed = fullyCovered ? matched : Math.min(rows, Math.round(matched * 20));
    scanned = narrowed;
    if (!fullyCovered) extra.push('Using where');
  } else {
    type = 'ALL';
    scanned = rows;
    extra.push('Using where');
  }

  // ORDER BY: free when the chosen index continues with the order column, otherwise a filesort.
  let sortRows = 0;
  if (q.orderBy && q.op === 'select') {
    const orderedByIndex =
      (best && best.idx.columns[best.prefix] === q.orderBy && fullyCovered) || (type === 'index');
    if (orderedByIndex && q.limit) {
      scanned = Math.min(scanned, q.limit);
    } else if (!orderedByIndex) {
      sortRows = type === 'ALL' ? matched : scanned;
      extra.push('Using filesort');
    }
  }

  let costMs = 0.1 + (type === 'const' ? LOOKUP_MS : type === 'ref' ? LOOKUP_MS + scanned * SCAN_MS_PER_ROW * 2 : scanned * SCAN_MS_PER_ROW);
  costMs += sortRows * SORT_MS_PER_ROW;

  if (q.join) {
    const jt = tables.find((t) => t.name === q.join!.table);
    if (jt) {
      const fkIndexed = tableIndexes(table).some((i) => i.columns[0] === q.join!.on);
      // joined rows are looked up by the joined table's PRIMARY KEY
      const outer = Math.min(scanned, q.limit ?? scanned);
      costMs += outer * LOOKUP_MS * 0.2;
      if (!fkIndexed && q.op === 'select') extra.push(`Join on ${q.join.on}`);
    }
  }

  if (q.op === 'update' || q.op === 'delete') {
    costMs += WRITE_MS + INDEX_MAINT_MS * indexes.length;
  }
  if (q.lockRows) extra.push('FOR UPDATE');
  if (q.like) extra.push("LIKE '%…%' cannot use a B-tree index");

  return {
    queryId: q.id,
    table: q.table,
    type,
    possibleKeys: candidates.map((c) => c.idx.name),
    key: best && type !== 'ALL' ? best.idx.name : type === 'index' ? (indexes.find((i) => i.columns[0] === q.orderBy)?.name ?? null) : null,
    rows: Math.round(scanned),
    matched: q.match === 'one' ? 1 : Math.min(matched, q.limit ?? matched),
    extra,
    costMs,
    sql,
  };
}
