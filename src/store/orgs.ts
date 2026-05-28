import type { OrgSummary, Queryable, StoreResult } from './types.js';

const LIST_ORGS_SQL = `SELECT o.org_id,
       o.name,
       COUNT(DISTINCT w.workflow_id)::int AS workflow_count,
       COUNT(DISTINCT e.execution_id)::int AS execution_count
  FROM orgs o
  LEFT JOIN workflows w ON w.org_id = o.org_id
  LEFT JOIN executions e ON e.org_id = o.org_id
 GROUP BY o.org_id, o.name
 ORDER BY o.name`;

export async function listOrgs(
  db: Queryable,
): Promise<StoreResult<OrgSummary>> {
  const { rows } = await db.query<OrgSummary>(LIST_ORGS_SQL);
  return { rows, query: { sql: LIST_ORGS_SQL, params: [] } };
}
