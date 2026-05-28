import { Router } from 'express';
import { pool } from '../db.js';
import { requireOrgId, requireUuidParam } from '../middleware.js';
import { getTimeline, type Capture } from '../store/events.js';

export const timelineRouter = Router();

// Q1: execution timeline, loops collapsed to first iteration.
timelineRouter.get(
  '/api/v1/executions/:executionId/timeline',
  async (req, res) => {
    const orgId = requireOrgId(req, res);
    if (!orgId) return;
    const executionId = requireUuidParam(req, res, 'executionId');
    if (!executionId) return;

    const limit = Math.min(Number(req.query.limit ?? 500), 500);

    const cap: Capture = {};
    const t0 = Date.now();
    const events = await getTimeline(
      pool,
      { orgId, executionId, limit },
      cap,
    );
    res.json({
      events,
      query_time_ms: Date.now() - t0,
      query_sql: cap.sql,
      query_params: cap.params,
    });
  },
);
