-- POC schema: events (immutable) + executions (mutable) + workflows (catalog).
-- Skips production CDC aggregations (execution_agg, event_agg) and Q4 workflow index.
-- UUIDs are UUIDv7-generated in the app, so Postgres needs no extension.

CREATE TABLE IF NOT EXISTS orgs (
  org_id      UUID PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflows (
  workflow_id  UUID PRIMARY KEY,
  org_id       UUID NOT NULL,
  name         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflows_org_idx
  ON workflows (org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS executions (
  execution_id  UUID PRIMARY KEY,
  org_id        UUID NOT NULL,
  workflow_id   UUID NOT NULL,
  status        TEXT NOT NULL,
  conclusion    TEXT,
  started_at    TIMESTAMPTZ NOT NULL,
  completed_at  TIMESTAMPTZ,
  event_count   INT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS events (
  id            UUID PRIMARY KEY,
  org_id        UUID NOT NULL,
  execution_id  UUID NOT NULL,
  workflow_id   UUID NOT NULL,
  parent_id     UUID,
  event_type    TEXT NOT NULL,
  name          TEXT NOT NULL,
  status        TEXT NOT NULL,
  conclusion    TEXT,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  iteration     INT  GENERATED ALWAYS AS ((metadata->>'iteration')::int) STORED,
  loop_id       TEXT GENERATED ALWAYS AS (metadata->>'loop_id') STORED,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- List executions for a workflow (SPA: workflow page).
CREATE INDEX IF NOT EXISTS executions_workflow_idx
  ON executions (org_id, workflow_id, started_at DESC);

-- Q1: execution timeline, loops collapsed to first iteration
CREATE INDEX IF NOT EXISTS events_exec_first_iter_idx
  ON events (org_id, execution_id, created_at, id)
  WHERE iteration IS NULL OR iteration = 0;

-- Q2: drill into a parent, loops collapsed
CREATE INDEX IF NOT EXISTS events_parent_first_iter_idx
  ON events (org_id, parent_id, created_at, id)
  WHERE parent_id IS NOT NULL
    AND (iteration IS NULL OR iteration = 0);

-- Q3: switch loop iteration
CREATE INDEX IF NOT EXISTS events_loop_iter_idx
  ON events (org_id, execution_id, loop_id, iteration, created_at)
  WHERE loop_id IS NOT NULL;

-- Allow-list redaction: any field lacking label = 'visible' is masked.
-- IMMUTABLE so the planner can fold it into the SELECT list once per row.
CREATE OR REPLACE FUNCTION redact_payload(p jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN jsonb_typeof(p->'fields') = 'array' THEN
      jsonb_set(p, '{fields}', (
        SELECT COALESCE(jsonb_agg(
          CASE
            WHEN f->>'label' = 'visible' THEN f
            ELSE f || jsonb_build_object('value','[REDACTED]','redacted',true)
          END
          ORDER BY ord
        ), '[]'::jsonb)
        FROM jsonb_array_elements(p->'fields') WITH ORDINALITY AS t(f, ord)
      ))
    ELSE p
  END
$$;
