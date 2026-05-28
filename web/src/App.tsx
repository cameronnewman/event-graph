import { Link, Route, Routes } from 'react-router-dom';
import { OrgProvider, useOrg } from './lib/OrgContext';
import { WorkflowsPage } from './pages/WorkflowsPage';
import { ExecutionsPage } from './pages/ExecutionsPage';
import { ExecutionGraphPage } from './pages/ExecutionGraphPage';

function orgLabel(o: { name: string; org_id: string; workflow_count: number; execution_count: number }) {
  return `${o.name} · ${o.org_id.slice(0, 8)}… · ${o.workflow_count} workflows / ${o.execution_count} executions`;
}

function OrgPicker() {
  const { org, orgs, setOrg, loading, error } = useOrg();
  if (loading) return <span className="text-xs text-slate-500">loading…</span>;
  if (error) return <span className="text-xs text-rose-600">{error}</span>;
  if (orgs.length === 0)
    return (
      <span className="text-xs text-amber-600">
        no orgs found — run `make seed`
      </span>
    );
  return (
    <select
      className="bg-white border border-slate-300 rounded px-2 py-1 text-xs text-slate-700 max-w-[480px] truncate shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
      value={org?.org_id ?? ''}
      onChange={(e) => {
        const next = orgs.find((o) => o.org_id === e.target.value);
        if (next) setOrg(next);
      }}
    >
      {orgs.map((o) => (
        <option key={o.org_id} value={o.org_id}>
          {orgLabel(o)}
        </option>
      ))}
    </select>
  );
}

function Shell() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white/90 sticky top-0 backdrop-blur z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <Link
            to="/"
            className="text-base font-semibold tracking-tight text-slate-900 hover:text-slate-700"
          >
            Workflows
          </Link>
          <OrgPicker />
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">
        <Routes>
          <Route path="/" element={<WorkflowsPage />} />
          <Route
            path="/workflows/:workflowId"
            element={<ExecutionsPage />}
          />
          <Route
            path="/executions/:executionId"
            element={<ExecutionGraphPage />}
          />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  return (
    <OrgProvider>
      <Shell />
    </OrgProvider>
  );
}
