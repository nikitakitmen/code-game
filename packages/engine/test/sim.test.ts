import { describe, it, expect } from 'vitest';
import { queueFactor, overloadErrors, ttlHitRatio, staleFraction, explainQuery, canConnect, simulate, newGame, reduce } from '../src/index';
import type { ContentBundle, TableDef } from '../src/index';
import { loadContent } from '@prod/content';

const content = loadContent();

describe('simulation formulas', () => {
  it('queueing factor grows with utilisation and is capped', () => {
    expect(queueFactor(0)).toBeCloseTo(1, 5);
    expect(queueFactor(0.5)).toBeCloseTo(2, 5);
    expect(queueFactor(0.9)).toBeCloseTo(10, 5);
    expect(queueFactor(0.999)).toBeLessThanOrEqual(35);
    expect(queueFactor(2)).toBeLessThanOrEqual(35);
  });

  it('overload errors appear only past capacity', () => {
    expect(overloadErrors(0.9)).toBe(0);
    expect(overloadErrors(1)).toBe(0);
    expect(overloadErrors(2)).toBeCloseTo(0.5, 5);
    expect(overloadErrors(4)).toBeCloseTo(0.75, 5);
  });

  it('TTL hit ratio rises with rate and TTL', () => {
    expect(ttlHitRatio(0, 60)).toBe(0);
    expect(ttlHitRatio(1, 1)).toBeCloseTo(0.5, 5);
    expect(ttlHitRatio(10, 60)).toBeGreaterThan(0.99);
  });

  it('stale fraction grows with write rate and TTL', () => {
    expect(staleFraction(0, 60)).toBe(0);
    expect(staleFraction(0.01, 60)).toBeGreaterThan(0);
    expect(staleFraction(1, 60)).toBeGreaterThan(staleFraction(0.01, 60));
  });
});

describe('EXPLAIN / rows scanned', () => {
  const tables: TableDef[] = [
    {
      name: 'products',
      rows: 400000,
      rowKb: 1,
      columns: [
        { name: 'id', type: 'bigint', pk: true },
        { name: 'category_id', type: 'bigint' },
        { name: 'name', type: 'varchar' },
        { name: 'created_at', type: 'datetime' },
      ],
      indexes: [],
    },
  ];

  it('a WHERE with no index is a full scan', () => {
    const ex = explainQuery({ id: 'q', table: 'products', op: 'select', where: ['category_id'], match: 'many', selectivity: 0.04 }, tables);
    expect(ex.type).toBe('ALL');
    expect(ex.rows).toBe(400000);
  });

  it('a PK lookup is const and touches one row', () => {
    const ex = explainQuery({ id: 'q', table: 'products', op: 'select', where: ['id'], match: 'one' }, tables);
    expect(ex.type).toBe('const');
    expect(ex.rows).toBe(1);
  });

  it('a composite index turns the scan into a bounded ref lookup', () => {
    const withIdx: TableDef[] = [{ ...tables[0], indexes: [{ name: 'idx', columns: ['category_id', 'created_at'] }] }];
    const ex = explainQuery({ id: 'q', table: 'products', op: 'select', where: ['category_id'], orderBy: 'created_at', limit: 24, match: 'many', selectivity: 0.04 }, withIdx);
    expect(ex.type).toBe('ref');
    expect(ex.rows).toBeLessThan(400000);
    expect(ex.extra).not.toContain('Using filesort');
  });

  it("LIKE '%x%' cannot use an index", () => {
    const withIdx: TableDef[] = [{ ...tables[0], indexes: [{ name: 'n', columns: ['name'] }] }];
    const ex = explainQuery({ id: 'q', table: 'products', op: 'select', where: ['name'], like: true, match: 'many', selectivity: 0.02 }, withIdx);
    expect(ex.type).toBe('ALL');
  });
});

describe('connection rules', () => {
  it('blocks impossible links and allows bad-but-possible ones', () => {
    const s = newGame(content, 1);
    const w = s.world;
    w.nodes.push({ id: 'db1', type: 'mysql', name: 'db', region: 'eu', pos: { x: 7, y: 7 }, size: 's', config: {}, ip: '10.0.0.5', ports: [3306], publicPorts: [], createdAt: 0 });
    w.nodes.push({ id: 'be1', type: 'backend', name: 'app', region: 'eu', pos: { x: 6, y: 5 }, size: 's', config: {}, ip: '10.0.0.6', ports: [8000], publicPorts: [], createdAt: 0 });
    expect(canConnect(content, w, 'db1', 'users').ok).toBe(false); // db → client impossible
    expect(canConnect(content, w, 'be1', 'db1').ok).toBe(true); // backend → db fine
    expect(canConnect(content, w, 'users', 'be1').ok).toBe(true); // client → backend: bad but possible
    expect(canConnect(content, w, 'be1', 'be1').ok).toBe(false); // self
  });
});

describe('simulation is deterministic and reacts to the world', () => {
  it('identical inputs give byte-identical results', () => {
    const s = newGame(content, 99);
    const a = simulate(s, content);
    const b = simulate(s, content);
    expect(JSON.stringify(a.summary)).toBe(JSON.stringify(b.summary));
    expect(JSON.stringify(a.endpoints)).toBe(JSON.stringify(b.endpoints));
  });

  it('a bigger backend lowers utilisation under the same load', () => {
    const base = newGame(content, 3);
    base.world.traffic.baseRps = 300;
    base.world.endpoints.push({ id: 'x', method: 'GET', path: '/x', product: { en: '', ru: '' }, target: 'backend', weight: 10, cpuMs: 20, responseKb: 2, auth: 'none', queries: [] });
    base.world.nodes.push({ id: 'be', type: 'backend', name: 'app', region: 'eu', pos: { x: 6, y: 4 }, size: 's', config: { port: 8000 }, ip: '10.0.0.6', ports: [8000], publicPorts: [], createdAt: 0 });
    base.world.edges.push({ id: 'web1>be', from: 'web1', to: 'be' });
    const small = simulate(base, content);
    const big = JSON.parse(JSON.stringify(base));
    big.world.nodes.find((n: { id: string }) => n.id === 'be').size = '2xl';
    const bigSim = simulate(big, content);
    expect(bigSim.nodes['be'].utilMax).toBeLessThan(small.nodes['be'].utilMax);
  });
});

describe('reducer', () => {
  it('rejects a locked component and records nothing', () => {
    const s = newGame(content, 1);
    const r = reduce(s, { type: 'node.add', nodeType: 'mysql' }, content);
    expect(r.ok).toBe(false);
    expect(r.state).toBe(s);
  });

  it('adds an unlocked component and advances the sequence', () => {
    const s = newGame(content, 1);
    s.unlocks.components.push('backend');
    const r = reduce(s, { type: 'node.add', nodeType: 'backend' }, content);
    expect(r.ok).toBe(true);
    expect(r.state.world.nodes.some((n) => n.type === 'backend')).toBe(true);
    expect(r.state.seq).toBe(s.seq + 1);
  });
});
