import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgres://eventgraph:eventgraph@localhost:5432/eventgraph',
});
