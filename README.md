# Workflow Execution event-graph

<img width="1152" height="667" alt="image" src="https://github.com/user-attachments/assets/4e38f625-53b6-4d70-bd01-017985b03b64" />

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

## Run it locally

### Prerequisites

- **Node 22+** (matches CI; older versions may work but aren't tested).
- **Docker** running locally — Postgres is launched via `docker compose`, and
  the test suite uses `@testcontainers/postgresql`.
- `make` (already on macOS / most Linux). Windows users can read the
  one-liners out of the `Makefile` and run them directly.

### One-shot

```bash
make start       # install + db up + seed + run API & Vite together
```

Then open <http://localhost:5173/> and click through workflows → executions →
timeline graph. The first run takes ~30s while Postgres boots and the seed
loads; subsequent runs are instant.

### What's running where

| Service     | Port  | URL / how                              |
|-------------|------:|----------------------------------------|
| Postgres    | 5432  | `docker compose exec postgres psql -U eventgraph` |
| API         | 3000  | <http://localhost:3000/api/v1/healthz> |
| Vite (SPA)  | 5173  | <http://localhost:5173/> (proxies `/api/*` to :3000) |

Verify the API is up:

```bash
curl -s http://localhost:3000/api/v1/healthz   # {"ok":true}
curl -s http://localhost:3000/api/v1/orgs      # one entry once you've seeded
```

### Step-by-step (instead of `make start`)

Useful when you want one piece running on its own — e.g. only the API while
you poke at it with `curl`:

```bash
make setup       # npm install in repo root + web/
make db-up       # docker compose up -d postgres
make seed        # dev-sized seed (override SEED_* on CLI; see "Seed knobs")
make api         # API on :3000 (tsx watch mode)
make web         # Vite dev server on :5173 (proxies /api -> :3000)
make dev         # API + Vite together via concurrently (same as `make start` without seed)
```

### Stopping and resetting

```bash
make db-down     # stop Postgres (keeps data volume)
make db-reset    # wipe Postgres volume and recreate (use after editing db/schema.sql)
make clean       # remove node_modules and web/dist
```

The Express dev server hot-reloads on save (`tsx watch`). The SPA hot-reloads
via Vite. Editing `db/schema.sql` requires `make db-reset` — the schema is
only applied on first volume creation.

### Production-style local build

To exercise the same path CI ships (Express serving the built SPA on a single
port):

```bash
npm run build --prefix web    # writes web/dist/
make api                      # Express now serves web/dist/ at http://localhost:3000/
```

### Troubleshooting

- **`docker: Cannot connect to the Docker daemon`** — start Docker Desktop (or
  your daemon) and re-run.
- **Port 5432/3000/5173 already in use** — stop the conflicting service or
  set `PORT=<n>` for the API (`PORT=3001 make api`). The Vite dev port lives
  in `web/vite.config.ts`.
- **`make seed` hangs** — Postgres may still be initialising on first boot;
  `make db-up && make db-wait` waits up to 30s for readiness, then retry.
- **Schema changes don't show up** — `make db-reset` (the volume only loads
  `db/schema.sql` on first creation).

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

## Layout

- `src/store/events.ts` — all SQL lives here. Each query is one exported
  function returning typed rows. Routes call into this and do nothing else
  data-shaped.
- `src/routes/*.ts` — thin: validate inputs, call store, translate result
  tags (e.g. `event_not_found`) to HTTP status codes.
- `src/middleware.ts` — `x-org-id` and UUID-param validation.
- `db/schema.sql` — tables, partial indexes, `redact_payload()`.

## Tests

Integration tests run against a real Postgres via
`@testcontainers/postgresql`. Each test isolates by a fresh `org_id`, so
test files can parallelise without truncating between cases.

```bash
npm test                                # spins up Postgres in Docker
TEST_DATABASE_URL=postgres://...  npm test   # reuse an existing PG (CI / local)
```

Coverage as of this commit:

| Query                 | Cases |
|-----------------------|-------|
| `getTimeline` (Q1)    | ordering, loop collapse, org isolation, limit, empty execution, redaction |
| `getChildren` (Q2)    | basic drill, keyset pagination across 3 pages, cursor at boundary, cross-execution guard, org isolation, redaction |
| `getIterationSibling` (Q3) | sibling lookup, anchor self-match, unknown id, cross-execution, non-loop event, missing iteration, NULL parent (top-level loop), loop_id boundary, redaction |
| `getGraph` (Query A)  | depth cutoff (1, 2, N), depth stamp, loop collapse, ordering, limit, redaction |
| `redact_payload()` SQL | visible passes through, unlabeled masked, unknown label masked, field metadata preserved, order preserved, no-fields-key pass-through, fields not an array, empty fields, **nested-fields NOT recursed (documented limitation)** |
