import { Router } from 'express';
import { pool } from '../db.js';
import { requireOrgId, requireUuidParam } from '../middleware.js';
import { listChildren, type Cursor } from '../store/index.js';

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

    let cursor: Cursor | undefined;
    if (rawCursor) {
      const idx = rawCursor.lastIndexOf('|');
      if (idx === -1) {
        res
          .status(400)
          .json({ error: "cursor must be '<ISO timestamp>|<uuid>'" });
        return;
      }
      cursor = {
        createdAt: rawCursor.slice(0, idx),
        id: rawCursor.slice(idx + 1),
      };
    }

    const t0 = Date.now();
    const { rows, query } = await listChildren(pool, {
      orgId,
      executionId,
      parentId,
      limit,
      cursor,
    });

    const last = rows[rows.length - 1];
    const nextCursor =
      rows.length === limit && last
        ? `${last.created_at.toISOString()}|${last.id}`
        : null;

    res.json({
      events: rows,
      next_cursor: nextCursor,
      query_time_ms: Date.now() - t0,
      query_sql: query.sql,
      query_params: query.params,
    });
  },
);
