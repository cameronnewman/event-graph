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

export type GraphRow = EventRow & { depth: number };
export type IterationEventRow = EventRow & {
  iteration: number;
  loop_id: string;
};

export type Cursor = { createdAt: string; id: string };

export type IterationLookup =
  | { kind: 'ok'; event: IterationEventRow }
  | { kind: 'event_not_found' }
  | { kind: 'not_a_loop' }
  | { kind: 'iteration_not_found' };

export function parseCursor(s: string): Cursor | null {
  const idx = s.lastIndexOf('|');
  if (idx === -1) return null;
  return { createdAt: s.slice(0, idx), id: s.slice(idx + 1) };
}

export function encodeCursor(row: { created_at: Date; id: string }): string {
  return `${row.created_at.toISOString()}|${row.id}`;
}

// Q1
export async function getTimeline(
  pool: Pool,
  opts: { orgId: string; executionId: string; limit: number },
): Promise<EventRow[]> {
  const { rows } = await pool.query(
    `SELECT id, parent_id, event_type, name, status, conclusion,
            redact_payload(payload) AS payload, metadata, created_at
       FROM events
      WHERE org_id = $1
        AND execution_id = $2
        AND (iteration IS NULL OR iteration = 0)
      ORDER BY created_at, id
      LIMIT $3`,
    [opts.orgId, opts.executionId, opts.limit],
  );
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
): Promise<{ events: EventRow[]; nextCursor: string | null }> {
  const params: unknown[] = [opts.orgId, opts.executionId, opts.parentId];
  let cursorClause = '';
  if (opts.cursor) {
    params.push(opts.cursor.createdAt, opts.cursor.id);
    cursorClause = `AND (created_at, id) > ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  }
  params.push(opts.limit);

  const { rows } = await pool.query(
    `SELECT id, parent_id, event_type, name, status, conclusion,
            redact_payload(payload) AS payload, metadata, created_at
       FROM events
      WHERE org_id = $1
        AND execution_id = $2
        AND parent_id = $3
        AND (iteration IS NULL OR iteration = 0)
        ${cursorClause}
      ORDER BY created_at, id
      LIMIT $${params.length}`,
    params,
  );

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === opts.limit && last ? encodeCursor(last) : null;
  return { events: rows, nextCursor };
}

// Q3
export async function getIterationSibling(
  pool: Pool,
  opts: {
    orgId: string;
    executionId: string;
    eventId: string;
    iteration: number;
  },
): Promise<IterationLookup> {
  const { rows: anchorRows } = await pool.query(
    `SELECT parent_id, loop_id
       FROM events
      WHERE id = $1 AND org_id = $2 AND execution_id = $3`,
    [opts.eventId, opts.orgId, opts.executionId],
  );
  if (anchorRows.length === 0) return { kind: 'event_not_found' };
  const anchor = anchorRows[0];
  if (anchor.loop_id === null) return { kind: 'not_a_loop' };

  const { rows: siblingRows } = await pool.query(
    `SELECT id, parent_id, event_type, name, status, conclusion,
            redact_payload(payload) AS payload, metadata, created_at,
            iteration, loop_id
       FROM events
      WHERE org_id = $1
        AND execution_id = $2
        AND parent_id IS NOT DISTINCT FROM $3::uuid
        AND loop_id = $4
        AND iteration = $5`,
    [
      opts.orgId,
      opts.executionId,
      anchor.parent_id,
      anchor.loop_id,
      opts.iteration,
    ],
  );
  if (siblingRows.length === 0) return { kind: 'iteration_not_found' };
  return { kind: 'ok', event: siblingRows[0] };
}

// Query A
export async function getGraph(
  pool: Pool,
  opts: {
    orgId: string;
    executionId: string;
    depth: number;
    limit: number;
  },
): Promise<GraphRow[]> {
  const { rows } = await pool.query(
    `WITH RECURSIVE graph AS (
       SELECT e.id, e.parent_id, e.event_type, e.name, e.status, e.conclusion,
              e.payload, e.metadata, e.created_at, 1 AS depth
         FROM events e
        WHERE e.org_id = $1
          AND e.execution_id = $2
          AND e.parent_id IS NULL
          AND (e.iteration IS NULL OR e.iteration = 0)
       UNION ALL
       SELECT c.id, c.parent_id, c.event_type, c.name, c.status, c.conclusion,
              c.payload, c.metadata, c.created_at, g.depth + 1
         FROM events c
         JOIN graph g ON c.parent_id = g.id
        WHERE c.org_id = $1
          AND c.execution_id = $2
          AND (c.iteration IS NULL OR c.iteration = 0)
          AND g.depth < $3
     )
     SELECT id, parent_id, depth, event_type, name, status, conclusion,
            redact_payload(payload) AS payload, metadata, created_at
       FROM graph
      ORDER BY depth, created_at, id
      LIMIT $4`,
    [opts.orgId, opts.executionId, opts.depth, opts.limit],
  );
  return rows;
}
