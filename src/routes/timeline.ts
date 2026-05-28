import { Router } from 'express';
import { pool } from '../db.js';
import { requireOrgId, requireUuidParam } from '../middleware.js';
import { getTimeline } from '../store/events.js';

export const timelineRouter = Router();

timelineRouter.get('/executions/:executionId/timeline', async (req, res) => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  const executionId = requireUuidParam(req, res, 'executionId');
  if (!executionId) return;
  const limit = Math.min(Number(req.query.limit ?? 500), 500);

  const events = await getTimeline(pool, { orgId, executionId, limit });
  res.json({ events });
});
