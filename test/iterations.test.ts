import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { getIterationSibling } from '../src/store/events.js';
import { insertEvent, makeContext } from './factories.js';

let pool: Pool;
beforeAll(() => {
  pool = new Pool({ connectionString: inject('databaseUri') });
});
afterAll(async () => {
  await pool.end();
});

describe('getIterationSibling', () => {
  it('returns the sibling at iteration N under the same parent + loop_id', async () => {
    const ctx = makeContext();
    const parent = await insertEvent(pool, ctx);
    const iter0 = await insertEvent(pool, ctx, {
      parentId: parent,
      eventType: 'loop.iteration',
      metadata: { loop_id: 'L', iteration: 0 },
    });
    await insertEvent(pool, ctx, {
      parentId: parent,
      eventType: 'loop.iteration',
      metadata: { loop_id: 'L', iteration: 1 },
    });
    const iter2Id = await insertEvent(pool, ctx, {
      parentId: parent,
      eventType: 'loop.iteration',
      metadata: { loop_id: 'L', iteration: 2 },
    });

    const result = await getIterationSibling(pool, {
      orgId: ctx.orgId,
      executionId: ctx.executionId,
      eventId: iter0,
      iteration: 2,
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.event.id).toBe(iter2Id);
      expect(result.event.iteration).toBe(2);
      expect(result.event.loop_id).toBe('L');
    }
  });

  it('returns the anchor itself when iteration matches its own', async () => {
    const ctx = makeContext();
    const parent = await insertEvent(pool, ctx);
    const iter0 = await insertEvent(pool, ctx, {
      parentId: parent,
      eventType: 'loop.iteration',
      metadata: { loop_id: 'L', iteration: 0 },
    });
    const result = await getIterationSibling(pool, {
      orgId: ctx.orgId,
      executionId: ctx.executionId,
      eventId: iter0,
      iteration: 0,
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.event.id).toBe(iter0);
  });

  it('returns event_not_found for an unknown id', async () => {
    const ctx = makeContext();
    const result = await getIterationSibling(pool, {
      orgId: ctx.orgId,
      executionId: ctx.executionId,
      eventId: uuidv7(),
      iteration: 0,
    });
    expect(result.kind).toBe('event_not_found');
  });

  it('returns event_not_found when the anchor belongs to a different execution', async () => {
    const ctx = makeContext();
    const iter0 = await insertEvent(pool, ctx, {
      eventType: 'loop.iteration',
      metadata: { loop_id: 'L', iteration: 0 },
    });
    const result = await getIterationSibling(pool, {
      orgId: ctx.orgId,
      executionId: uuidv7(),
      eventId: iter0,
      iteration: 0,
    });
    expect(result.kind).toBe('event_not_found');
  });

  it('returns not_a_loop for non-loop events', async () => {
    const ctx = makeContext();
    const id = await insertEvent(pool, ctx, { eventType: 'task.run' });
    const result = await getIterationSibling(pool, {
      orgId: ctx.orgId,
      executionId: ctx.executionId,
      eventId: id,
      iteration: 0,
    });
    expect(result.kind).toBe('not_a_loop');
  });

  it('returns iteration_not_found for a missing iteration', async () => {
    const ctx = makeContext();
    const parent = await insertEvent(pool, ctx);
    const iter0 = await insertEvent(pool, ctx, {
      parentId: parent,
      eventType: 'loop.iteration',
      metadata: { loop_id: 'L', iteration: 0 },
    });
    const result = await getIterationSibling(pool, {
      orgId: ctx.orgId,
      executionId: ctx.executionId,
      eventId: iter0,
      iteration: 99,
    });
    expect(result.kind).toBe('iteration_not_found');
  });

  it('matches NULL parent_id via IS NOT DISTINCT FROM (top-level loop)', async () => {
    const ctx = makeContext();
    const iter0 = await insertEvent(pool, ctx, {
      parentId: null,
      eventType: 'loop.iteration',
      metadata: { loop_id: 'top', iteration: 0 },
    });
    const iter1Id = await insertEvent(pool, ctx, {
      parentId: null,
      eventType: 'loop.iteration',
      metadata: { loop_id: 'top', iteration: 1 },
    });

    const result = await getIterationSibling(pool, {
      orgId: ctx.orgId,
      executionId: ctx.executionId,
      eventId: iter0,
      iteration: 1,
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.event.id).toBe(iter1Id);
  });

  it('does not cross loop_id boundaries within the same parent', async () => {
    const ctx = makeContext();
    const parent = await insertEvent(pool, ctx);
    const outer0 = await insertEvent(pool, ctx, {
      parentId: parent,
      eventType: 'loop.iteration',
      metadata: { loop_id: 'outer', iteration: 0 },
    });
    // Another loop under the same parent with a different loop_id and an
    // iteration value the outer loop doesn't have. Must NOT be returned.
    await insertEvent(pool, ctx, {
      parentId: parent,
      eventType: 'loop.iteration',
      metadata: { loop_id: 'sibling', iteration: 7 },
    });

    const result = await getIterationSibling(pool, {
      orgId: ctx.orgId,
      executionId: ctx.executionId,
      eventId: outer0,
      iteration: 7,
    });
    expect(result.kind).toBe('iteration_not_found');
  });

  it('applies redaction on the returned sibling', async () => {
    const ctx = makeContext();
    const iter0 = await insertEvent(pool, ctx, {
      eventType: 'loop.iteration',
      metadata: { loop_id: 'L', iteration: 0 },
      payload: {
        fields: [{ id: 'f', name: 'secret', value: 'redact-me' }],
      },
    });
    const result = await getIterationSibling(pool, {
      orgId: ctx.orgId,
      executionId: ctx.executionId,
      eventId: iter0,
      iteration: 0,
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      const fields = (
        result.event.payload as { fields: Array<{ value: string }> }
      ).fields;
      expect(fields[0].value).toBe('[REDACTED]');
    }
  });
});
