import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { makePool, seedFixture, truncateAll } from '../../test/helpers.js';
import { listOrgs } from './orgs.js';

const db: pg.Pool = makePool();

afterAll(async () => {
  await db.end();
});

beforeEach(async () => {
  await truncateAll(db);
});

describe('listOrgs', () => {
  it('returns empty when there are no orgs', async () => {
    const { rows } = await listOrgs(db);
    expect(rows).toEqual([]);
  });

  it('counts workflows and executions per org, ordered by name', async () => {
    const f = await seedFixture(db);
    const { rows: orgs } = await listOrgs(db);

    expect(orgs).toHaveLength(2);
    const a = orgs.find((o) => o.org_id === f.orgId);
    const b = orgs.find((o) => o.org_id === f.otherOrgId);

    expect(a).toMatchObject({
      name: 'Org A',
      workflow_count: 1,
      execution_count: 1,
    });
    // Org B has events but no workflow row and no execution row.
    expect(b).toMatchObject({
      name: 'Org B',
      workflow_count: 0,
      execution_count: 0,
    });
    expect(orgs.map((o) => o.name)).toEqual(['Org A', 'Org B']);
  });

  it('attaches the SQL it ran to the result', async () => {
    const { query } = await listOrgs(db);
    expect(query.sql).toMatch(/FROM orgs o/);
    expect(query.params).toEqual([]);
  });
});
