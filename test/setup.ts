import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

// Vitest globalSetup: stand up one Postgres container for the whole run,
// apply db/schema.sql, and expose the connection string via TEST_DATABASE_URL.
// Each test file creates its own pg.Pool from that URL.

let container: StartedPostgreSqlContainer | undefined;

export async function setup() {
  container = await new PostgreSqlContainer('postgres:16')
    .withDatabase('eventgraph')
    .withUsername('eventgraph')
    .withPassword('eventgraph')
    .start();

  const url = container.getConnectionUri();
  process.env.TEST_DATABASE_URL = url;

  const here = path.dirname(fileURLToPath(import.meta.url));
  const schema = readFileSync(path.resolve(here, '..', 'db', 'schema.sql'), 'utf8');

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(schema);
  } finally {
    await client.end();
  }
}

export async function teardown() {
  await container?.stop();
}
