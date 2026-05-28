import { Router } from 'express';
import { pool } from '../db.js';
import { requireOrgId, requireUuidParam } from '../middleware.js';
import { getChildren, parseCursor, type Capture } from '../store/events.js';

export const childrenRouter = Router();

// Q2: drill into / paginate under a parent (collapsed), keyset cursor.
// The parent id is also the "cursor point" into the execution timeline.
childrenRouter.get(
  '/api/v1/executions/:executionId/timeline/:parentId',
  async (req, res) => {
    const orgId = requireOrgId(req, res);
    if (!orgId) return;
    const executionId = requireUuidParam(req, res, 'executionId');
    if (!executionId) return;
    const parentId = requireUuidParam(req, res, 'parentId');
    if (!parentId) return;

    const limit = Math.min(Number(req.query.limit ?? 500), 500);
    const rawCursor = req.query.cursor as string | undefined;

    let cursor = null;
    if (rawCursor) {
      cursor = parseCursor(rawCursor);
      if (cursor === null) {
        res
          .status(400)
          .json({ error: "cursor must be '<ISO timestamp>|<uuid>'" });
        return;
      }
    }

    const cap: Capture = {};
    const t0 = Date.now();
    const { events, nextCursor } = await getChildren(
      pool,
      { orgId, executionId, parentId, cursor, limit },
      cap,
    );

    res.json({
      events,
      next_cursor: nextCursor,
      query_time_ms: Date.now() - t0,
      query_sql: cap.sql,
      query_params: cap.params,
    });
  },
);
