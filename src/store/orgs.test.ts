import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { inject } from 'vitest';
import { listOrgs } from './orgs.js';

let db: Pool;

beforeAll(() => {
  db = new Pool({ connectionString: inject('databaseUri') });
});

afterAll(async () => {
  await db.end();
});

async function makeOrg(name: string): Promise<string> {
  const id = uuidv7();
  await db.query('INSERT INTO orgs (org_id, name) VALUES ($1, $2)', [id, name]);
  return id;
}

describe('listOrgs', () => {
  it('returns the rows for the orgs we just created (no truncate)', async () => {
    const nameA = `orgs-test-A-${uuidv7()}`;
    const nameB = `orgs-test-B-${uuidv7()}`;
    const idA = await makeOrg(nameA);
    const idB = await makeOrg(nameB);

    const all = await listOrgs(db);
    const ours = all.filter((o) => o.org_id === idA || o.org_id === idB);
    expect(ours).toHaveLength(2);
    const a = ours.find((o) => o.org_id === idA);
    const b = ours.find((o) => o.org_id === idB);
    expect(a).toMatchObject({
      name: nameA,
      workflow_count: 0,
      execution_count: 0,
    });
    expect(b).toMatchObject({
      name: nameB,
      workflow_count: 0,
      execution_count: 0,
    });
  });

  it('rolls up workflow_count and execution_count per org', async () => {
    const orgId = await makeOrg(`orgs-test-rollup-${uuidv7()}`);
    const workflowId = uuidv7();
    await db.query(
      'INSERT INTO workflows (workflow_id, org_id, name) VALUES ($1, $2, $3)',
      [workflowId, orgId, 'WF1'],
    );
    await db.query(
      `INSERT INTO executions
         (execution_id, org_id, workflow_id, status, conclusion,
          started_at, completed_at, event_count)
       VALUES ($1, $2, $3, 'completed', 'success', now(), now(), 1)`,
      [uuidv7(), orgId, workflowId],
    );

    const all = await listOrgs(db);
    const ours = all.find((o) => o.org_id === orgId);
    expect(ours).toMatchObject({
      workflow_count: 1,
      execution_count: 1,
    });
  });

  it('captures the SQL it ran when given a capture object', async () => {
    const cap: { sql?: string; params?: unknown[] } = {};
    await listOrgs(db, cap);
    expect(cap.sql).toMatch(/FROM orgs o/);
    expect(cap.params).toEqual([]);
  });
});
