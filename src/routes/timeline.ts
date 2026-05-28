import { Router } from 'express';
import { pool } from '../db.js';
import { requireOrgId, requireUuidParam } from '../middleware.js';

export const timelineRouter = Router();

// Q1: execution timeline, loops collapsed to first iteration.
timelineRouter.get('/executions/:executionId/timeline', async (req, res) => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  const executionId = requireUuidParam(req, res, 'executionId');
  if (!executionId) return;

  const limit = Math.min(Number(req.query.limit ?? 500), 500);

  const { rows } = await pool.query(
    `SELECT id, parent_id, event_type, name, status, conclusion,
            redact_payload(payload) AS payload, metadata, created_at
       FROM events
      WHERE org_id = $1
        AND execution_id = $2
        AND (iteration IS NULL OR iteration = 0)
      ORDER BY created_at, id
      LIMIT $3`,
    [orgId, executionId, limit],
  );

  res.json({ events: rows });
});
