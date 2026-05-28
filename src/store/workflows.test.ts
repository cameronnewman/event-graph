import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { uuidv7 } from 'uuidv7';
import { makePool, seedFixture, truncateAll } from '../../test/helpers.js';
import {
  listExecutionsForWorkflow,
  listWorkflows,
} from './workflows.js';

const db: pg.Pool = makePool();

afterAll(async () => {
  await db.end();
});

beforeEach(async () => {
  await truncateAll(db);
});

describe('listWorkflows', () => {
  it('returns workflows for the org with rollups', async () => {
    const f = await seedFixture(db);
    const rows = await listWorkflows(db, f.orgId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workflow_id: f.workflowId,
      name: 'WF1',
      execution_count: 1,
    });
    expect(rows[0]?.last_run_at).toBeInstanceOf(Date);
  });

  it('does not leak workflows from another org', async () => {
    const f = await seedFixture(db);
    expect(await listWorkflows(db, f.otherOrgId)).toEqual([]);
  });
});

describe('listExecutionsForWorkflow', () => {
  it('returns executions newest-first, capped by limit', async () => {
    const f = await seedFixture(db);

    // Add a second, newer execution so the ordering matters.
    const newer = uuidv7();
    await db.query(
      `INSERT INTO executions
         (execution_id, org_id, workflow_id, status, conclusion,
          started_at, completed_at, event_count)
       VALUES ($1, $2, $3, 'completed', 'success',
               now(), now(), 1)`,
      [newer, f.orgId, f.workflowId],
    );

    const rows = await listExecutionsForWorkflow(db, f.orgId, f.workflowId, 10);
    expect(rows.map((r) => r.execution_id)).toEqual([newer, f.executionId]);

    const limited = await listExecutionsForWorkflow(
      db,
      f.orgId,
      f.workflowId,
      1,
    );
    expect(limited).toHaveLength(1);
    expect(limited[0]?.execution_id).toBe(newer);
  });

  it('does not leak executions from another org', async () => {
    const f = await seedFixture(db);
    expect(
      await listExecutionsForWorkflow(db, f.otherOrgId, f.workflowId, 10),
    ).toEqual([]);
  });
});
