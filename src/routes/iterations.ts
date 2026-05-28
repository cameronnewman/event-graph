import { Router } from 'express';
import { pool } from '../db.js';
import { requireOrgId, requireUuidParam } from '../middleware.js';

export const iterationsRouter = Router();

// Switch to a specific iteration of the loop that :eventId belongs to.
//
// :eventId must be a loop event (loop_id IS NOT NULL); otherwise 404.
// The sibling at iter=:iteration under the same parent + loop_id is returned.
// Subtree drill-down is the caller's job — feed the returned id back into
// GET /events/:id/children.
iterationsRouter.get(
  '/events/:eventId/iterations/:iteration',
  async (req, res) => {
    const orgId = requireOrgId(req, res);
    if (!orgId) return;
    const eventId = requireUuidParam(req, res, 'eventId');
    if (!eventId) return;

    const iteration = Number(req.params.iteration);
    if (!Number.isInteger(iteration) || iteration < 0) {
      res
        .status(400)
        .json({ error: 'iteration must be a non-negative integer' });
      return;
    }

    const { rows: anchorRows } = await pool.query(
      `SELECT execution_id, parent_id, loop_id
         FROM events WHERE id = $1 AND org_id = $2`,
      [eventId, orgId],
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
        anchor.execution_id,
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
