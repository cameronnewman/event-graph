import { Router } from 'express';
import { pool } from '../db.js';
import { requireOrgId, requireUuidParam } from '../middleware.js';

export const childrenRouter = Router();

// Q2: drill into / paginate under a parent (collapsed), keyset cursor.
// The parent id is also the "cursor point" into the execution timeline.
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
    const cursor = req.query.cursor as string | undefined;

    const params: unknown[] = [orgId, executionId, parentId];
    let cursorClause = '';
    if (cursor) {
      const idx = cursor.lastIndexOf('|');
      if (idx === -1) {
        res
          .status(400)
          .json({ error: "cursor must be '<ISO timestamp>|<uuid>'" });
        return;
      }
      const t = cursor.slice(0, idx);
      const id = cursor.slice(idx + 1);
      params.push(t, id);
      cursorClause = `AND (created_at, id) > ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
    }
    params.push(limit);

    const { rows } = await pool.query(
      `SELECT id, event_type, name, status, conclusion,
              redact_payload(payload) AS payload, metadata, created_at
         FROM events
        WHERE org_id = $1
          AND execution_id = $2
          AND parent_id = $3
          AND (iteration IS NULL OR iteration = 0)
          ${cursorClause}
        ORDER BY created_at, id
        LIMIT $${params.length}`,
      params,
    );

    const last = rows[rows.length - 1];
    const nextCursor =
      rows.length === limit && last
        ? `${last.created_at.toISOString()}|${last.id}`
        : null;

    res.json({ events: rows, next_cursor: nextCursor });
  },
);

