import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { uuidv7 } from 'uuidv7';
import { from as copyFrom } from 'pg-copy-streams';
import { pool } from './db.js';

// Defaults match the user-requested stress shape. Override down for dev:
//   SEED_EXECUTIONS=5 SEED_MIN_EVENTS=200 SEED_MAX_EVENTS=400 npm run seed
const NUM_EXECUTIONS = Number(process.env.SEED_EXECUTIONS ?? 50_000);
const MIN_EVENTS = Number(process.env.SEED_MIN_EVENTS ?? 5_000);
const MAX_EVENTS = Number(process.env.SEED_MAX_EVENTS ?? 20_000);
const NESTING_DEPTH = Number(process.env.SEED_NESTING_DEPTH ?? 3);
const EXTRA_TOP_LOOPS = Number(process.env.SEED_EXTRA_TOP_LOOPS ?? 2);

const VERBS = [
  'Click', 'Open', 'Submit', 'Load', 'Fetch', 'Save', 'Delete', 'Update',
  'Send', 'Render', 'Validate', 'Process', 'Sync', 'Upload', 'Download',
  'Refresh', 'Cancel', 'Approve', 'Retry', 'Archive',
];
const NOUNS = [
  'button', 'form', 'page', 'modal', 'profile', 'order', 'invoice', 'report',
  'message', 'token', 'session', 'dashboard', 'comment', 'review', 'document',
  'webhook', 'job', 'request', 'queue', 'record',
];
const SUFFIXES = [
  'A', 'B', 'C', 'X', 'Y', 'Z', '#1', '#2', '#3', '#42', '#99', '#101',
];

const randInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T>(arr: T[]): T => arr[randInt(0, arr.length - 1)]!;
const taskName = () => `${pick(VERBS)} ${pick(NOUNS)} ${pick(SUFFIXES)}`;
const loopName = () => `Loop over ${pick(NOUNS)}s`;

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

// Each execution: 1 root + a nested chain of NESTING_DEPTH loops (3 iters each)
// + EXTRA_TOP_LOOPS more independent top-level loops, padded with leaf tasks
// to reach a target count in [MIN_EVENTS, MAX_EVENTS].
function* generateExecution(
  orgId: string,
  workflowId: string,
  executionId: string,
  startTimeMs: number,
): Generator<EventOut> {
  const target = randInt(MIN_EVENTS, MAX_EVENTS);
  let seq = 0;
  const eventsForPickParent: { id: string }[] = [];

  const makeEvent = (
    parentId: string | null,
    eventType: string,
    name: string,
    loopId?: string,
    iteration?: number,
  ): EventOut => {
    const conclusion = Math.random() < 0.05 ? 'failed' : 'success';
    const metadata: Record<string, unknown> = {};
    if (loopId !== undefined) {
      metadata.loop_id = loopId;
      metadata.iteration = iteration;
    }
    // Mix of visible and unlabeled fields so redaction has something to do.
    const payload = {
      fields: [
        {
          id: 'f1',
          name: 'note',
          data_type: 'string',
          label: 'visible',
          value: name,
        },
        {
          id: 'f2',
          name: 'secret',
          data_type: 'string',
          value: `secret-${seq}`,
        },
      ],
    };
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
      status: 'completed',
      conclusion,
      payload: JSON.stringify(payload),
      metadata: JSON.stringify(metadata),
      created_at: createdAt,
    };
  };

  // Root.
  const root = makeEvent(null, 'execution.start', 'Execution start');
  yield root;
  eventsForPickParent.push({ id: root.id });

  // Nested loop chain — depth NESTING_DEPTH.
  let nestParent = root.id;
  for (let d = 1; d <= NESTING_DEPTH; d++) {
    const loopId = `nested-loop-${d}`;
    const iters = randInt(3, 5);
    let firstIterId: string | null = null;
    for (let i = 0; i < iters; i++) {
      const e = makeEvent(
        nestParent,
        'loop.iteration',
        loopName(),
        loopId,
        i,
      );
      yield e;
      eventsForPickParent.push({ id: e.id });
      if (i === 0) firstIterId = e.id;
    }
    nestParent = firstIterId!;
  }

  // Extra top-level loops to reach >= 5 distinct loops total.
  for (let j = 0; j < EXTRA_TOP_LOOPS; j++) {
    const loopId = `top-loop-${j}`;
    const iters = randInt(3, 8);
    for (let i = 0; i < iters; i++) {
      const e = makeEvent(
        root.id,
        'loop.iteration',
        loopName(),
        loopId,
        i,
      );
      yield e;
      eventsForPickParent.push({ id: e.id });
    }
  }

  // Fill remaining budget with leaf tasks under random existing events.
  let produced = seq;
  while (produced < target) {
    const parent = eventsForPickParent[
      randInt(0, eventsForPickParent.length - 1)
    ]!;
    const e = makeEvent(parent.id, 'task.run', taskName());
    yield e;
    produced++;
  }
}

// CSV-escape a single field. NULL is rendered as the literal sentinel \N
// (matched by COPY ... WITH (FORMAT csv, NULL '\N')).
function csv(v: string | null): string {
  if (v === null) return '\\N';
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
    ].join(',') + '\n'
  );
}

async function* allRows(orgId: string, samples: SampleIds) {
  const startEpoch = Date.now() - NUM_EXECUTIONS * 10_000;
  for (let i = 0; i < NUM_EXECUTIONS; i++) {
    const workflowId = uuidv7();
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
      if (e.event_type === 'loop.iteration') {
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

    if (i === 0) {
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

async function copyEvents(orgId: string, samples: SampleIds): Promise<void> {
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
    const source = Readable.from(allRows(orgId, samples), {
      objectMode: false,
      encoding: 'utf8',
    });
    await pipeline(source, copyStream as unknown as Writable);
  } finally {
    client.release();
  }
}

async function seed() {
  console.log(
    `Seeding ${NUM_EXECUTIONS} executions ` +
      `(${MIN_EVENTS}-${MAX_EVENTS} events each)...`,
  );
  const orgId = uuidv7();

  await pool.query('TRUNCATE events, executions');

  const samples: SampleIds = {
    executionId: null,
    workflowId: null,
    loopEventId: null,
    loopIterMax: 0,
  };

  const t0 = Date.now();
  await copyEvents(orgId, samples);
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
  console.log(`  org_id          = ${orgId}`);
  console.log(`  execution_id    = ${samples.executionId}`);
  console.log(`  loop event_id   = ${samples.loopEventId}`);
  console.log(`  loop iter max   = ${samples.loopIterMax}`);

  const base = `http://localhost:${process.env.PORT ?? 3000}`;
  console.log('\nTry:');
  console.log(
    `  curl -H "x-org-id: ${orgId}" "${base}/executions/${samples.executionId}/timeline"`,
  );
  console.log(
    `  curl -H "x-org-id: ${orgId}" "${base}/executions/${samples.executionId}/graph?depth=10"`,
  );
  console.log(
    `  curl -H "x-org-id: ${orgId}" "${base}/events/${samples.loopEventId}/children"`,
  );
  console.log(
    `  curl -H "x-org-id: ${orgId}" "${base}/events/${samples.loopEventId}/iterations/${samples.loopIterMax}"`,
  );

  await pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
