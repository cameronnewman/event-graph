// Tiny fetch wrapper. Every read path predicates on org_id, so a single helper
// stamps the header for all callers.

type WithTiming<T> = T & {
  query_time_ms: number;
  query_sql: string;
  query_params: unknown[];
};

export type Org = {
  org_id: string;
  name: string;
  workflow_count: number;
  execution_count: number;
};

export type Workflow = {
  workflow_id: string;
  name: string;
  created_at: string;
  execution_count: number;
  last_run_at: string | null;
};

export type Execution = {
  execution_id: string;
  status: string;
  conclusion: string | null;
  started_at: string;
  completed_at: string | null;
  event_count: number | null;
};

export type ExecutionDetail = Execution & {
  workflow_id: string;
  workflow_name: string;
};

export type PayloadField = {
  id?: string;
  name?: string;
  data_type?: string;
  label?: string;
  value?: unknown;
  redacted?: boolean;
};

export type Payload = {
  fields?: PayloadField[];
  [k: string]: unknown;
};

export type GraphEvent = {
  id: string;
  parent_id: string | null;
  depth: number;
  event_type: string;
  name: string;
  status: string;
  conclusion: string | null;
  payload: Payload;
  metadata: Record<string, unknown> & {
    loop_id?: string;
    iteration?: number;
  };
  created_at: string;
  iteration_count: number | null;
};

async function get<T>(path: string, orgId?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (orgId) headers['x-org-id'] = orgId;
  const r = await fetch(`/api/v1${path}`, { headers });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`GET ${path} → ${r.status}: ${text}`);
  }
  return r.json() as Promise<T>;
}

export const api = {
  orgs: () => get<WithTiming<{ orgs: Org[] }>>('/orgs'),
  workflows: (orgId: string) =>
    get<WithTiming<{ workflows: Workflow[] }>>('/workflows', orgId),
  executions: (orgId: string, workflowId: string) =>
    get<WithTiming<{ executions: Execution[] }>>(
      `/workflows/${workflowId}/executions`,
      orgId,
    ),
  execution: (orgId: string, executionId: string) =>
    get<WithTiming<{ execution: ExecutionDetail }>>(
      `/executions/${executionId}`,
      orgId,
    ),
  graph: (
    orgId: string,
    executionId: string,
    opts: { depth?: number; rootEventId?: string } = {},
  ) => {
    const depth = opts.depth ?? 10;
    const root = opts.rootEventId
      ? `&root_event_id=${encodeURIComponent(opts.rootEventId)}`
      : '';
    return get<WithTiming<{ events: GraphEvent[] }>>(
      `/executions/${executionId}/graph?depth=${depth}&limit=500${root}`,
      orgId,
    );
  },
  iteration: (
    orgId: string,
    executionId: string,
    loopEventId: string,
    iteration: number,
  ) =>
    get<WithTiming<{ event: GraphEvent }>>(
      `/executions/${executionId}/timeline/${loopEventId}/iteration/${iteration}`,
      orgId,
    ),
};
