import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Pool } from 'pg';
import { getGraph } from '../src/store/events.js';
import { at, insertEvent, makeContext } from './factories.js';

let pool: Pool;
beforeAll(() => {
  pool = new Pool({ connectionString: inject('databaseUri') });
});
afterAll(async () => {
  await pool.end();
});

describe('getGraph', () => {
  it('descends from root and stops at the requested depth', async () => {
    // root -> a -> b -> c. depth=2 should yield root + a.
    const ctx = makeContext();
    const t = new Date('2026-01-01T00:00:00Z');
    const root = await insertEvent(pool, ctx, {
      parentId: null,
      name: 'root',
      createdAt: at(t, 0),
    });
    const a = await insertEvent(pool, ctx, {
      parentId: root,
      name: 'a',
      createdAt: at(t, 1),
    });
    const b = await insertEvent(pool, ctx, {
      parentId: a,
      name: 'b',
      createdAt: at(t, 2),
    });
    await insertEvent(pool, ctx, {
      parentId: b,
      name: 'c',
      createdAt: at(t, 3),
    });

    const d1 = await getGraph(pool, {
      orgId: ctx.orgId,
      executionId: ctx.executionId,
      depth: 1,
      limit: 500,
    });
    expect(d1.map((e) => e.name)).toEqual(['root']);

    const d2 = await getGraph(pool, {
      orgId: ctx.orgId,
      executionId: ctx.executionId,
      depth: 2,
      limit: 500,
    });
    expect(d2.map((e) => e.name)).toEqual(['root', 'a']);

    const d10 = await getGraph(pool, {
      orgId: ctx.orgId,
      executionId: ctx.executionId,
      depth: 10,
      limit: 500,
    });
    expect(d10.map((e) => e.name)).toEqual(['root', 'a', 'b', 'c']);
  });

  it('stamps each row with the correct depth', async () => {
    const ctx = makeContext();
    const t = new Date('2026-01-01T00:00:00Z');
    const root = await insertEvent(pool, ctx, {
      parentId: null,
      name: 'root',
      createdAt: at(t, 0),
    });
    const a = await insertEvent(pool, ctx, {
      parentId: root,
      name: 'a',
      createdAt: at(t, 1),
    });
    await insertEvent(pool, ctx, {
      parentId: a,
      name: 'b',
      createdAt: at(t, 2),
    });

    const rows = await getGraph(pool, {
      orgId: ctx.orgId,
      executionId: ctx.executionId,
      depth: 10,
      limit: 500,
    });
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.depth]));
    expect(byName).toEqual({ root: 1, a: 2, b: 3 });
  });

  it('collapses loops in the descent', async () => {
    const ctx = makeContext();
    const t = new Date('2026-01-01T00:00:00Z');
    const root = await insertEvent(pool, ctx, {
      parentId: null,
      name: 'root',
      createdAt: at(t, 0),
    });
    await insertEvent(pool, ctx, {
      parentId: root,
      name: 'iter0',
      metadata: { loop_id: 'L', iteration: 0 },
      createdAt: at(t, 1),
    });
    await insertEvent(pool, ctx, {
      parentId: root,
      name: 'iter1',
      metadata: { loop_id: 'L', iteration: 1 },
      createdAt: at(t, 2),
    });
    await insertEvent(pool, ctx, {
      parentId: root,
      name: 'iter2',
      metadata: { loop_id: 'L', iteration: 2 },
      createdAt: at(t, 3),
    });

    const rows = await getGraph(pool, {
      orgId: ctx.orgId,
      executionId: ctx.executionId,
      depth: 10,
      limit: 500,
    });
    expect(rows.map((r) => r.name).sort()).toEqual(['iter0', 'root']);
  });

  it('orders rows by (depth, created_at, id)', async () => {
    const ctx = makeContext();
    const t = new Date('2026-01-01T00:00:00Z');
    const root = await insertEvent(pool, ctx, {
      parentId: null,
      name: 'root',
      createdAt: at(t, 0),
    });
    // Two siblings under root; the one with the earlier created_at should
    // appear first within depth=2.
    await insertEvent(pool, ctx, {
      parentId: root,
      name: 'late',
      createdAt: at(t, 100),
    });
    await insertEvent(pool, ctx, {
      parentId: root,
      name: 'early',
      createdAt: at(t, 50),
    });

    const rows = await getGraph(pool, {
      orgId: ctx.orgId,
      executionId: ctx.executionId,
      depth: 10,
      limit: 500,
    });
    expect(rows.map((r) => r.name)).toEqual(['root', 'early', 'late']);
  });

  it('caps total results with limit', async () => {
    const ctx = makeContext();
    const t = new Date('2026-01-01T00:00:00Z');
    const root = await insertEvent(pool, ctx, {
      parentId: null,
      createdAt: at(t, 0),
    });
    for (let i = 0; i < 10; i++) {
      await insertEvent(pool, ctx, {
        parentId: root,
        name: `c${i}`,
        createdAt: at(t, i + 1),
      });
    }
    const rows = await getGraph(pool, {
      orgId: ctx.orgId,
      executionId: ctx.executionId,
      depth: 10,
      limit: 4,
    });
    expect(rows).toHaveLength(4);
  });

  it('applies redaction in the outer SELECT', async () => {
    const ctx = makeContext();
    await insertEvent(pool, ctx, {
      parentId: null,
      payload: { fields: [{ id: 'f', name: 'secret', value: 'redact-me' }] },
    });
    const rows = await getGraph(pool, {
      orgId: ctx.orgId,
      executionId: ctx.executionId,
      depth: 10,
      limit: 500,
    });
    expect(
      (rows[0].payload as { fields: Array<{ value: string }> }).fields[0].value,
    ).toBe('[REDACTED]');
  });
});
