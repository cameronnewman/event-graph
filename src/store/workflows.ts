import type {
  ExecutionSummary,
  Queryable,
  StoreResult,
  WorkflowSummary,
} from './types.js';

const LIST_WORKFLOWS_SQL = `SELECT w.workflow_id, w.name, w.created_at,
       COUNT(e.execution_id)::int AS execution_count,
       MAX(e.started_at)          AS last_run_at
  FROM workflows w
  LEFT JOIN executions e
    ON e.org_id = w.org_id AND e.workflow_id = w.workflow_id
 WHERE w.org_id = $1
 GROUP BY w.workflow_id, w.name, w.created_at
 ORDER BY w.created_at DESC`;

export async function listWorkflows(
  db: Queryable,
  orgId: string,
): Promise<StoreResult<WorkflowSummary>> {
  const params = [orgId];
  const { rows } = await db.query<WorkflowSummary>(LIST_WORKFLOWS_SQL, params);
  return { rows, query: { sql: LIST_WORKFLOWS_SQL, params } };
}

const LIST_EXECUTIONS_SQL = `SELECT execution_id, status, conclusion,
       started_at, completed_at, event_count
  FROM executions
 WHERE org_id = $1
   AND workflow_id = $2
 ORDER BY started_at DESC
 LIMIT $3`;

const GET_EXECUTION_SQL = `SELECT e.execution_id, e.workflow_id, e.status, e.conclusion,
       e.started_at, e.completed_at, e.event_count,
       w.name AS workflow_name
  FROM executions e
  JOIN workflows w
    ON w.org_id = e.org_id AND w.workflow_id = e.workflow_id
 WHERE e.org_id = $1
   AND e.execution_id = $2`;

export type ExecutionDetail = {
  execution_id: string;
  workflow_id: string;
  workflow_name: string;
  status: string;
  conclusion: string | null;
  started_at: Date;
  completed_at: Date | null;
  event_count: number | null;
};

export async function getExecution(
  db: Queryable,
  orgId: string,
  executionId: string,
): Promise<{
  row: ExecutionDetail | null;
  query: { sql: string; params: unknown[] };
}> {
  const params: unknown[] = [orgId, executionId];
  const { rows } = await db.query<ExecutionDetail>(GET_EXECUTION_SQL, params);
  return {
    row: rows[0] ?? null,
    query: { sql: GET_EXECUTION_SQL, params },
  };
}

export async function listExecutionsForWorkflow(
  db: Queryable,
  orgId: string,
  workflowId: string,
  limit: number,
): Promise<StoreResult<ExecutionSummary>> {
  const params: unknown[] = [orgId, workflowId, limit];
  const { rows } = await db.query<ExecutionSummary>(LIST_EXECUTIONS_SQL, params);
  return { rows, query: { sql: LIST_EXECUTIONS_SQL, params } };
}
