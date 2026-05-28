import { Router } from 'express';
import { pool } from '../db.js';
import { requireOrgId, requireUuidParam } from '../middleware.js';
import {
  getExecution,
  listExecutionsForWorkflow,
  listWorkflows,
} from '../store/index.js';
import type { Capture } from '../store/events.js';

export const workflowsRouter = Router();

workflowsRouter.get('/api/v1/workflows', async (req, res) => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;

  const cap: Capture = {};
  const t0 = Date.now();
  const workflows = await listWorkflows(pool, orgId, cap);
  res.json({
    workflows,
    query_time_ms: Date.now() - t0,
    query_sql: cap.sql,
    query_params: cap.params,
  });
});

// Single execution lookup. Mainly so the SPA's graph page can resolve
// workflow_id + workflow_name for the breadcrumb without falling back to
// scanning the workflows list.
workflowsRouter.get('/api/v1/executions/:executionId', async (req, res) => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  const executionId = requireUuidParam(req, res, 'executionId');
  if (!executionId) return;

  const cap: Capture = {};
  const t0 = Date.now();
  const row = await getExecution(pool, orgId, executionId, cap);
  if (!row) {
    res.status(404).json({ error: 'execution not found' });
    return;
  }
  res.json({
    execution: row,
    query_time_ms: Date.now() - t0,
    query_sql: cap.sql,
    query_params: cap.params,
  });
});

workflowsRouter.get(
  '/api/v1/workflows/:workflowId/executions',
  async (req, res) => {
    const orgId = requireOrgId(req, res);
    if (!orgId) return;
    const workflowId = requireUuidParam(req, res, 'workflowId');
    if (!workflowId) return;

    const limit = Math.min(Number(req.query.limit ?? 100), 500);

    const cap: Capture = {};
    const t0 = Date.now();
    const executions = await listExecutionsForWorkflow(
      pool,
      orgId,
      workflowId,
      limit,
      cap,
    );
    res.json({
      executions,
      query_time_ms: Date.now() - t0,
      query_sql: cap.sql,
      query_params: cap.params,
    });
  },
);
