import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { makePool, seedFixture, truncateAll } from '../../test/helpers.js';
import {
  getEventAnchor,
  getExecutionGraph,
  getLoopSibling,
  listChildren,
  listExecutionTimeline,
} from './events.js';

const db: pg.Pool = makePool();

afterAll(async () => {
  await db.end();
});

beforeEach(async () => {
  await truncateAll(db);
});

describe('listExecutionTimeline', () => {
  it('returns iter-0/no-iteration events in created_at order', async () => {
    const f = await seedFixture(db);
    const { rows } = await listExecutionTimeline(
      db,
      f.orgId,
      f.executionId,
      500,
    );

    // child-iter-1 has iteration=1 and must be filtered out.
    expect(rows.map((r) => r.id)).toEqual([
      f.rootId,
      f.loopParentId,
      f.loopChildIter0Id,
      f.leafId,
    ]);
  });

  it('redacts payload fields that are not labelled visible', async () => {
    const f = await seedFixture(db);
    const { rows } = await listExecutionTimeline(
      db,
      f.orgId,
      f.executionId,
      500,
    );

    const loopParent = rows.find((r) => r.id === f.loopParentId);
    const fields = (loopParent?.payload as { fields: { value: string }[] })
      .fields;
    expect(fields[0]?.value).toBe('[REDACTED]');
  });

  it('does not leak across orgs', async () => {
    const f = await seedFixture(db);
    // Org B only owns the lone "other-root" cross-org noise event in the
    // fixture. It must NOT see anything from Org A's execution.
    const { rows } = await listExecutionTimeline(
      db,
      f.otherOrgId,
      f.executionId,
      500,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('other-root');
  });
});

describe('listChildren', () => {
  it('returns iter-0/no-iteration children of the parent', async () => {
    const f = await seedFixture(db);
    const { rows } = await listChildren(db, {
      orgId: f.orgId,
      executionId: f.executionId,
      parentId: f.loopParentId,
      limit: 500,
    });
    expect(rows.map((r) => r.id)).toEqual([f.loopChildIter0Id]);
  });

  it('honours keyset cursor (returns rows strictly after it)', async () => {
    const f = await seedFixture(db);
    const { rows: all } = await listChildren(db, {
      orgId: f.orgId,
      executionId: f.executionId,
      parentId: f.rootId,
      limit: 500,
    });
    expect(all.map((r) => r.id)).toEqual([f.loopParentId, f.leafId]);

    const { rows: after } = await listChildren(db, {
      orgId: f.orgId,
      executionId: f.executionId,
      parentId: f.rootId,
      limit: 500,
      cursor: {
        createdAt: all[0]!.created_at.toISOString(),
        id: all[0]!.id,
      },
    });
    expect(after.map((r) => r.id)).toEqual([f.leafId]);
  });
});

describe('getEventAnchor', () => {
  it('returns parent_id and loop_id for a loop event', async () => {
    const f = await seedFixture(db);
    const { row } = await getEventAnchor(
      db,
      f.orgId,
      f.executionId,
      f.loopParentId,
    );
    expect(row).toEqual({ parent_id: f.rootId, loop_id: 'L' });
  });

  it('returns null when the event is not visible to the org', async () => {
    const f = await seedFixture(db);
    const { row } = await getEventAnchor(
      db,
      f.otherOrgId,
      f.executionId,
      f.loopParentId,
    );
    expect(row).toBeNull();
  });

  it('returns null loop_id for events outside a loop', async () => {
    const f = await seedFixture(db);
    const { row } = await getEventAnchor(db, f.orgId, f.executionId, f.rootId);
    expect(row?.loop_id).toBeNull();
  });
});

describe('getLoopSibling', () => {
  it('finds the sibling at the requested iteration', async () => {
    const f = await seedFixture(db);
    const { row: sibling } = await getLoopSibling(db, {
      orgId: f.orgId,
      executionId: f.executionId,
      parentId: f.loopParentId,
      loopId: 'C',
      iteration: 1,
    });
    expect(sibling?.id).toBe(f.loopChildIter1Id);
    expect((sibling?.metadata as { iteration?: number }).iteration).toBe(1);
  });

  it('returns null when no such iteration exists', async () => {
    const f = await seedFixture(db);
    const { row: sibling } = await getLoopSibling(db, {
      orgId: f.orgId,
      executionId: f.executionId,
      parentId: f.loopParentId,
      loopId: 'C',
      iteration: 99,
    });
    expect(sibling).toBeNull();
  });
});

describe('getExecutionGraph', () => {
  it('walks the full collapsed graph from execution roots', async () => {
    const f = await seedFixture(db);
    const { rows } = await getExecutionGraph(db, {
      orgId: f.orgId,
      executionId: f.executionId,
      depth: 10,
      limit: 500,
    });

    expect(rows.map((r) => r.id)).toEqual([
      f.rootId,
      f.loopParentId,
      f.leafId,
      f.loopChildIter0Id,
    ]);

    const root = rows.find((r) => r.id === f.rootId);
    expect(root?.depth).toBe(1);
    const child = rows.find((r) => r.id === f.loopChildIter0Id);
    expect(child?.depth).toBe(3);
  });

  it('attaches iteration_count to loop events only', async () => {
    const f = await seedFixture(db);
    const { rows } = await getExecutionGraph(db, {
      orgId: f.orgId,
      executionId: f.executionId,
      depth: 10,
      limit: 500,
    });

    const loopParent = rows.find((r) => r.id === f.loopParentId);
    expect(loopParent?.iteration_count).toBe(1);
    const loopChild = rows.find((r) => r.id === f.loopChildIter0Id);
    expect(loopChild?.iteration_count).toBe(2);
    const leaf = rows.find((r) => r.id === f.leafId);
    expect(leaf?.iteration_count).toBeNull();
  });

  it('respects the depth bound', async () => {
    const f = await seedFixture(db);
    const { rows } = await getExecutionGraph(db, {
      orgId: f.orgId,
      executionId: f.executionId,
      depth: 2,
      limit: 500,
    });

    expect(rows.map((r) => r.id)).toEqual([
      f.rootId,
      f.loopParentId,
      f.leafId,
    ]);
  });

  it('roots at rootEventId when supplied', async () => {
    const f = await seedFixture(db);
    const { rows } = await getExecutionGraph(db, {
      orgId: f.orgId,
      executionId: f.executionId,
      depth: 10,
      limit: 500,
      rootEventId: f.loopParentId,
    });

    expect(rows.map((r) => r.id)).toEqual([f.loopParentId, f.loopChildIter0Id]);
  });
});
