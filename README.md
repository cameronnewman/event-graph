# event-graph

A small demo that proves out the DAG-events Postgres design: workflow executions
made of tens of thousands of parent/child events (with nested loops) stored in a
single `events` table, served back as a paginated timeline and a recursive graph
view, and browsable from a React/Tailwind SPA.

It's a sandbox to play with the schema, indexes, and read queries at realistic
scale — seed a few executions for dev, or hundreds of millions of rows to stress
the indexes — and hit them through a small Express API or the bundled UI.

## What you can do with it

1. Stand up Postgres + the API + the SPA locally with `make start`.
2. Browse workflows → executions → timeline graph in the UI at <http://localhost:5173/>.
3. Or call the read endpoints with `curl` directly (the seed prints
   ready-to-run commands with real ids filled in).

## Stack

- Postgres 16 in Docker (schema auto-loaded on first start).
- Node + TypeScript + Express 5, `tsx` as dev runner.
- UUIDv7 generated in Node (`uuidv7` package) — no Postgres extension needed.
- Bulk seed via `COPY FROM STDIN` (`pg-copy-streams`) for stress-scale loads.
- Redaction via the production `redact_payload(jsonb)` function. Every read path
  calls it.
- React 18 + Vite + Tailwind SPA in `web/`, served by Express from `web/dist/`
  in production, or via the Vite dev server (which proxies `/api/*` to Express).

## Quickstart

```bash
make start       # install + db up + seed + run API & Vite together
```

Open <http://localhost:5173/> and click through workflows → executions →
timeline graph.

Granular targets:

```bash
make setup       # npm install (root + web)
make db-up       # docker compose up -d postgres
make seed        # dev-sized seed (override SEED_* on CLI)
make api         # API on :3000 (watch mode)
make web         # Vite dev server on :5173 (proxies /api -> :3000)
make dev         # API + Vite together via concurrently
make db-reset    # wipe Postgres volume and recreate
```

## API

All read paths require an `x-org-id: <uuid>` header — the production design
always predicates on `org_id` and the POC mirrors that. `/api/v1/orgs` is the
exception (discovery endpoint for the SPA).

All `/timeline/...` paths keep the execution id in the URL — the timeline
drills down from execution → parent → iteration as a single nested resource.

Every response carries a `query_time_ms` field — the SQL roundtrip on the
server, surfaced as a coloured chip in the UI.

| Method | Path | Maps to | Notes |
|--------|------|---------|-------|
| GET    | `/api/v1/orgs` | — | List orgs (with company name + counts). No auth. |
| GET    | `/api/v1/workflows` | — | List workflows for `x-org-id`, with execution counts. |
| GET    | `/api/v1/workflows/:workflowId/executions` | — | List executions for one workflow, newest first. |
| GET    | `/api/v1/executions/:executionId/timeline` | Q1 | Top-level events, loops collapsed to iter 0. |
| GET    | `/api/v1/executions/:executionId/timeline/:parentId?cursor=…` | Q2 | Drill into a parent. Keyset cursor: `<ISO timestamp>\|<uuid>`. |
| GET    | `/api/v1/executions/:executionId/timeline/:parentId/iteration/:iteration` | Q3 | Switch loop sibling iteration. `:parentId` must be a loop event. |
| GET    | `/api/v1/executions/:executionId/graph?depth=10&root_event_id=…` | Query A | Recursive collapsed tree, redaction in the outer SELECT. Loop events carry `iteration_count`. `root_event_id` re-anchors the recursion (used by the SPA to lazy-load non-zero-iteration subtrees). |

## Schema

- `orgs (org_id PK, name, created_at)` — named tenants so the SPA picker has
  a readable label.
- `workflows (workflow_id PK, org_id, name, created_at)` — named catalog so
  the UI has readable labels.
- `executions (execution_id PK, org_id, workflow_id, status, …)` — one row
  per run, derived from events at seed time.
- `events (id PK, org_id, execution_id, workflow_id, parent_id, …)` —
  immutable, with `iteration` / `loop_id` STORED-generated from `metadata`.
  Payload `fields[]` carry a `label: 'visible'` marker for fields that
  `redact_payload()` should leave alone; everything else is masked.

Schema is mounted into `/docker-entrypoint-initdb.d` and applied on first
container start. If you change `db/schema.sql`, run `make db-reset` (this
wipes the volume).

## Seed knobs

Defaults live in `src/seed.ts` and are tuned for a useful demo shape
(500 executions across 20 workflows, 1.2k–5k events each). Override via env:

```bash
SEED_EXECUTIONS=10000 SEED_MIN_EVENTS=5000 SEED_MAX_EVENTS=20000 SEED_WORKFLOWS=20 make seed
```

Or hit the original stress shape directly:

```bash
SEED_EXECUTIONS=50000 SEED_MIN_EVENTS=5000 SEED_MAX_EVENTS=20000 npm run seed
```

| Env var               | Default | Meaning |
|-----------------------|--------:|---------|
| `SEED_EXECUTIONS`     | 500     | Number of executions for one org. |
| `SEED_WORKFLOWS`      | 20      | Number of named workflows; executions distribute across them. |
| `SEED_MIN_EVENTS`     | 1200    | Lower bound on events per execution. |
| `SEED_MAX_EVENTS`     | 5000    | Upper bound on events per execution. |
| `SEED_NESTING_DEPTH`  | 3       | Depth of the nested-loop chain per execution. |
| `SEED_EXTRA_TOP_LOOPS`| 2       | Extra top-level loops on top of the nested chain. |

Workflow names come from a fixed catalog ("Order processing pipeline",
"User signup flow", …). Event names are randomly generated from a
verb + noun + suffix vocabulary. Payloads are 1–10 fields generated by
`@faker-js/faker`: a mix of PII-style fields that the production
`redact_payload()` function masks (credit card, SSN, phone, email,
address, IBAN, API key, session token, …) and operational fields that
stay visible (order_id, amount_cents, region, status_code, …).

## Frontend (`web/`)

```
web/
  src/
    App.tsx                       shell + router + org picker
    lib/api.ts                    typed fetch client (stamps x-org-id)
    lib/OrgContext.tsx            fetches /api/v1/orgs once, picks one
    pages/WorkflowsPage.tsx       list workflows
    pages/ExecutionsPage.tsx      executions for a workflow
    pages/ExecutionGraphPage.tsx  recursive graph view
    components/EventTree.tsx      tree built from /graph (flat list → nested)
```

In dev: hit Vite on <http://localhost:5173/> — it proxies `/api/*` to
Express on `:3000`. For a production-style build (`npm run build --prefix web`),
Express serves `web/dist/` with a SPA fallback that excludes `/api/`.

## Known POC scope cuts vs the design

- No `execution_agg` / `event_agg` tables and no CDC consumer — POC is read-only.
- No retention loop.
- No Q4 (workflow aggregation) endpoint or `events_workflow_idx`.
- `redact_payload` assumes a flat `fields` array (design limitation 9).
