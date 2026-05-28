import pg from 'pg';
import { uuidv7 } from 'uuidv7';

export function makePool(): pg.Pool {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL not set — globalSetup did not run');
  }
  return new pg.Pool({ connectionString: url, max: 4 });
}

export async function truncateAll(db: pg.Pool): Promise<void> {
  await db.query('TRUNCATE events, executions, workflows, orgs');
}

export type Fixture = {
  orgId: string;
  otherOrgId: string;
  workflowId: string;
  executionId: string;
  rootId: string;
  loopParentId: string;
  loopChildIter0Id: string;
  loopChildIter1Id: string;
  leafId: string;
};

// Seed a minimal but realistic graph for one execution:
//
//   root (no parent)
//   ├── loopParent (loop_id="L", iter=0)
//   │     ├── loopChild iter=0
//   │     └── loopChild iter=1
//   └── leaf (plain task)
//
// Plus a second org with one event, so cross-org isolation can be asserted.
export async function seedFixture(db: pg.Pool): Promise<Fixture> {
  const orgId = uuidv7();
  const otherOrgId = uuidv7();
  const workflowId = uuidv7();
  const executionId = uuidv7();
  const rootId = uuidv7();
  const loopParentId = uuidv7();
  const loopChildIter0Id = uuidv7();
  const loopChildIter1Id = uuidv7();
  const leafId = uuidv7();

  await db.query('INSERT INTO orgs (org_id, name) VALUES ($1, $2), ($3, $4)', [
    orgId,
    'Org A',
    otherOrgId,
    'Org B',
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

  const insertEvent = `
    INSERT INTO events
      (id, org_id, execution_id, workflow_id, parent_id,
       event_type, name, status, conclusion, payload, metadata, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', 'success', $8, $9, $10)
  `;

  // Use monotonically increasing created_at so ORDER BY created_at is stable.
  const t0 = new Date(Date.now() - 60_000);
  const at = (i: number) => new Date(t0.getTime() + i).toISOString();

  const visiblePayload = JSON.stringify({
    fields: [{ id: 'note', name: 'note', label: 'visible', value: 'hello' }],
  });
  const secretPayload = JSON.stringify({
    fields: [{ id: 'ssn', name: 'ssn', value: '123-45-6789' }],
  });

  await db.query(insertEvent, [
    rootId, orgId, executionId, workflowId, null,
    'execution.start', 'root', visiblePayload, '{}', at(0),
  ]);
  await db.query(insertEvent, [
    loopParentId, orgId, executionId, workflowId, rootId,
    'loop.iteration', 'loop-parent', secretPayload,
    JSON.stringify({ loop_id: 'L', iteration: 0 }), at(1),
  ]);
  await db.query(insertEvent, [
    loopChildIter0Id, orgId, executionId, workflowId, loopParentId,
    'task.run', 'child-iter-0', visiblePayload,
    JSON.stringify({ loop_id: 'C', iteration: 0 }), at(2),
  ]);
  await db.query(insertEvent, [
    loopChildIter1Id, orgId, executionId, workflowId, loopParentId,
    'task.run', 'child-iter-1', visiblePayload,
    JSON.stringify({ loop_id: 'C', iteration: 1 }), at(3),
  ]);
  await db.query(insertEvent, [
    leafId, orgId, executionId, workflowId, rootId,
    'task.run', 'leaf', visiblePayload, '{}', at(4),
  ]);

  // Cross-org noise: same execution_id space, different org_id.
  await db.query(insertEvent, [
    uuidv7(), otherOrgId, executionId, workflowId, null,
    'execution.start', 'other-root', visiblePayload, '{}', at(5),
  ]);

  return {
    orgId,
    otherOrgId,
    workflowId,
    executionId,
    rootId,
    loopParentId,
    loopChildIter0Id,
    loopChildIter1Id,
    leafId,
  };
}
