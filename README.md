# event-graph

POC for the DAG events Postgres design: docker-compose Postgres + TypeScript
Express API serving the execution graph timeline.

## Stack

- Postgres 16 in Docker (schema auto-loaded on first start).
- Node + TypeScript + Express 5, `tsx` as dev runner.
- UUIDv7 generated in Node (`uuidv7` package) — no Postgres extension needed.
- Bulk seed via `COPY FROM STDIN` (`pg-copy-streams`) for stress-scale loads.
- Redaction via the production `redact_payload(jsonb)` function. Every read path
  calls it.

## Endpoints

All require an `x-org-id: <uuid>` header — the production design always predicates
on `org_id` and the POC mirrors that.

All read paths keep the execution id in the URL — the timeline drills down
from execution → parent → iteration as a single nested resource.

| Method | Path                                                                            | Maps to | Notes |
|--------|---------------------------------------------------------------------------------|---------|-------|
| GET    | `/executions/:executionId/timeline`                                             | Q1      | Top-level events, loops collapsed to iter 0. |
| GET    | `/executions/:executionId/timeline/:parentId?cursor=…`                          | Q2      | Drill into a parent (the cursor point). Keyset cursor: `<ISO timestamp>\|<uuid>`. |
| GET    | `/executions/:executionId/timeline/:parentId/iteration/:iteration`              | Q3      | Switch the loop event `:parentId` to its sibling at iter `N`. `:parentId` must be a loop event (`loop_id IS NOT NULL`) within `:executionId` or 404. |
| GET    | `/executions/:executionId/graph?depth=10`                                       | Query A | Recursive collapsed tree with redaction applied once in the outer SELECT. |

## Quickstart

```bash
docker compose up -d postgres
npm install
npm run seed     # truncates, reseeds, prints ids + ready-to-run curls
npm run dev      # API on http://localhost:3000
```

Schema is mounted into `/docker-entrypoint-initdb.d` and applied on first
container start. If you change `db/schema.sql`, run `npm run db:reset` to
recreate the volume.

## Seed knobs

The default seed matches the requested stress shape: 50k executions, each with
5k–20k events, ≥5 distinct loops, nesting depth 3. That's ~500M events and
~250 GB on disk — expect ~hours, not seconds. Override down for dev:

```bash
SEED_EXECUTIONS=10 SEED_MIN_EVENTS=500 SEED_MAX_EVENTS=1500 npm run seed
```

| Env var               | Default | Meaning |
|-----------------------|---------|---------|
| `SEED_EXECUTIONS`     | 50000   | Number of executions for one org. |
| `SEED_MIN_EVENTS`     | 5000    | Lower bound on events per execution. |
| `SEED_MAX_EVENTS`     | 20000   | Upper bound on events per execution. |
| `SEED_NESTING_DEPTH`  | 3       | Depth of the nested-loop chain per execution. |
| `SEED_EXTRA_TOP_LOOPS`| 2       | Extra top-level loops on top of the nested chain. |

Event names are randomly generated from a verb + noun + suffix vocabulary
("Click button A", "Save form #42", …). Stored in a dedicated `name TEXT`
column, separate from `event_type`.

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

## Known POC scope cuts vs the design

- No `execution_agg` / `event_agg` tables and no CDC consumer — POC is read-only.
- No retention loop.
- No Q4 (workflow aggregation) endpoint or `events_workflow_idx`.
- `redact_payload` assumes a flat `fields` array (design limitation 9) — tests
  lock in the non-recursive behaviour.
- Generated-column failure on malformed `metadata.iteration` is a write-path
  concern not exercised by the read tests.
