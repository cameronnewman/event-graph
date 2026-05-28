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

export type EventRow = {
  id: string;
  parent_id: string | null;
  event_type: string;
  name: string;
  status: string;
  conclusion: string | null;
  payload: unknown;
  metadata: unknown;
  created_at: Date;
};

export type GraphEventRow = EventRow & {
  depth: number;
  iteration_count: number | null;
};

// Loop sibling response — iteration/loop_id live in metadata (no top-level
// duplicates, since the events table generates them from metadata anyway).
export type LoopSiblingRow = EventRow;

export type Cursor = { createdAt: string; id: string };

// Returned alongside store results so routes can echo the SQL + params back to
// the SPA. Routes ship this as `query_sql` / `query_params` for the SQL modal.
export type QueryDescriptor = {
  sql: string;
  params: unknown[];
};

export type StoreResult<T> = {
  rows: T[];
  query: QueryDescriptor;
};
