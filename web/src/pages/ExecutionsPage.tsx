import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type Execution, type Workflow } from '../lib/api';
import { useOrg } from '../lib/OrgContext';
import { QueryInfo } from '../components/QueryInfo';
import { Breadcrumbs } from '../components/Breadcrumbs';

function fmtDuration(start: string, end: string | null): string {
  if (!end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function ConclusionPill({
  conclusion,
  status,
}: {
  conclusion: string | null;
  status: string;
}) {
  const value = conclusion ?? status;
  const tone =
    value === 'success'
      ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
      : value === 'failed'
        ? 'bg-rose-100 text-rose-800 border-rose-300'
        : value === 'completed'
          ? 'bg-slate-100 text-slate-800 border-slate-300'
          : 'bg-amber-100 text-amber-800 border-amber-300';
  return (
    <span
      className={`inline-flex items-center text-[11px] font-semibold uppercase tracking-wider border rounded px-2 py-0.5 ${tone}`}
    >
      {value}
    </span>
  );
}

export function ExecutionsPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const { org } = useOrg();
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [queryMs, setQueryMs] = useState<number | null>(null);
  const [querySql, setQuerySql] = useState<string | null>(null);
  const [queryParams, setQueryParams] = useState<unknown[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!org || !workflowId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      api.executions(org.org_id, workflowId),
      api.workflows(org.org_id),
    ])
      .then(([execRes, wfRes]) => {
        setExecutions(execRes.executions);
        setQueryMs(execRes.query_time_ms);
        setQuerySql(execRes.query_sql);
        setQueryParams(execRes.query_params);
        setWorkflow(
          wfRes.workflows.find((w) => w.workflow_id === workflowId) ?? null,
        );
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [org, workflowId]);

  if (!org) return <p className="text-slate-500">Pick an org to continue.</p>;

  return (
    <div>
      <Breadcrumbs
        crumbs={[
          { label: 'Workflows', to: '/' },
          { label: workflow?.name ?? 'Workflow' },
        ]}
      />
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            {workflow?.name ?? 'Workflow'}
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-1">{workflowId}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>{executions.length} executions</span>
          <QueryInfo
            ms={queryMs}
            sql={querySql}
            params={queryParams}
            label="GET /api/v1/workflows/:id/executions"
          />
        </div>
      </div>

      {loading && <p className="text-slate-500 text-sm">loading…</p>}
      {error && <p className="text-rose-600 text-sm">{error}</p>}

      <div className="border border-slate-200 rounded bg-white shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500 text-xs uppercase tracking-wide bg-slate-50">
            <tr>
              <th className="py-2 px-3 font-medium">Execution</th>
              <th className="py-2 px-3 font-medium">Status</th>
              <th className="py-2 px-3 font-medium">Started</th>
              <th className="py-2 px-3 font-medium">Duration</th>
              <th className="py-2 px-3 font-medium text-right">Events</th>
            </tr>
          </thead>
          <tbody>
            {executions.map((e) => (
              <tr
                key={e.execution_id}
                className="border-t border-slate-100 hover:bg-slate-50"
              >
                <td className="py-2 px-3 font-mono text-xs">
                  <Link
                    to={`/executions/${e.execution_id}`}
                    className="text-sky-700 hover:text-sky-900 font-medium"
                  >
                    {e.execution_id.slice(0, 8)}…
                  </Link>
                </td>
                <td className="py-2 px-3">
                  <ConclusionPill
                    conclusion={e.conclusion}
                    status={e.status}
                  />
                </td>
                <td className="py-2 px-3 text-slate-700">
                  {new Date(e.started_at).toLocaleString()}
                </td>
                <td className="py-2 px-3 text-slate-700">
                  {fmtDuration(e.started_at, e.completed_at)}
                </td>
                <td className="py-2 px-3 text-right font-mono text-slate-700">
                  {e.event_count ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && executions.length === 0 && !error && (
        <p className="text-slate-500 text-sm mt-3">
          No executions for this workflow.
        </p>
      )}
    </div>
  );
}
