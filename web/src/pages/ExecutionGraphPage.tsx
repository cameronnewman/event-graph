import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type ExecutionDetail, type GraphEvent } from '../lib/api';
import { useOrg } from '../lib/OrgContext';
import { EventTree } from '../components/EventTree';
import { QueryInfo } from '../components/QueryInfo';
import { Breadcrumbs } from '../components/Breadcrumbs';

const GRAPH_LIMIT = 500;

function JsonPane({
  selected,
  all,
}: {
  selected: GraphEvent | null;
  all: GraphEvent[];
}) {
  const text = useMemo(() => {
    if (selected) return JSON.stringify(selected, null, 2);
    return JSON.stringify({ events: all }, null, 2);
  }, [selected, all]);

  return (
    <div className="sticky top-[68px] border border-slate-200 rounded bg-white overflow-hidden flex flex-col max-h-[calc(100vh-100px)] shadow-sm">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-slate-50">
        <div className="text-xs text-slate-600">
          {selected ? (
            <>
              <span className="text-slate-400">selected event</span>{' '}
              <span className="font-mono text-slate-800">
                {selected.id.slice(0, 8)}…
              </span>
            </>
          ) : (
            <>
              <span className="text-slate-400">full response</span>{' '}
              <span className="text-slate-800">({all.length} events)</span>
            </>
          )}
        </div>
        <button
          className="text-[11px] text-slate-500 hover:text-slate-900"
          onClick={() => navigator.clipboard.writeText(text)}
        >
          copy
        </button>
      </div>
      <pre className="text-[11px] font-mono text-slate-800 p-3 overflow-auto leading-relaxed">
        {text}
      </pre>
    </div>
  );
}

export function ExecutionGraphPage() {
  const { executionId } = useParams<{ executionId: string }>();
  const { org } = useOrg();
  const [events, setEvents] = useState<GraphEvent[]>([]);
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [depth, setDepth] = useState(10);
  const [queryMs, setQueryMs] = useState<number | null>(null);
  const [querySql, setQuerySql] = useState<string | null>(null);
  const [queryParams, setQueryParams] = useState<unknown[] | null>(null);
  const [selected, setSelected] = useState<GraphEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!org || !executionId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      api.graph(org.org_id, executionId, { depth }),
      api.execution(org.org_id, executionId),
    ])
      .then(([graphRes, execRes]) => {
        setEvents(graphRes.events);
        setQueryMs(graphRes.query_time_ms);
        setQuerySql(graphRes.query_sql);
        setQueryParams(graphRes.query_params);
        setDetail(execRes.execution);
        // Land with the root selected so the JSON pane shows something
        // immediately rather than the full-response dump.
        const root = graphRes.events.find((e) => e.parent_id === null);
        setSelected(root ?? graphRes.events[0] ?? null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [org, executionId, depth]);

  if (!org) return <p className="text-slate-500">Pick an org to continue.</p>;

  const truncated = events.length >= GRAPH_LIMIT;
  const shortId = executionId ? `${executionId.slice(0, 8)}…` : '';

  return (
    <div>
      <Breadcrumbs
        crumbs={[
          { label: 'Workflows', to: '/' },
          detail
            ? { label: detail.workflow_name, to: `/workflows/${detail.workflow_id}` }
            : { label: 'Workflow' },
          { label: `Execution ${shortId}` },
        ]}
      />
      <div className="flex items-baseline justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Execution timeline
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-1">{executionId}</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs text-slate-500 flex items-center gap-2">
            depth
            <input
              type="number"
              min={1}
              max={50}
              value={depth}
              onChange={(e) => setDepth(Number(e.target.value) || 1)}
              className="w-16 bg-white border border-slate-300 rounded px-2 py-1 text-xs font-mono text-slate-800"
            />
          </label>
          <QueryInfo
            ms={queryMs}
            sql={querySql}
            params={queryParams}
            label="GET /api/v1/executions/:id/graph"
          />
        </div>
      </div>

      {loading && <p className="text-slate-500 text-sm">loading…</p>}
      {error && <p className="text-rose-600 text-sm">{error}</p>}
      {!loading && !error && executionId && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-4">
          <div>
            <p className="text-xs text-slate-500 mb-2">
              {events.length} events at depth {depth} (loops collapsed to iter 0
              — use the dropdown on a loop to lazy-load another iteration's
              subtree).
            </p>
            <EventTree
              events={events}
              selectedId={selected?.id ?? null}
              onSelect={setSelected}
              executionId={executionId}
            />
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-xs text-slate-500">
                {truncated
                  ? `Showing ${events.length} (capped at ${GRAPH_LIMIT}). Bump depth to load more.`
                  : `Showing all ${events.length} at depth ${depth}.`}
              </span>
              <button
                onClick={() => setDepth((d) => Math.min(50, d + 5))}
                disabled={depth >= 50}
                className="text-xs border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 rounded px-3 py-1.5 shadow-sm"
              >
                Show more (depth +5)
              </button>
            </div>
          </div>
          <JsonPane selected={selected} all={events} />
        </div>
      )}
    </div>
  );
}
