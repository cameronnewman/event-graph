import { Router } from 'express';
import { pool } from '../db.js';
import { requireOrgId, requireUuidParam } from '../middleware.js';
import { getGraph, parseGraphCursor, type Capture } from '../store/events.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const graphRouter = Router();

graphRouter.get('/api/v1/executions/:executionId/graph', async (req, res) => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  const executionId = requireUuidParam(req, res, 'executionId');
  if (!executionId) return;

  const depth = Math.min(Math.max(Number(req.query.depth ?? 10), 1), 50);
  const limit = Math.min(Number(req.query.limit ?? 1000), 1000);

  const rootEventId = req.query.root_event_id as string | undefined;
  if (rootEventId !== undefined && !UUID_RE.test(rootEventId)) {
    res.status(400).json({ error: 'root_event_id must be a UUID' });
    return;
  }

  const rawAfter = req.query.after as string | undefined;
  let after = undefined;
  if (rawAfter) {
    const parsed = parseGraphCursor(rawAfter);
    if (parsed === null) {
      res
        .status(400)
        .json({ error: "after cursor must be '<depth>|<ISO timestamp>|<uuid>'" });
      return;
    }
    after = parsed;
  }

  const cap: Capture = {};
  const t0 = Date.now();
  const { events, nextCursor } = await getGraph(
    pool,
    { orgId, executionId, depth, limit, rootEventId, after },
    cap,
  );
  res.json({
    events,
    next_cursor: nextCursor,
    query_time_ms: Date.now() - t0,
    query_sql: cap.sql,
    query_params: cap.params,
  });
});
