import type {
  Cursor,
  EventRow,
  GraphEventRow,
  LoopSiblingRow,
  Queryable,
  StoreResult,
} from './types.js';

const LIST_EXECUTION_TIMELINE_SQL = `SELECT id, parent_id, event_type, name, status, conclusion,
       redact_payload(payload) AS payload, metadata, created_at
  FROM events
 WHERE org_id = $1
   AND execution_id = $2
   AND (iteration IS NULL OR iteration = 0)
 ORDER BY created_at, id
 LIMIT $3`;

// Q1: execution timeline, loops collapsed to first iteration.
export async function listExecutionTimeline(
  db: Queryable,
  orgId: string,
  executionId: string,
  limit: number,
): Promise<StoreResult<EventRow>> {
  const params: unknown[] = [orgId, executionId, limit];
  const { rows } = await db.query<EventRow>(LIST_EXECUTION_TIMELINE_SQL, params);
  return { rows, query: { sql: LIST_EXECUTION_TIMELINE_SQL, params } };
}

// Q2: paginate children under a parent, loops collapsed, keyset cursor.
export async function listChildren(
  db: Queryable,
  args: {
    orgId: string;
    executionId: string;
    parentId: string;
    limit: number;
    cursor?: Cursor;
  },
): Promise<StoreResult<EventRow>> {
  const params: unknown[] = [args.orgId, args.executionId, args.parentId];
  let cursorClause = '';
  if (args.cursor) {
    params.push(args.cursor.createdAt, args.cursor.id);
    cursorClause = `AND (created_at, id) > ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  }
  params.push(args.limit);

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

  const { rows } = await db.query<EventRow>(sql, params);
  return { rows, query: { sql, params } };
}

const GET_EVENT_ANCHOR_SQL = `SELECT parent_id, loop_id
  FROM events
 WHERE id = $1 AND org_id = $2 AND execution_id = $3`;

// Q3a: fetch a single event's loop anchor (parent_id + loop_id), scoped to org.
export async function getEventAnchor(
  db: Queryable,
  orgId: string,
  executionId: string,
  eventId: string,
): Promise<{
  row: { parent_id: string | null; loop_id: string | null } | null;
  query: { sql: string; params: unknown[] };
}> {
  const params: unknown[] = [eventId, orgId, executionId];
  const { rows } = await db.query<{
    parent_id: string | null;
    loop_id: string | null;
  }>(GET_EVENT_ANCHOR_SQL, params);
  return {
    row: rows[0] ?? null,
    query: { sql: GET_EVENT_ANCHOR_SQL, params },
  };
}

const GET_LOOP_SIBLING_SQL = `SELECT id, parent_id, event_type, name, status, conclusion,
       redact_payload(payload) AS payload, metadata, created_at
  FROM events
 WHERE org_id = $1
   AND execution_id = $2
   AND parent_id IS NOT DISTINCT FROM $3::uuid
   AND loop_id = $4
   AND iteration = $5`;

// Q3b: switch to a specific loop sibling by iteration index.
export async function getLoopSibling(
  db: Queryable,
  args: {
    orgId: string;
    executionId: string;
    parentId: string | null;
    loopId: string;
    iteration: number;
  },
): Promise<{
  row: LoopSiblingRow | null;
  query: { sql: string; params: unknown[] };
}> {
  const params: unknown[] = [
    args.orgId,
    args.executionId,
    args.parentId,
    args.loopId,
    args.iteration,
  ];
  const { rows } = await db.query<LoopSiblingRow>(GET_LOOP_SIBLING_SQL, params);
  return {
    row: rows[0] ?? null,
    query: { sql: GET_LOOP_SIBLING_SQL, params },
  };
}

// Query A: recursive collapsed graph (loops folded to iter=0), depth-bounded,
// redacted. iteration_count is attached to every loop event so callers can
// render an iteration switcher without a second round trip.
// When rootEventId is set, the recursion is anchored at that event instead of
// the execution roots — used to lazy-load a subtree at a non-zero iteration.
export async function getExecutionGraph(
  db: Queryable,
  args: {
    orgId: string;
    executionId: string;
    depth: number;
    limit: number;
    rootEventId?: string;
  },
): Promise<StoreResult<GraphEventRow>> {
  const anchorClause = args.rootEventId
    ? `e.id = $5`
    : `e.parent_id IS NULL AND (e.iteration IS NULL OR e.iteration = 0)`;

  const params: unknown[] = [
    args.orgId,
    args.executionId,
    args.depth,
    args.limit,
  ];
  if (args.rootEventId) params.push(args.rootEventId);

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
 ORDER BY g.depth, g.created_at, g.id
 LIMIT $4`;

  const { rows } = await db.query<GraphEventRow>(sql, params);
  return { rows, query: { sql, params } };
}
