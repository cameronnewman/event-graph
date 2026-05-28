import type { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';

export type EventInput = {
  id?: string;
  parentId?: string | null;
  eventType?: string;
  name?: string;
  status?: string;
  conclusion?: string | null;
  payload?: object;
  metadata?: object;
  createdAt?: Date;
};

export type Context = {
  orgId: string;
  workflowId: string;
  executionId: string;
};

export function makeContext(): Context {
  return {
    orgId: uuidv7(),
    workflowId: uuidv7(),
    executionId: uuidv7(),
  };
}

export async function insertEvent(
  pool: Pool,
  ctx: Context,
  e: EventInput = {},
): Promise<string> {
  const id = e.id ?? uuidv7();
  await pool.query(
    `INSERT INTO events (id, org_id, execution_id, workflow_id, parent_id,
                         event_type, name, status, conclusion,
                         payload, metadata, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)`,
    [
      id,
      ctx.orgId,
      ctx.executionId,
      ctx.workflowId,
      e.parentId ?? null,
      e.eventType ?? 'task.run',
      e.name ?? 'event',
      e.status ?? 'completed',
      e.conclusion ?? 'success',
      JSON.stringify(e.payload ?? {}),
      JSON.stringify(e.metadata ?? {}),
      e.createdAt ?? new Date(),
    ],
  );
  return id;
}

// Sequenced time helper: makes test event ordering by created_at deterministic.
export function at(base: Date, offsetMs: number): Date {
  return new Date(base.getTime() + offsetMs);
}
