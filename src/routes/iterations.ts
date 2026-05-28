import { Router } from 'express';
import { pool } from '../db.js';
import { requireOrgId, requireUuidParam } from '../middleware.js';

export const iterationsRouter = Router();

// Switch the loop event at :parentId to its sibling at iter=:iteration.
//
// :parentId must be a loop event (loop_id IS NOT NULL) belonging to
// :executionId; otherwise 404. Subtree drill-down is the caller's job —
// feed the returned id back into GET /executions/:id/timeline/:newParentId.
iterationsRouter.get(
  '/executions/:executionId/timeline/:parentId/iteration/:iteration',
  async (req, res) => {
    const orgId = requireOrgId(req, res);
    if (!orgId) return;
    const executionId = requireUuidParam(req, res, 'executionId');
    if (!executionId) return;
    const parentId = requireUuidParam(req, res, 'parentId');
    if (!parentId) return;

    const iteration = Number(req.params.iteration);
    if (!Number.isInteger(iteration) || iteration < 0) {
      res
        .status(400)
        .json({ error: 'iteration must be a non-negative integer' });
      return;
    }

    const { rows: anchorRows } = await pool.query(
      `SELECT parent_id, loop_id
         FROM events
        WHERE id = $1 AND org_id = $2 AND execution_id = $3`,
      [parentId, orgId, executionId],
    );
    if (anchorRows.length === 0) {
      res.status(404).json({ error: 'event not found' });
      return;
    }
    const anchor = anchorRows[0];
    if (anchor.loop_id === null) {
      res.status(404).json({ error: 'event is not a loop event' });
      return;
    }

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
        orgId,
        executionId,
        anchor.parent_id,
        anchor.loop_id,
        iteration,
      ],
    );
    if (siblingRows.length === 0) {
      res
        .status(404)
        .json({ error: `iteration ${iteration} not found for this loop` });
      return;
    }

    res.json({ event: siblingRows[0] });
  },
);
