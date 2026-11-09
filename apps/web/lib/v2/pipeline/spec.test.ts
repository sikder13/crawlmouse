import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { describe, expect, it } from 'vitest';
import { PIPELINE_FUNCTIONS, PIPELINE_INDEXES, PIPELINE_TABLES } from './columns';
import { SPEC_20B_PATH, buildSpec20b } from './spec';

const path = fileURLToPath(new URL(`../../../../../${SPEC_20B_PATH}`, import.meta.url));

describe('docs/specs/v2/20b-pipeline.md', () => {
  it('is exactly what write-spec.ts writes from the code', async () => {
    const options = { ...(await resolveConfig(path)), filepath: path };
    expect(readFileSync(path, 'utf8')).toBe(await format(`${buildSpec20b()}\n`, options));
  });
});

describe('the objects SPEC 20b names for migration 008', () => {
  const sql = readFileSync(
    fileURLToPath(
      new URL(
        '../../../../../infra/supabase/migrations/20261109000001_v2_008_pipeline.sql',
        import.meta.url,
      ),
    ),
    'utf8',
  );
  const created = (re: RegExp) => [...sql.matchAll(re)].map((m) => m[1]!).sort();

  it('are exactly the tables, indexes and functions it creates', () => {
    expect(created(/create table if not exists public\.(\w+)/g)).toEqual(
      [...PIPELINE_TABLES].sort(),
    );
    expect(created(/create (?:unique )?index if not exists (\w+)/g)).toEqual(
      [...PIPELINE_INDEXES].sort(),
    );
    expect(created(/create or replace function public\.(\w+)/g)).toEqual(
      [...PIPELINE_FUNCTIONS].sort(),
    );
  });
});
