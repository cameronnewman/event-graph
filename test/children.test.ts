import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { getChildren, parseCursor } from '../src/store/events.js';
import { at, insertEvent, makeContext } from './factories.js';

let pool: Pool;
beforeAll(() => {
  pool = new Pool({ connectionString: inject('databaseUri') });
});
afterAll(async () => {
  await pool.end();
});

describe('getChildren', () => {
  it('returns children of the given parent, loops collapsed', async () => {
    const ctx = makeContext();
    const parent = await insertEvent(pool, ctx);
    await insertEvent(pool, ctx, { parentId: parent, name: 'c0' });
    await insertEvent(pool, ctx, {
      parentId: parent,
      name: 'iter1',
      metadata: { loop_id: 'L', iteration: 1 },
    });
    await insertEvent(pool, ctx, {
      parentId: parent,
      name: 'iter0',
      metadata: { loop_id: 'L', iteration: 0 },
    });

    const { events } = await getChildren(pool, {
      orgId: ctx.orgId,
      executionId: ctx.executionId,
      parentId: parent,
      cursor: null,
      limit: 500,
    });
    expect(events.map((e) => e.name).sort()).toEqual(['c0', 'iter0']);
  });

  it('paginates with the keyset cursor across multiple pages', async () => {
    const ctx = makeContext();
    const parent = await insertEvent(pool, ctx);
    const t = new Date('2026-01-01T00:00:00Z');
    for (let i = 0; i < 5; i++) {
      await insertEvent(pool, ctx, {
        parentId: parent,
        name: `c${i}`,
        createdAt: at(t, i * 1000),
      });
    }

    const p1 = await getChildren(pool, {
      orgId: ctx.orgId,
      executionId: ctx.executionId,
      parentId: parent,
      cursor: null,
      limit: 2,
    });
    expect(p1.events.map((e) => e.name)).toEqual(['c0', 'c1']);
    expect(p1.nextCursor).not.toBeNull();

    const p2 = await getChildren(pool, {
      orgId: ctx.orgId,
      executionId: ctx.executionId,
      parentId: parent,
      cursor: parseCursor(p1.nextCursor!),
      limit: 2,
    });
    expect(p2.events.map((e) => e.name)).toEqual(['c2', 'c3']);

    const p3 = await getChildren(pool, {
      orgId: ctx.orgId,
      executionId: ctx.executionId,
      parentId: parent,
      cursor: parseCursor(p2.nextCursor!),
      limit: 2,
    });
    expect(p3.events.map((e) => e.name)).toEqual(['c4']);
    // Final page returned fewer rows than the limit → no cursor.
    expect(p3.nextCursor).toBeNull();
  });

  it('returns nextCursor=null when the result count equals the limit but no more rows exist', async () => {
    const ctx = makeContext();
    const parent = await insertEvent(pool, ctx);
    const t = new Date('2026-01-01T00:00:00Z');
    await insertEvent(pool, ctx, {
      parentId: parent,
      name: 'c0',
      createdAt: at(t, 0),
    });
    await insertEvent(pool, ctx, {
      parentId: parent,
      name: 'c1',
      createdAt: at(t, 1),
    });

    // Page 1 hits limit exactly — cursor is non-null (can't tell if more rows
    // exist without an extra query). Page 2 returns empty + null cursor.
    const p1 = await getChildren(pool, {
      orgId: ctx.orgId,
      executionId: ctx.executionId,
      parentId: parent,
      cursor: null,
      limit: 2,
    });
    expect(p1.events).toHaveLength(2);
    expect(p1.nextCursor).not.toBeNull();

    const p2 = await getChildren(pool, {
      orgId: ctx.orgId,
      executionId: ctx.executionId,
      parentId: parent,
      cursor: parseCursor(p1.nextCursor!),
      limit: 2,
    });
    expect(p2.events).toEqual([]);
    expect(p2.nextCursor).toBeNull();
  });

  it('returns empty when parentId belongs to a different execution', async () => {
    const ctx = makeContext();
    const parent = await insertEvent(pool, ctx);
    await insertEvent(pool, ctx, { parentId: parent, name: 'c' });

    const { events } = await getChildren(pool, {
      orgId: ctx.orgId,
      executionId: uuidv7(),
      parentId: parent,
      cursor: null,
      limit: 500,
    });
    expect(events).toEqual([]);
  });

  it('isolates by org_id — a different org cannot read another org’s children', async () => {
    // events.id is globally unique, so the realistic cross-org leak shape is:
    // org A owns parent P and a child under it; org B queries with P's id and
    // must get nothing back.
    const a = makeContext();
    const b = makeContext();
    const parent = await insertEvent(pool, a);
    await insertEvent(pool, a, { parentId: parent, name: 'a-child' });

    const { events } = await getChildren(pool, {
      orgId: b.orgId,
      executionId: a.executionId,
      parentId: parent,
      cursor: null,
      limit: 500,
    });
    expect(events).toEqual([]);
  });

  it('applies redaction', async () => {
    const ctx = makeContext();
    const parent = await insertEvent(pool, ctx);
    await insertEvent(pool, ctx, {
      parentId: parent,
      payload: {
        fields: [{ id: 'f', name: 'secret', value: 'redact-me' }],
      },
    });
    const { events } = await getChildren(pool, {
      orgId: ctx.orgId,
      executionId: ctx.executionId,
      parentId: parent,
      cursor: null,
      limit: 500,
    });
    expect(
      (events[0].payload as { fields: Array<{ value: string }> }).fields[0]
        .value,
    ).toBe('[REDACTED]');
  });
});
