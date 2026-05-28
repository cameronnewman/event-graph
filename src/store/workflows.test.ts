import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { inject } from 'vitest';
import {
  listExecutionsForWorkflow,
  listWorkflows,
} from './workflows.js';

let db: Pool;

beforeAll(() => {
  db = new Pool({ connectionString: inject('databaseUri') });
});

afterAll(async () => {
  await db.end();
});

type Fixture = {
  orgId: string;
  workflowId: string;
  executionId: string;
};

async function makeFixture(): Promise<Fixture> {
  const orgId = uuidv7();
  const workflowId = uuidv7();
  const executionId = uuidv7();
  await db.query('INSERT INTO orgs (org_id, name) VALUES ($1, $2)', [
    orgId,
    `wf-test-${orgId.slice(0, 8)}`,
  ]);
  await db.query(
    'INSERT INTO workflows (workflow_id, org_id, name) VALUES ($1, $2, $3)',
    [workflowId, orgId, 'WF1'],
  );
  await db.query(
    `INSERT INTO executions
       (execution_id, org_id, workflow_id, status, conclusion,
        started_at, completed_at, event_count)
     VALUES ($1, $2, $3, 'completed', 'success',
             now() - interval '1 hour', now(), 5)`,
    [executionId, orgId, workflowId],
  );
  return { orgId, workflowId, executionId };
}

describe('listWorkflows', () => {
  it('returns workflows for the org with rollups', async () => {
    const f = await makeFixture();
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
    await makeFixture();
    const otherOrg = uuidv7();
    expect(await listWorkflows(db, otherOrg)).toEqual([]);
  });
});

describe('listExecutionsForWorkflow', () => {
  it('returns executions newest-first, capped by limit', async () => {
    const f = await makeFixture();

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
    const f = await makeFixture();
    const otherOrg = uuidv7();
    expect(
      await listExecutionsForWorkflow(db, otherOrg, f.workflowId, 10),
    ).toEqual([]);
  });
});
