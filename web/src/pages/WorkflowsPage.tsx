import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Workflow } from '../lib/api';
import { useOrg } from '../lib/OrgContext';
import { QueryInfo } from '../components/QueryInfo';
import { Breadcrumbs } from '../components/Breadcrumbs';

export function WorkflowsPage() {
  const { org } = useOrg();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [queryMs, setQueryMs] = useState<number | null>(null);
  const [querySql, setQuerySql] = useState<string | null>(null);
  const [queryParams, setQueryParams] = useState<unknown[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!org) return;
    setLoading(true);
    setError(null);
    api
      .workflows(org.org_id)
      .then((r) => {
        setWorkflows(r.workflows);
        setQueryMs(r.query_time_ms);
        setQuerySql(r.query_sql);
        setQueryParams(r.query_params);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [org]);

  if (!org) return <p className="text-slate-500">Pick an org to continue.</p>;

  return (
    <div>
      <Breadcrumbs crumbs={[{ label: 'Workflows' }]} />
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h1 className="text-xl font-semibold text-slate-900">Workflows</h1>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>{workflows.length} total</span>
          <QueryInfo
            ms={queryMs}
            sql={querySql}
            params={queryParams}
            label="GET /api/v1/workflows"
          />
        </div>
      </div>
      {loading && <p className="text-slate-500 text-sm">loading…</p>}
      {error && <p className="text-rose-600 text-sm">{error}</p>}
      <ul className="grid gap-2">
        {workflows.map((w) => (
          <li key={w.workflow_id}>
            <Link
              to={`/workflows/${w.workflow_id}`}
              className="block rounded border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 px-4 py-3 transition shadow-sm"
            >
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-medium text-slate-900">{w.name}</span>
                <span className="text-xs text-slate-500 font-mono">
                  {w.execution_count} executions
                </span>
              </div>
              <div className="text-xs text-slate-400 font-mono mt-1">
                {w.workflow_id}
                {w.last_run_at && (
                  <span className="ml-2 text-slate-500">
                    last run {new Date(w.last_run_at).toLocaleString()}
                  </span>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {!loading && workflows.length === 0 && !error && (
        <p className="text-slate-500 text-sm">No workflows yet.</p>
      )}
    </div>
  );
}
