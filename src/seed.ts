import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { uuidv7 } from "uuidv7";
import { from as copyFrom } from "pg-copy-streams";
import { faker } from "@faker-js/faker";
import { pool } from "./db.js";

// Defaults sized for a useful dev/demo seed (~minutes-to-seconds, gigabytes-down).
// Override via env for a stress shape, e.g.
//   SEED_EXECUTIONS=50000 SEED_MIN_EVENTS=5000 SEED_MAX_EVENTS=20000 npm run seed
const NUM_EXECUTIONS = Number(process.env.SEED_EXECUTIONS ?? 800);
const NUM_WORKFLOWS = Number(process.env.SEED_WORKFLOWS ?? 20);
const MIN_EVENTS = Number(process.env.SEED_MIN_EVENTS ?? 2_200);
const MAX_EVENTS = Number(process.env.SEED_MAX_EVENTS ?? 9_000);
const NESTING_DEPTH = Number(process.env.SEED_NESTING_DEPTH ?? 5);
const EXTRA_TOP_LOOPS = Number(process.env.SEED_EXTRA_TOP_LOOPS ?? 4);

const WORKFLOW_NAMES = [
  "Order processing pipeline",
  "User signup flow",
  "Invoice reconciliation",
  "Daily report generation",
  "Customer support triage",
  "Payment refund workflow",
  "Webhook delivery retry",
  "Document OCR pipeline",
  "Subscription renewal",
  "Email campaign blast",
  "Data export job",
  "Inventory sync",
  "Fraud review queue",
  "Account onboarding",
  "Lead enrichment",
  "Contract approval flow",
  "Shipping label generation",
  "Tax calculation batch",
];

const VERBS = [
  "Click",
  "Open",
  "Submit",
  "Load",
  "Fetch",
  "Save",
  "Delete",
  "Update",
  "Send",
  "Render",
  "Validate",
  "Process",
  "Sync",
  "Upload",
  "Download",
  "Refresh",
  "Cancel",
  "Approve",
  "Retry",
  "Archive",
];
const NOUNS = [
  "button",
  "form",
  "page",
  "modal",
  "profile",
  "order",
  "invoice",
  "report",
  "message",
  "token",
  "session",
  "dashboard",
  "comment",
  "review",
  "document",
  "webhook",
  "job",
  "request",
  "queue",
  "record",
];
const SUFFIXES = [
  "A",
  "B",
  "C",
  "X",
  "Y",
  "Z",
  "#1",
  "#2",
  "#3",
  "#42",
  "#99",
  "#101",
];

const randInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T>(arr: T[]): T => arr[randInt(0, arr.length - 1)]!;
const taskName = () => `${pick(VERBS)} ${pick(NOUNS)} ${pick(SUFFIXES)}`;
const loopName = () => `Loop over ${pick(NOUNS)}s`;

// Field generators. Each builds a payload field with a realistic name and
// value, and declares whether it's safe to show as-is. The `label: 'visible'`
// marker tells `redact_payload` to leave the field alone; everything else
// gets masked to '[REDACTED]'.
type FieldDef = {
  name: string;
  data_type: string;
  value: () => string;
  visible: boolean;
};

const FIELD_DEFS: FieldDef[] = [
  // PII — redacted by default.
  {
    name: "credit_card_number",
    data_type: "string",
    visible: false,
    value: () => faker.finance.creditCardNumber(),
  },
  {
    name: "cvv",
    data_type: "string",
    visible: false,
    value: () => faker.finance.creditCardCVV(),
  },
  {
    name: "ssn",
    data_type: "string",
    visible: false,
    value: () =>
      `${faker.number.int({ min: 100, max: 999 })}-${faker.number.int({ min: 10, max: 99 })}-${faker.number.int({ min: 1000, max: 9999 })}`,
  },
  {
    name: "phone_number",
    data_type: "string",
    visible: false,
    value: () => faker.phone.number(),
  },
  {
    name: "date_of_birth",
    data_type: "date",
    visible: false,
    value: () => faker.date.birthdate().toISOString().slice(0, 10),
  },
  {
    name: "street_address",
    data_type: "string",
    visible: false,
    value: () => faker.location.streetAddress(),
  },
  {
    name: "iban",
    data_type: "string",
    visible: false,
    value: () => faker.finance.iban(),
  },
  {
    name: "routing_number",
    data_type: "string",
    visible: false,
    value: () => faker.finance.routingNumber(),
  },
  {
    name: "api_key",
    data_type: "string",
    visible: false,
    value: () => faker.string.alphanumeric({ length: 32 }),
  },
  {
    name: "session_token",
    data_type: "string",
    visible: false,
    value: () => faker.string.alphanumeric({ length: 24 }),
  },
  {
    name: "email",
    data_type: "string",
    visible: false,
    value: () => faker.internet.email(),
  },
  {
    name: "full_name",
    data_type: "string",
    visible: false,
    value: () => faker.person.fullName(),
  },
  {
    name: "password_hash",
    data_type: "string",
    visible: false,
    value: () => faker.string.hexadecimal({ length: 64, prefix: "" }),
  },
  // Operational / safe-to-show.
  {
    name: "order_id",
    data_type: "string",
    visible: true,
    value: () => `ORD-${faker.string.numeric(6)}`,
  },
  {
    name: "amount_cents",
    data_type: "int",
    visible: true,
    value: () => String(faker.number.int({ min: 100, max: 1_000_000 })),
  },
  {
    name: "currency",
    data_type: "string",
    visible: true,
    value: () => faker.finance.currencyCode(),
  },
  {
    name: "status_code",
    data_type: "int",
    visible: true,
    value: () => String(pick([200, 201, 202, 204, 400, 404, 500])),
  },
  {
    name: "region",
    data_type: "string",
    visible: true,
    value: () =>
      pick(["us-east-1", "us-west-2", "eu-west-1", "ap-southeast-2"]),
  },
  {
    name: "attempt",
    data_type: "int",
    visible: true,
    value: () => String(faker.number.int({ min: 1, max: 5 })),
  },
  {
    name: "duration_ms",
    data_type: "int",
    visible: true,
    value: () => String(faker.number.int({ min: 5, max: 5_000 })),
  },
  {
    name: "queue",
    data_type: "string",
    visible: true,
    value: () => pick(["default", "priority", "batch", "webhooks"]),
  },
];

function buildPayload(noteName: string): {
  fields: Array<Record<string, unknown>>;
} {
  // Always include the human-readable name as a visible field. Then 0–9 more
  // random fields, no duplicates. Some PII, some operational.
  const used = new Set<string>(["note"]);
  const fields: Array<Record<string, unknown>> = [
    {
      id: "note",
      name: "note",
      data_type: "string",
      label: "visible",
      value: noteName,
    },
  ];
  const extras = randInt(0, 9);
  for (let i = 0; i < extras; i++) {
    // 8 attempts to find an unused field — fine for a pool of 20+.
    let def: FieldDef | undefined;
    for (let t = 0; t < 8; t++) {
      const candidate = pick(FIELD_DEFS);
      if (!used.has(candidate.name)) {
        def = candidate;
        break;
      }
    }
    if (!def) break;
    used.add(def.name);
    const field: Record<string, unknown> = {
      id: def.name,
      name: def.name,
      data_type: def.data_type,
      value: def.value(),
    };
    if (def.visible) field.label = "visible";
    fields.push(field);
  }
  return { fields };
}

type EventOut = {
  id: string;
  org_id: string;
  execution_id: string;
  workflow_id: string;
  parent_id: string | null;
  event_type: string;
  name: string;
  status: string;
  conclusion: string;
  payload: string;
  metadata: string;
  created_at: string;
};

// Each loop has a fixed "step shape" planned once and replayed across all of
// its iterations — so iter 0 and iter 5 emit the same sequence of task names,
// with different payload data. That's how a real workflow looks: same code
// running over different inputs.
type Step =
  | { kind: "task"; name: string }
  | { kind: "loop"; loopId: string; name: string; iters: number; body: Step[] };

function planBody(depth: number, target: number): Step[] {
  if (depth >= NESTING_DEPTH || target < 6) {
    const n = Math.max(1, Math.min(target, 6));
    return Array.from({ length: n }, () => ({
      kind: "task" as const,
      name: taskName(),
    }));
  }
  const taskN = randInt(2, 5);
  const iters = randInt(3, 5);
  const perIterTarget = Math.max(1, Math.floor((target - taskN) / iters) - 1);
  const body: Step[] = [];
  for (let i = 0; i < taskN; i++) {
    body.push({ kind: "task", name: taskName() });
  }
  body.push({
    kind: "loop",
    loopId: `nested-loop-${depth + 1}`,
    name: loopName(),
    iters,
    body: planBody(depth + 1, perIterTarget),
  });
  return body;
}

function planExtraLoop(idx: number, target: number): Step {
  const iters = randInt(3, 5);
  const taskN = Math.max(2, Math.floor((target - 1) / iters));
  const body: Step[] = Array.from({ length: taskN }, () => ({
    kind: "task" as const,
    name: taskName(),
  }));
  return {
    kind: "loop",
    loopId: `top-loop-${idx}`,
    name: loopName(),
    iters,
    body,
  };
}

function* generateExecution(
  orgId: string,
  workflowId: string,
  executionId: string,
  startTimeMs: number,
): Generator<EventOut> {
  const target = randInt(MIN_EVENTS, MAX_EVENTS);
  let seq = 0;

  const makeEvent = (
    parentId: string | null,
    eventType: string,
    name: string,
    loopId?: string,
    iteration?: number,
  ): EventOut => {
    const conclusion = Math.random() < 0.05 ? "failed" : "success";
    const metadata: Record<string, unknown> = {};
    if (loopId !== undefined) {
      metadata.loop_id = loopId;
      metadata.iteration = iteration;
    }
    const payload = buildPayload(name);
    const createdAt = new Date(startTimeMs + seq).toISOString();
    seq++;
    return {
      id: uuidv7(),
      org_id: orgId,
      execution_id: executionId,
      workflow_id: workflowId,
      parent_id: parentId,
      event_type: eventType,
      name,
      status: "completed",
      conclusion,
      payload: JSON.stringify(payload),
      metadata: JSON.stringify(metadata),
      created_at: createdAt,
    };
  };

  function* emit(steps: Step[], parentId: string): Generator<EventOut> {
    for (const s of steps) {
      if (s.kind === "task") {
        yield makeEvent(parentId, "task.run", s.name);
      } else {
        for (let i = 0; i < s.iters; i++) {
          const iter = makeEvent(
            parentId,
            "loop.iteration",
            s.name,
            s.loopId,
            i,
          );
          yield iter;
          yield* emit(s.body, iter.id);
        }
      }
    }
  }

  const root = makeEvent(null, "execution.start", "Execution start");
  yield root;

  // Split the target between the deeply nested chain (~85%) and the
  // independent extra top-level loops.
  const mainBudget = Math.floor(target * 0.85);
  const extraTotal = Math.max(0, target - mainBudget);
  const extraPer =
    EXTRA_TOP_LOOPS > 0
      ? Math.max(6, Math.floor(extraTotal / EXTRA_TOP_LOOPS))
      : 0;

  const topBody = planBody(0, mainBudget);
  yield* emit(topBody, root.id);

  for (let j = 0; j < EXTRA_TOP_LOOPS; j++) {
    yield* emit([planExtraLoop(j, extraPer)], root.id);
  }
}

// CSV-escape a single field. NULL is rendered as the literal sentinel \N
// (matched by COPY ... WITH (FORMAT csv, NULL '\N')).
function csv(v: string | null): string {
  if (v === null) return "\\N";
  if (/[",\n\r]/.test(v)) {
    return '"' + v.replace(/"/g, '""') + '"';
  }
  return v;
}

function eventToRow(e: EventOut): string {
  return (
    [
      csv(e.id),
      csv(e.org_id),
      csv(e.execution_id),
      csv(e.workflow_id),
      csv(e.parent_id),
      csv(e.event_type),
      csv(e.name),
      csv(e.status),
      csv(e.conclusion),
      csv(e.payload),
      csv(e.metadata),
      csv(e.created_at),
    ].join(",") + "\n"
  );
}

async function* allRows(
  orgId: string,
  workflowIds: string[],
  samples: SampleIds,
) {
  const startEpoch = Date.now() - NUM_EXECUTIONS * 10_000;
  for (let i = 0; i < NUM_EXECUTIONS; i++) {
    const workflowId = workflowIds[randInt(0, workflowIds.length - 1)]!;
    const executionId = uuidv7();
    let firstLoopId: string | null = null;
    let firstLoopName: string | null = null;
    let firstLoopMaxIter = 0;

    for (const e of generateExecution(
      orgId,
      workflowId,
      executionId,
      startEpoch + i * 10_000,
    )) {
      if (e.event_type === "loop.iteration") {
        const md = JSON.parse(e.metadata) as {
          loop_id?: string;
          iteration?: number;
        };
        if (firstLoopId === null && md.iteration === 0) {
          firstLoopId = e.id;
          firstLoopName = md.loop_id ?? null;
        }
        // Track the max iteration of *the same loop* as firstLoopId.
        if (
          firstLoopName !== null &&
          md.loop_id === firstLoopName &&
          (md.iteration ?? 0) > firstLoopMaxIter
        ) {
          firstLoopMaxIter = md.iteration ?? 0;
        }
      }
      yield eventToRow(e);
    }

    if (samples.executionId === null) {
      samples.executionId = executionId;
      samples.workflowId = workflowId;
      samples.loopEventId = firstLoopId;
      samples.loopIterMax = firstLoopMaxIter;
    }

    if ((i + 1) % 1000 === 0) {
      process.stderr.write(`  ${i + 1}/${NUM_EXECUTIONS} executions...\n`);
    }
  }
}

type SampleIds = {
  executionId: string | null;
  workflowId: string | null;
  loopEventId: string | null;
  loopIterMax: number;
};

async function copyEvents(
  orgId: string,
  workflowIds: string[],
  samples: SampleIds,
): Promise<void> {
  const client = await pool.connect();
  try {
    const copyStream = client.query(
      copyFrom(
        `COPY events
           (id, org_id, execution_id, workflow_id, parent_id,
            event_type, name, status, conclusion,
            payload, metadata, created_at)
         FROM STDIN WITH (FORMAT csv, NULL '\\N')`,
      ),
    );
    const source = Readable.from(allRows(orgId, workflowIds, samples), {
      objectMode: false,
      encoding: "utf8",
    });
    await pipeline(source, copyStream as unknown as Writable);
  } finally {
    client.release();
  }
}

async function seed() {
  console.log(
    `Seeding ${NUM_EXECUTIONS} executions across ${NUM_WORKFLOWS} workflows ` +
      `(${MIN_EVENTS}-${MAX_EVENTS} events each)...`,
  );
  const orgId = uuidv7();
  const orgName = faker.company.name();

  await pool.query("TRUNCATE events, executions, workflows, orgs");
  await pool.query(`INSERT INTO orgs (org_id, name) VALUES ($1, $2)`, [
    orgId,
    orgName,
  ]);

  // Pre-build the workflow pool. Cycle through WORKFLOW_NAMES if NUM_WORKFLOWS
  // exceeds it, suffixing to keep names distinct.
  const workflowIds: string[] = [];
  const workflowRows: { id: string; name: string }[] = [];
  for (let i = 0; i < NUM_WORKFLOWS; i++) {
    const id = uuidv7();
    const base = WORKFLOW_NAMES[i % WORKFLOW_NAMES.length]!;
    const name =
      i < WORKFLOW_NAMES.length
        ? base
        : `${base} (${Math.floor(i / WORKFLOW_NAMES.length) + 1})`;
    workflowIds.push(id);
    workflowRows.push({ id, name });
  }
  await pool.query(
    `INSERT INTO workflows (workflow_id, org_id, name)
     SELECT * FROM UNNEST($1::uuid[], $2::uuid[], $3::text[])`,
    [
      workflowRows.map((w) => w.id),
      workflowRows.map(() => orgId),
      workflowRows.map((w) => w.name),
    ],
  );

  const samples: SampleIds = {
    executionId: null,
    workflowId: null,
    loopEventId: null,
    loopIterMax: 0,
  };

  const t0 = Date.now();
  await copyEvents(orgId, workflowIds, samples);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  // Build the executions table by aggregating from events. Cheap relative to
  // the COPY above; lets us not duplicate state in the seed.
  await pool.query(
    `INSERT INTO executions
       (execution_id, org_id, workflow_id, status, conclusion,
        started_at, completed_at, event_count)
     SELECT execution_id, org_id, workflow_id,
            'completed', 'success',
            MIN(created_at), MAX(created_at), COUNT(*)
       FROM events
      GROUP BY execution_id, org_id, workflow_id`,
  );

  const { rows: counts } = await pool.query(
    `SELECT COUNT(*)::bigint AS n FROM events`,
  );
  console.log(`\nSeeded ${counts[0].n} events in ${dt}s.`);
  console.log(`  org             = ${orgName}`);
  console.log(`  org_id          = ${orgId}`);
  console.log(`  workflows       = ${NUM_WORKFLOWS}`);
  console.log(`  sample workflow = ${samples.workflowId}`);
  console.log(`  execution_id    = ${samples.executionId}`);
  console.log(`  loop event_id   = ${samples.loopEventId}`);
  console.log(`  loop iter max   = ${samples.loopIterMax}`);

  const base = `http://localhost:${process.env.PORT ?? 3000}`;
  console.log("\nTry:");
  console.log(`  open ${base}/`);
  console.log(`  curl "${base}/api/v1/orgs"`);
  console.log(`  curl -H "x-org-id: ${orgId}" "${base}/api/v1/workflows"`);
  console.log(
    `  curl -H "x-org-id: ${orgId}" "${base}/api/v1/workflows/${samples.workflowId}/executions"`,
  );
  console.log(
    `  curl -H "x-org-id: ${orgId}" "${base}/api/v1/executions/${samples.executionId}/timeline"`,
  );
  console.log(
    `  curl -H "x-org-id: ${orgId}" "${base}/api/v1/executions/${samples.executionId}/graph?depth=10"`,
  );
  console.log(
    `  curl -H "x-org-id: ${orgId}" "${base}/api/v1/executions/${samples.executionId}/timeline/${samples.loopEventId}"`,
  );
  console.log(
    `  curl -H "x-org-id: ${orgId}" "${base}/api/v1/executions/${samples.executionId}/timeline/${samples.loopEventId}/iteration/${samples.loopIterMax}"`,
  );

  await pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
