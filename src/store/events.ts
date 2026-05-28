import type { Pool } from 'pg';

export type EventRow = {
  id: string;
  parent_id: string | null;
  event_type: string;
  name: string;
  status: string;
  conclusion: string | null;
  payload: unknown;
  metadata: Record<string, unknown>;
  created_at: Date;
};

export type GraphRow = EventRow & {
  depth: number;
  iteration_count: number | null;
};

export type IterationEventRow = EventRow & {
  iteration: number;
  loop_id: string;
};

export type Cursor = { createdAt: string; id: string };

// Graph pagination cursor — keyset on the (depth, created_at, id) ordering
// the outer SELECT uses. Encoded over the wire as "<depth>|<iso>|<uuid>".
export type GraphCursor = { depth: number; createdAt: string; id: string };

export type IterationLookup =
  | { kind: 'ok'; event: IterationEventRow }
  | { kind: 'event_not_found' }
  | { kind: 'not_a_loop' }
  | { kind: 'iteration_not_found' };

// Optional capture object passed by routes that want to echo the executed SQL
// + params back to the SPA (powers the "click query time → SQL modal" UI).
// Tests can omit it. Functions that issue multiple statements capture the
// last/headline one — anchor lookups etc. are plumbing.
export type Capture = { sql?: string; params?: unknown[] };

export function parseCursor(s: string): Cursor | null {
  const idx = s.lastIndexOf('|');
  if (idx === -1) return null;
  return { createdAt: s.slice(0, idx), id: s.slice(idx + 1) };
}

export function encodeCursor(row: { created_at: Date; id: string }): string {
  return `${row.created_at.toISOString()}|${row.id}`;
}

export function parseGraphCursor(s: string): GraphCursor | null {
  // depth|iso-timestamp|uuid. ISO timestamp can contain ':' / '-' / '.' so we
  // split by the first '|' for depth and the last '|' for id.
  const first = s.indexOf('|');
  const last = s.lastIndexOf('|');
  if (first === -1 || last === first) return null;
  const depth = Number(s.slice(0, first));
  if (!Number.isInteger(depth)) return null;
  return {
    depth,
    createdAt: s.slice(first + 1, last),
    id: s.slice(last + 1),
  };
}

export function encodeGraphCursor(row: {
  depth: number;
  created_at: Date;
  id: string;
}): string {
  return `${row.depth}|${row.created_at.toISOString()}|${row.id}`;
}

// Q1
export async function getTimeline(
  pool: Pool,
  opts: { orgId: string; executionId: string; limit: number },
  capture?: Capture,
): Promise<EventRow[]> {
  const sql = `SELECT id, parent_id, event_type, name, status, conclusion,
        redact_payload(payload) AS payload, metadata, created_at
   FROM events
  WHERE org_id = $1
    AND execution_id = $2
    AND (iteration IS NULL OR iteration = 0)
  ORDER BY created_at, id
  LIMIT $3`;
  const params: unknown[] = [opts.orgId, opts.executionId, opts.limit];
  if (capture) {
    capture.sql = sql;
    capture.params = params;
  }
  const { rows } = await pool.query<EventRow>(sql, params);
  return rows;
}

// Q2
export async function getChildren(
  pool: Pool,
  opts: {
    orgId: string;
    executionId: string;
    parentId: string;
    cursor: Cursor | null;
    limit: number;
  },
  capture?: Capture,
): Promise<{ events: EventRow[]; nextCursor: string | null }> {
  const params: unknown[] = [opts.orgId, opts.executionId, opts.parentId];
  let cursorClause = '';
  if (opts.cursor) {
    params.push(opts.cursor.createdAt, opts.cursor.id);
    cursorClause = `AND (created_at, id) > ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  }
  params.push(opts.limit);

  const sql = `SELECT id, parent_id, event_type, name, status, conclusion,
        redact_payload(payload) AS payload, metadata, created_at
   FROM events
  WHERE org_id = $1
    AND execution_id = $2
    AND parent_id = $3
    AND (iteration IS NULL OR iteration = 0)
    ${cursorClause}
  ORDER BY created_at, id
  LIMIT $${params.length}`;
  if (capture) {
    capture.sql = sql;
    capture.params = params;
  }

  const { rows } = await pool.query<EventRow>(sql, params);
  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === opts.limit && last ? encodeCursor(last) : null;
  return { events: rows, nextCursor };
}

// Q3 — combined anchor lookup + sibling fetch, tagged union for the route to
// translate to HTTP status codes.
export async function getIterationSibling(
  pool: Pool,
  opts: {
    orgId: string;
    executionId: string;
    eventId: string;
    iteration: number;
  },
  capture?: Capture,
): Promise<IterationLookup> {
  const { rows: anchorRows } = await pool.query<{
    parent_id: string | null;
    loop_id: string | null;
  }>(
    `SELECT parent_id, loop_id
       FROM events
      WHERE id = $1 AND org_id = $2 AND execution_id = $3`,
    [opts.eventId, opts.orgId, opts.executionId],
  );
  if (anchorRows.length === 0) return { kind: 'event_not_found' };
  const anchor = anchorRows[0]!;
  if (anchor.loop_id === null) return { kind: 'not_a_loop' };

  const siblingSql = `SELECT id, parent_id, event_type, name, status, conclusion,
        redact_payload(payload) AS payload, metadata, created_at,
        iteration, loop_id
   FROM events
  WHERE org_id = $1
    AND execution_id = $2
    AND parent_id IS NOT DISTINCT FROM $3::uuid
    AND loop_id = $4
    AND iteration = $5`;
  const siblingParams: unknown[] = [
    opts.orgId,
    opts.executionId,
    anchor.parent_id,
    anchor.loop_id,
    opts.iteration,
  ];
  if (capture) {
    capture.sql = siblingSql;
    capture.params = siblingParams;
  }
  const { rows: siblingRows } = await pool.query<IterationEventRow>(
    siblingSql,
    siblingParams,
  );
  if (siblingRows.length === 0) return { kind: 'iteration_not_found' };
  return { kind: 'ok', event: siblingRows[0]! };
}

// Query A — recursive collapsed graph, depth-bounded, redacted.
// iteration_count is attached to every loop event so the SPA can render
// a "switch iteration" dropdown without a second round trip. rootEventId
// re-anchors the recursion at any event id (used to lazy-load a non-zero
// iteration's subtree). `after` is a keyset cursor on the outer
// (depth, created_at, id) ordering — pass the last row of the previous
// page to fetch the next slice.
export async function getGraph(
  pool: Pool,
  opts: {
    orgId: string;
    executionId: string;
    depth: number;
    limit: number;
    rootEventId?: string;
    after?: GraphCursor;
  },
  capture?: Capture,
): Promise<{ events: GraphRow[]; nextCursor: string | null }> {
  const anchorClause = opts.rootEventId
    ? `e.id = $5`
    : `e.parent_id IS NULL AND (e.iteration IS NULL OR e.iteration = 0)`;

  const params: unknown[] = [
    opts.orgId,
    opts.executionId,
    opts.depth,
    opts.limit,
  ];
  if (opts.rootEventId) params.push(opts.rootEventId);

  // Build the outer keyset predicate when an `after` cursor is supplied.
  // Param order is intentional: $1..$4 are the standard args, $5 is
  // rootEventId (if any), and the cursor takes the next three slots.
  let cursorClause = '';
  if (opts.after) {
    params.push(opts.after.depth, opts.after.createdAt, opts.after.id);
    const d = params.length - 2;
    const t = params.length - 1;
    const i = params.length;
    cursorClause = `WHERE (g.depth, g.created_at, g.id)
                       > ($${d}::int, $${t}::timestamptz, $${i}::uuid)`;
  }

  const sql = `WITH RECURSIVE graph AS (
   SELECT e.id, e.parent_id, e.event_type, e.name, e.status, e.conclusion,
          e.payload, e.metadata, e.loop_id, e.iteration,
          e.created_at, 1 AS depth
     FROM events e
    WHERE e.org_id = $1
      AND e.execution_id = $2
      AND ${anchorClause}
   UNION ALL
   SELECT c.id, c.parent_id, c.event_type, c.name, c.status, c.conclusion,
          c.payload, c.metadata, c.loop_id, c.iteration,
          c.created_at, g.depth + 1
     FROM events c
     JOIN graph g ON c.parent_id = g.id
    WHERE c.org_id = $1
      AND c.execution_id = $2
      AND (c.iteration IS NULL OR c.iteration = 0)
      AND g.depth < $3
 )
 SELECT g.id, g.parent_id, g.depth, g.event_type, g.name, g.status,
        g.conclusion,
        redact_payload(g.payload) AS payload,
        g.metadata, g.created_at,
        CASE WHEN g.loop_id IS NOT NULL THEN (
          SELECT COUNT(*)::int FROM events s
           WHERE s.org_id = $1
             AND s.execution_id = $2
             AND s.loop_id = g.loop_id
             AND s.parent_id IS NOT DISTINCT FROM g.parent_id
        ) END AS iteration_count
   FROM graph g
  ${cursorClause}
  ORDER BY g.depth, g.created_at, g.id
  LIMIT $4`;
  if (capture) {
    capture.sql = sql;
    capture.params = params;
  }

  const { rows } = await pool.query<GraphRow>(sql, params);
  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === opts.limit && last ? encodeGraphCursor(last) : null;
  return { events: rows, nextCursor };
}
