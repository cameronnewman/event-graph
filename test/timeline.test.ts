import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { getTimeline } from '../src/store/events.js';
import { at, insertEvent, makeContext } from './factories.js';

let pool: Pool;
beforeAll(() => {
  pool = new Pool({ connectionString: inject('databaseUri') });
});
afterAll(async () => {
  await pool.end();
});

describe('getTimeline', () => {
  it('returns events ordered by (created_at, id)', async () => {
    const ctx = makeContext();
    const t = new Date('2026-01-01T00:00:00Z');
    await insertEvent(pool, ctx, { name: 'B', createdAt: at(t, 1000) });
    await insertEvent(pool, ctx, { name: 'C', createdAt: at(t, 2000) });
    await insertEvent(pool, ctx, { name: 'A', createdAt: t });

    const events = await getTimeline(pool, {
      orgId: ctx.orgId,
      executionId: ctx.executionId,
      limit: 500,
    });
    expect(events.map((e) => e.name)).toEqual(['A', 'B', 'C']);
  });

  it('collapses loops — excludes events with iteration > 0', async () => {
    const ctx = makeContext();
    await insertEvent(pool, ctx, {
      name: 'iter0',
      metadata: { loop_id: 'L', iteration: 0 },
    });
    await insertEvent(pool, ctx, {
      name: 'iter1',
      metadata: { loop_id: 'L', iteration: 1 },
    });
    await insertEvent(pool, ctx, {
      name: 'iter5',
      metadata: { loop_id: 'L', iteration: 5 },
    });
    await insertEvent(pool, ctx, { name: 'no-iter' });

    const events = await getTimeline(pool, {
      orgId: ctx.orgId,
      executionId: ctx.executionId,
      limit: 500,
    });
    expect(events.map((e) => e.name).sort()).toEqual(['iter0', 'no-iter']);
  });

  it('isolates by org_id even when execution_id collides', async () => {
    const a = makeContext();
    const b = { ...makeContext(), executionId: a.executionId };
    await insertEvent(pool, a, { name: 'a-only' });
    await insertEvent(pool, b, { name: 'b-only' });

    const eventsA = await getTimeline(pool, {
      orgId: a.orgId,
      executionId: a.executionId,
      limit: 500,
    });
    expect(eventsA.map((e) => e.name)).toEqual(['a-only']);
  });

  it('respects the limit', async () => {
    const ctx = makeContext();
    const t = new Date('2026-01-01T00:00:00Z');
    for (let i = 0; i < 10; i++) {
      await insertEvent(pool, ctx, { name: `e${i}`, createdAt: at(t, i) });
    }
    const events = await getTimeline(pool, {
      orgId: ctx.orgId,
      executionId: ctx.executionId,
      limit: 3,
    });
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.name)).toEqual(['e0', 'e1', 'e2']);
  });

  it('returns empty for an unknown execution', async () => {
    const events = await getTimeline(pool, {
      orgId: uuidv7(),
      executionId: uuidv7(),
      limit: 500,
    });
    expect(events).toEqual([]);
  });

  it('applies redaction on the payload', async () => {
    const ctx = makeContext();
    await insertEvent(pool, ctx, {
      payload: {
        fields: [
          { id: 'f1', name: 'public', label: 'visible', value: 'shown' },
          { id: 'f2', name: 'secret', value: 'should-hide' },
        ],
      },
    });
    const [row] = await getTimeline(pool, {
      orgId: ctx.orgId,
      executionId: ctx.executionId,
      limit: 500,
    });
    const fields = (row.payload as { fields: Array<Record<string, unknown>> })
      .fields;
    expect(fields[0]).toMatchObject({ value: 'shown' });
    expect(fields[0].redacted).toBeUndefined();
    expect(fields[1]).toMatchObject({ value: '[REDACTED]', redacted: true });
  });
});
