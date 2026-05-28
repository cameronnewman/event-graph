import { Router } from 'express';
import { pool } from '../db.js';
import { listOrgs } from '../store/index.js';

export const orgsRouter = Router();

// Discovery endpoint for the SPA: list orgs that actually have data so the UI
// can default to one without the user pasting a UUID. No auth — POC only.
orgsRouter.get('/api/v1/orgs', async (_req, res) => {
  const t0 = Date.now();
  const { rows: orgs, query } = await listOrgs(pool);
  res.json({
    orgs,
    query_time_ms: Date.now() - t0,
    query_sql: query.sql,
    query_params: query.params,
  });
});
