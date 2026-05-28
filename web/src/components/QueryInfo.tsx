import { useEffect, useState } from 'react';

type Props = {
  ms: number | null;
  sql: string | null;
  params: unknown[] | null;
  label?: string;
};

function toneFor(ms: number): string {
  if (ms < 20) return 'text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100';
  if (ms < 100) return 'text-sky-700 bg-sky-50 border-sky-200 hover:bg-sky-100';
  if (ms < 500) return 'text-amber-700 bg-amber-50 border-amber-200 hover:bg-amber-100';
  return 'text-rose-700 bg-rose-50 border-rose-200 hover:bg-rose-100';
}

export function QueryInfo({ ms, sql, params, label }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (ms === null) return null;
  const clickable = sql !== null;

  return (
    <>
      <button
        className={`text-[11px] font-mono border rounded px-1.5 py-0.5 transition ${toneFor(ms)} ${
          clickable ? 'cursor-pointer' : 'cursor-default'
        }`}
        onClick={() => clickable && setOpen(true)}
        disabled={!clickable}
        title={clickable ? 'Click to view SQL' : 'server-side SQL roundtrip'}
      >
        {ms} ms
      </button>
      {open && sql !== null && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  {label ?? 'Query'}
                </h2>
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  {ms} ms · {params?.length ?? 0} param
                  {(params?.length ?? 0) === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded px-2 py-1"
                  onClick={() => navigator.clipboard.writeText(sql)}
                >
                  copy sql
                </button>
                <button
                  className="text-slate-500 hover:text-slate-900 px-2"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="overflow-auto flex-1">
              <pre className="text-[12px] font-mono text-slate-800 p-4 leading-relaxed whitespace-pre-wrap">
                {sql}
              </pre>
              {params && params.length > 0 && (
                <div className="border-t border-slate-200 px-4 py-3 bg-slate-50">
                  <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">
                    Params
                  </p>
                  <ol className="space-y-1 text-[12px] font-mono">
                    {params.map((p, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-slate-400">${i + 1}</span>
                        <span className="text-slate-800 break-all">
                          {JSON.stringify(p)}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
