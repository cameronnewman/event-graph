import { Router } from 'express';
import { pool } from '../db.js';
import { requireOrgId, requireUuidParam } from '../middleware.js';

export const graphRouter = Router();

// Query A: recursive graph, loops collapsed, depth-bounded, redacted.
// Redaction is applied once in the outer SELECT, not inside the recursion.
graphRouter.get('/executions/:executionId/graph', async (req, res) => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  const executionId = requireUuidParam(req, res, 'executionId');
  if (!executionId) return;

  const depth = Math.min(Math.max(Number(req.query.depth ?? 10), 1), 50);
  const limit = Math.min(Number(req.query.limit ?? 500), 500);

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
    [orgId, executionId, depth, limit],
  );

  res.json({ events: rows });
});
