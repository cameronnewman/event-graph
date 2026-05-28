import { Router } from 'express';
import { pool } from '../db.js';
import { requireOrgId, requireUuidParam } from '../middleware.js';
import { getGraph, type Capture } from '../store/events.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const graphRouter = Router();

graphRouter.get('/api/v1/executions/:executionId/graph', async (req, res) => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  const executionId = requireUuidParam(req, res, 'executionId');
  if (!executionId) return;

  const depth = Math.min(Math.max(Number(req.query.depth ?? 10), 1), 50);
  const limit = Math.min(Number(req.query.limit ?? 500), 500);

  const rootEventId = req.query.root_event_id as string | undefined;
  if (rootEventId !== undefined && !UUID_RE.test(rootEventId)) {
    res.status(400).json({ error: 'root_event_id must be a UUID' });
    return;
  }

  const cap: Capture = {};
  const t0 = Date.now();
  const events = await getGraph(
    pool,
    { orgId, executionId, depth, limit, rootEventId },
    cap,
  );
  res.json({
    events,
    query_time_ms: Date.now() - t0,
    query_sql: cap.sql,
    query_params: cap.params,
  });
});
