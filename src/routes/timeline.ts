import { Router } from 'express';
import { pool } from '../db.js';
import { requireOrgId, requireUuidParam } from '../middleware.js';
import { listExecutionTimeline } from '../store/index.js';

export const timelineRouter = Router();

// Q1: execution timeline, loops collapsed to first iteration.
timelineRouter.get('/api/v1/executions/:executionId/timeline', async (req, res) => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  const executionId = requireUuidParam(req, res, 'executionId');
  if (!executionId) return;

  const limit = Math.min(Number(req.query.limit ?? 500), 500);

  const t0 = Date.now();
  const { rows: events, query } = await listExecutionTimeline(
    pool,
    orgId,
    executionId,
    limit,
  );
  res.json({
    events,
    query_time_ms: Date.now() - t0,
    query_sql: query.sql,
    query_params: query.params,
  });
});
