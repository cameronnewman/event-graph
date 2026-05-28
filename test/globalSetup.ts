import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import type { GlobalSetupContext } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUri: string;
  }
}

// Canonical path: spin up a fresh Postgres via @testcontainers/postgresql.
// Escape hatch: TEST_DATABASE_URL points at an already-running PG (CI sidecar,
// local dev DB). Schema is loaded idempotently either way.
export default async function setup({ provide }: GlobalSetupContext) {
  if (process.env.TEST_DATABASE_URL) {
    await applySchema(process.env.TEST_DATABASE_URL);
    provide('databaseUri', process.env.TEST_DATABASE_URL);
    return;
  }

  const { PostgreSqlContainer } = await import(
    '@testcontainers/postgresql'
  );
  const container = await new PostgreSqlContainer('postgres:16').start();
  const uri = container.getConnectionUri();
  await applySchema(uri);
  provide('databaseUri', uri);

  return async () => {
    await container.stop();
  };
}

async function applySchema(uri: string): Promise<void> {
  const pool = new Pool({ connectionString: uri });
  try {
    const schema = readFileSync(
      new URL('../db/schema.sql', import.meta.url),
      'utf8',
    );
    await pool.query(schema);
  } finally {
    await pool.end();
  }
}
