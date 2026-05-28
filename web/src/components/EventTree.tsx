import { useMemo, useState } from 'react';
import { api, type GraphEvent, type PayloadField } from '../lib/api';
import { useOrg } from '../lib/OrgContext';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  EyeIcon,
  LockIcon,
  colorForEventType,
  iconForEventType,
} from './icons';

type Node = GraphEvent & { children: Node[] };

const ROW_INDENT_PX = 16;
const ROW_GUTTER_PX = 12;

function buildTree(events: GraphEvent[]): Node[] {
  const byId = new Map<string, Node>();
  for (const e of events) byId.set(e.id, { ...e, children: [] });
  const roots: Node[] = [];
  for (const e of events) {
    const n = byId.get(e.id)!;
    if (e.parent_id && byId.has(e.parent_id)) {
      byId.get(e.parent_id)!.children.push(n);
    } else {
      roots.push(n);
    }
  }
  const cmp = (a: Node, b: Node) =>
    a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
  const sortRec = (ns: Node[]) => {
    ns.sort(cmp);
    for (const n of ns) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

function PayloadFieldsView({ fields }: { fields: PayloadField[] }) {
  if (fields.length === 0)
    return <p className="text-xs text-slate-500">No fields.</p>;
  return (
    <ul className="space-y-1">
      {fields.map((f, i) => {
        const visible = f.label === 'visible' || !f.redacted;
        return (
          <li
            key={f.id ?? i}
            className="flex items-start gap-2 text-xs font-mono"
          >
            <span className="mt-[2px] shrink-0 text-slate-400">
              {visible ? <EyeIcon size={12} /> : <LockIcon size={12} />}
            </span>
            <span className="text-slate-500 shrink-0">
              {f.name ?? f.id ?? `field${i}`}
              {f.data_type ? (
                <span className="text-slate-400">: {f.data_type}</span>
              ) : null}
            </span>
            <span
              className={
                visible ? 'text-slate-800 break-all' : 'text-rose-700 italic'
              }
            >
              {visible
                ? String(f.value ?? '')
                : (f.value as string | undefined) ?? '[REDACTED]'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

type LoopSwapState = {
  iteration: number;
  swapped: Node | null;
  loading: boolean;
  error: string | null;
};

function NodeRow({
  node,
  depth,
  selectedId,
  onSelect,
  executionId,
}: {
  node: Node;
  depth: number;
  selectedId: string | null;
  onSelect: (n: GraphEvent) => void;
  executionId: string;
}) {
  const { org } = useOrg();
  // Loop iterations stay folded by default — they're noisy and each iteration
  // has the same step shape, so the first impression of the tree should be
  // the workflow structure, not a wall of repeated tasks.
  const isLoopIter = node.event_type === 'loop.iteration';
  const [open, setOpen] = useState(depth < 2 && !isLoopIter);
  const [payloadOpen, setPayloadOpen] = useState(false);
  const [loopState, setLoopState] = useState<LoopSwapState>({
    iteration: 0,
    swapped: null,
    loading: false,
    error: null,
  });

  const displayed: Node = loopState.swapped ?? node;
  const Icon = iconForEventType(displayed.event_type);
  const iconColor = colorForEventType(displayed.event_type);
  const hasKids = displayed.children.length > 0;
  const selected = selectedId === displayed.id;
  const fields = displayed.payload?.fields ?? [];
  const iterationCount = node.iteration_count ?? 0;
  const isLoop =
    displayed.event_type === 'loop.iteration' && iterationCount > 0;

  async function switchIteration(target: number) {
    if (!org) return;
    if (target === 0) {
      setLoopState({
        iteration: 0,
        swapped: null,
        loading: false,
        error: null,
      });
      return;
    }
    setLoopState((s) => ({
      ...s,
      iteration: target,
      loading: true,
      error: null,
    }));
    try {
      const { event: sibling } = await api.iteration(
        org.org_id,
        executionId,
        node.id,
        target,
      );
      const { events: subtreeEvents } = await api.graph(
        org.org_id,
        executionId,
        { rootEventId: sibling.id, depth: 20 },
      );
      const subtree = buildTree(subtreeEvents)[0] ?? null;
      const swapped: Node | null = subtree
        ? { ...subtree, iteration_count: node.iteration_count }
        : null;
      setLoopState({
        iteration: target,
        swapped,
        loading: false,
        error: subtree ? null : 'subtree empty',
      });
    } catch (e) {
      setLoopState((s) => ({
        ...s,
        loading: false,
        error: (e as Error).message,
      }));
    }
  }

  // Padding for the row body. We render a single full-width container that
  // owns the hover/selected background, then push the visible content right
  // with paddingLeft. Borders/dividers come from the container, not the row,
  // so indentation never breaks alignment.
  const padLeft = depth * ROW_INDENT_PX + ROW_GUTTER_PX;

  return (
    <li>
      <div
        className={`flex items-center gap-2 py-1 pr-2 ${
          selected
            ? 'bg-sky-50 border-l-2 border-sky-500'
            : 'border-l-2 border-transparent hover:bg-slate-50'
        }`}
        style={{ paddingLeft: `${padLeft}px` }}
      >
        <button
          className={`text-slate-400 ${
            hasKids ? 'hover:text-slate-700' : 'invisible'
          }`}
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'collapse' : 'expand'}
        >
          {open ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
        </button>
        <span className={`shrink-0 ${iconColor}`}>
          <Icon size={16} />
        </span>
        <button
          className="flex-1 min-w-0 text-left flex items-center gap-1.5"
          onClick={() => onSelect(displayed)}
        >
          {displayed.conclusion === 'failed' && (
            <span
              className="inline-block w-1.5 h-1.5 rounded-full bg-rose-500"
              title="failed"
            />
          )}
          <span
            className={`text-sm truncate ${
              displayed.conclusion === 'failed'
                ? 'text-rose-700'
                : 'text-slate-900'
            }`}
          >
            {displayed.name}
          </span>
        </button>
        {isLoop && iterationCount > 1 && (
          <select
            value={loopState.iteration}
            disabled={loopState.loading}
            onChange={(e) => switchIteration(Number(e.target.value))}
            className="bg-white border border-amber-300 text-amber-800 rounded px-1.5 py-0.5 text-[11px] font-mono"
            title="Switch loop iteration"
          >
            {Array.from({ length: iterationCount }, (_, i) => (
              <option key={i} value={i}>
                iter {i} / {iterationCount - 1}
              </option>
            ))}
          </select>
        )}
        {fields.length > 0 && (
          <button
            className="text-[11px] text-slate-500 hover:text-slate-900 border border-slate-200 rounded px-1.5 py-0.5"
            onClick={() => setPayloadOpen((v) => !v)}
            title={payloadOpen ? 'Hide payload' : 'Show payload'}
          >
            {fields.length}
          </button>
        )}
        <span className="text-[11px] text-slate-400 font-mono shrink-0">
          {new Date(displayed.created_at).toLocaleTimeString()}
        </span>
      </div>
      {loopState.loading && (
        <div
          className="text-[11px] text-slate-500 italic py-0.5"
          style={{ paddingLeft: `${padLeft + 32}px` }}
        >
          loading iter {loopState.iteration}…
        </div>
      )}
      {loopState.error && (
        <div
          className="text-[11px] text-rose-600 py-0.5"
          style={{ paddingLeft: `${padLeft + 32}px` }}
        >
          {loopState.error}
        </div>
      )}
      {payloadOpen && fields.length > 0 && (
        <div
          className="border-l-2 border-slate-200 bg-slate-50/70 my-1 mr-2 px-3 py-2"
          style={{ marginLeft: `${padLeft + 28}px` }}
        >
          <PayloadFieldsView fields={fields} />
        </div>
      )}
      {hasKids && open && (
        <ul>
          {displayed.children.map((c) => (
            <NodeRow
              key={c.id}
              node={c}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              executionId={executionId}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function EventTree({
  events,
  selectedId,
  onSelect,
  executionId,
}: {
  events: GraphEvent[];
  selectedId: string | null;
  onSelect: (n: GraphEvent) => void;
  executionId: string;
}) {
  const roots = useMemo(() => buildTree(events), [events]);
  if (roots.length === 0)
    return <p className="text-slate-500 text-sm">No events.</p>;
  return (
    <ul className="border border-slate-200 rounded bg-white py-1 shadow-sm divide-y divide-slate-100">
      {roots.map((r) => (
        <NodeRow
          key={r.id}
          node={r}
          depth={0}
          selectedId={selectedId}
          onSelect={onSelect}
          executionId={executionId}
        />
      ))}
    </ul>
  );
}
