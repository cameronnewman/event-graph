import { Router } from 'express';
import { pool } from '../db.js';
import { requireOrgId, requireUuidParam } from '../middleware.js';
import { getEventAnchor, getLoopSibling } from '../store/index.js';

export const iterationsRouter = Router();

// Switch the loop event at :parentId to its sibling at iter=:iteration.
//
// :parentId must be a loop event (loop_id IS NOT NULL) belonging to
// :executionId; otherwise 404. Subtree drill-down is the caller's job —
// feed the returned id back into GET /executions/:id/timeline/:newParentId.
iterationsRouter.get(
  '/api/v1/executions/:executionId/timeline/:parentId/iteration/:iteration',
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

    const t0 = Date.now();
    const anchorRes = await getEventAnchor(pool, orgId, executionId, parentId);
    if (!anchorRes.row) {
      res.status(404).json({ error: 'event not found' });
      return;
    }
    if (anchorRes.row.loop_id === null) {
      res.status(404).json({ error: 'event is not a loop event' });
      return;
    }

    const siblingRes = await getLoopSibling(pool, {
      orgId,
      executionId,
      parentId: anchorRes.row.parent_id,
      loopId: anchorRes.row.loop_id,
      iteration,
    });
    if (!siblingRes.row) {
      res
        .status(404)
        .json({ error: `iteration ${iteration} not found for this loop` });
      return;
    }

    // Show only the sibling lookup — the anchor lookup is plumbing.
    res.json({
      event: siblingRes.row,
      query_time_ms: Date.now() - t0,
      query_sql: siblingRes.query.sql,
      query_params: siblingRes.query.params,
    });
  },
);
