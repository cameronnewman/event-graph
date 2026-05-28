import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Pool } from 'pg';

let pool: Pool;
beforeAll(() => {
  pool = new Pool({ connectionString: inject('databaseUri') });
});
afterAll(async () => {
  await pool.end();
});

async function redact(input: unknown): Promise<unknown> {
  const { rows } = await pool.query(
    `SELECT redact_payload($1::jsonb) AS p`,
    [JSON.stringify(input)],
  );
  return rows[0].p;
}

describe('redact_payload SQL function', () => {
  it('passes through fields with label = visible', async () => {
    const out = (await redact({
      fields: [{ id: 'f', name: 'n', label: 'visible', value: 'shown' }],
    })) as { fields: Array<Record<string, unknown>> };
    expect(out.fields[0].value).toBe('shown');
    expect(out.fields[0].redacted).toBeUndefined();
  });

  it('masks fields without a visible label', async () => {
    const out = (await redact({
      fields: [{ id: 'f', name: 'n', value: 'secret' }],
    })) as { fields: Array<Record<string, unknown>> };
    expect(out.fields[0]).toMatchObject({
      value: '[REDACTED]',
      redacted: true,
    });
  });

  it('masks fields with an unrecognised label value', async () => {
    const out = (await redact({
      fields: [
        { id: 'f', name: 'n', label: 'internal', value: 'still-secret' },
      ],
    })) as { fields: Array<Record<string, unknown>> };
    expect(out.fields[0]).toMatchObject({
      value: '[REDACTED]',
      redacted: true,
    });
  });

  it('preserves field metadata (id, name, data_type) while masking value', async () => {
    const out = (await redact({
      fields: [
        { id: 'f1', name: 'ssn', data_type: 'string', value: '123-45-6789' },
      ],
    })) as { fields: Array<Record<string, unknown>> };
    expect(out.fields[0]).toMatchObject({
      id: 'f1',
      name: 'ssn',
      data_type: 'string',
      value: '[REDACTED]',
      redacted: true,
    });
  });

  it('preserves field order in the output', async () => {
    const out = (await redact({
      fields: [
        { id: 'a', name: 'a' },
        { id: 'b', name: 'b' },
        { id: 'c', name: 'c' },
      ],
    })) as { fields: Array<{ id: string }> };
    expect(out.fields.map((f) => f.id)).toEqual(['a', 'b', 'c']);
  });

  it('passes through payloads without a fields key unchanged', async () => {
    const input = { something: 'else', n: 42 };
    expect(await redact(input)).toEqual(input);
  });

  it('passes through payloads where fields is not an array unchanged', async () => {
    const input = { fields: 'not-an-array' };
    expect(await redact(input)).toEqual(input);
  });

  it('returns an empty fields array for fields: []', async () => {
    const out = (await redact({ fields: [] })) as { fields: unknown[] };
    expect(out.fields).toEqual([]);
  });

  it('does NOT recurse into nested fields structures (documented limitation)', async () => {
    // If a field's value is itself a {fields: [...]} object, the inner
    // values are NOT redacted. Locking this in so a future change to make
    // the function recursive is a conscious decision.
    const out = (await redact({
      fields: [
        {
          id: 'outer',
          name: 'outer',
          label: 'visible',
          value: {
            fields: [{ id: 'inner', name: 'inner', value: 'leaked' }],
          },
        },
      ],
    })) as { fields: Array<{ value: { fields: Array<{ value: string }> } }> };
    expect(out.fields[0].value.fields[0].value).toBe('leaked');
  });
});
