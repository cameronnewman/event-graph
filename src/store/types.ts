import type { QueryResult, QueryResultRow } from 'pg';

// Narrow surface so store functions accept a Pool, a PoolClient, or a test
// double without coupling to pg's full type.
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
}

export type OrgSummary = {
  org_id: string;
  name: string;
  workflow_count: number;
  execution_count: number;
};

export type WorkflowSummary = {
  workflow_id: string;
  name: string;
  created_at: Date;
  execution_count: number;
  last_run_at: Date | null;
};

export type ExecutionSummary = {
  execution_id: string;
  status: string;
  conclusion: string | null;
  started_at: Date;
  completed_at: Date | null;
  event_count: number | null;
};
