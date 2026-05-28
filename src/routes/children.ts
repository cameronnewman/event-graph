import { Router } from 'express';
import { pool } from '../db.js';
import { requireOrgId, requireUuidParam } from '../middleware.js';
import { getChildren, parseCursor } from '../store/events.js';

export const childrenRouter = Router();

childrenRouter.get(
  '/executions/:executionId/timeline/:parentId',
  async (req, res) => {
    const orgId = requireOrgId(req, res);
    if (!orgId) return;
    const executionId = requireUuidParam(req, res, 'executionId');
    if (!executionId) return;
    const parentId = requireUuidParam(req, res, 'parentId');
    if (!parentId) return;

    const limit = Math.min(Number(req.query.limit ?? 500), 500);
    let cursor = null;
    if (typeof req.query.cursor === 'string') {
      cursor = parseCursor(req.query.cursor);
      if (cursor === null) {
        res
          .status(400)
          .json({ error: "cursor must be '<ISO timestamp>|<uuid>'" });
        return;
      }
    }

    const { events, nextCursor } = await getChildren(pool, {
      orgId,
      executionId,
      parentId,
      cursor,
      limit,
    });
    res.json({ events, next_cursor: nextCursor });
  },
);
