import { Router } from 'express';
import { pool } from '../db.js';
import { requireOrgId, requireUuidParam } from '../middleware.js';
import { getGraph } from '../store/events.js';

export const graphRouter = Router();

graphRouter.get('/executions/:executionId/graph', async (req, res) => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  const executionId = requireUuidParam(req, res, 'executionId');
  if (!executionId) return;

  const depth = Math.min(Math.max(Number(req.query.depth ?? 10), 1), 50);
  const limit = Math.min(Number(req.query.limit ?? 500), 500);

  const events = await getGraph(pool, { orgId, executionId, depth, limit });
  res.json({ events });
});
