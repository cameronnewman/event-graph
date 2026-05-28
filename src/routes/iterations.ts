import { Router } from 'express';
import { pool } from '../db.js';
import { requireOrgId, requireUuidParam } from '../middleware.js';
import { getIterationSibling, type Capture } from '../store/events.js';

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

    const cap: Capture = {};
    const t0 = Date.now();
    const result = await getIterationSibling(
      pool,
      { orgId, executionId, eventId: parentId, iteration },
      cap,
    );
    switch (result.kind) {
      case 'event_not_found':
        res.status(404).json({ error: 'event not found' });
        return;
      case 'not_a_loop':
        res.status(404).json({ error: 'event is not a loop event' });
        return;
      case 'iteration_not_found':
        res
          .status(404)
          .json({ error: `iteration ${iteration} not found for this loop` });
        return;
      case 'ok':
        res.json({
          event: result.event,
          query_time_ms: Date.now() - t0,
          query_sql: cap.sql,
          query_params: cap.params,
        });
        return;
    }
  },
);
