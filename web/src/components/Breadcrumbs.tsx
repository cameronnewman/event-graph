import { Link } from 'react-router-dom';
import { Fragment } from 'react';

export type Crumb = {
  label: string;
  to?: string;
};

export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav className="text-sm flex items-center gap-1.5 mb-3" aria-label="Breadcrumb">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <Fragment key={i}>
            {i > 0 && (
              <span className="text-slate-400" aria-hidden>
                /
              </span>
            )}
            {c.to && !last ? (
              <Link
                to={c.to}
                className="text-slate-500 hover:text-slate-900 transition"
              >
                {c.label}
              </Link>
            ) : (
              <span
                className={last ? 'text-slate-900 font-medium' : 'text-slate-500'}
              >
                {c.label}
              </span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
