import { Router } from 'express';
import { pool } from '../db.js';
import { requireOrgId, requireUuidParam } from '../middleware.js';
import {
  getExecution,
  listExecutionsForWorkflow,
  listWorkflows,
} from '../store/index.js';

export const workflowsRouter = Router();

workflowsRouter.get('/api/v1/workflows', async (req, res) => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;

  const t0 = Date.now();
  const { rows: workflows, query } = await listWorkflows(pool, orgId);
  res.json({
    workflows,
    query_time_ms: Date.now() - t0,
    query_sql: query.sql,
    query_params: query.params,
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

  const t0 = Date.now();
  const { row, query } = await getExecution(pool, orgId, executionId);
  if (!row) {
    res.status(404).json({ error: 'execution not found' });
    return;
  }
  res.json({
    execution: row,
    query_time_ms: Date.now() - t0,
    query_sql: query.sql,
    query_params: query.params,
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

    const t0 = Date.now();
    const { rows: executions, query } = await listExecutionsForWorkflow(
      pool,
      orgId,
      workflowId,
      limit,
    );
    res.json({
      executions,
      query_time_ms: Date.now() - t0,
      query_sql: query.sql,
      query_params: query.params,
    });
  },
);
