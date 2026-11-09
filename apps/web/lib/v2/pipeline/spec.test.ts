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

/** SQL with its `--` and block comments removed, so a commented-out statement creates nothing. */
const uncommented = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');

/**
 * The names of the objects of one kind a SQL text creates, whatever the spelling: any case, with or
 * without `if not exists`, `or replace`, `unique`, the `public.` schema, or quotes around the name.
 */
function createdIn(sql: string, kind: 'table' | 'index' | 'function'): string[] {
  const name = '(?:"?public"?\\.)?"?(\\w+)"?';
  const head = {
    table: `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?${name}`,
    index: `create\\s+(?:unique\\s+)?index\\s+(?:concurrently\\s+)?(?:if\\s+not\\s+exists\\s+)?${name}`,
    function: `create\\s+(?:or\\s+replace\\s+)?function\\s+${name}`,
  }[kind];
  return [...uncommented(sql).matchAll(new RegExp(head, 'gi'))]
    .map((m) => m[1]!.toLowerCase())
    .sort();
}

describe('createdIn reads a creation however it is spelled', () => {
  it.each([
    ['table', 'create table public.zz (id int);'],
    ['table', 'CREATE TABLE IF NOT EXISTS public.zz (id int);'],
    ['table', 'create table "zz" (id int);'],
    ['index', 'create index zz on public.checks (id);'],
    ['index', 'CREATE UNIQUE INDEX IF NOT EXISTS zz ON public.checks (id);'],
    ['function', 'create function public.zz() returns int language sql as $$ select 1 $$;'],
    ['function', 'CREATE OR REPLACE FUNCTION zz() returns int language sql as $$ select 1 $$;'],
  ] as const)('%s: %s', (kind, sql) => {
    expect(createdIn(sql, kind)).toEqual(['zz']);
  });

  it('does not read a creation in a comment', () => {
    expect(
      createdIn('-- create table public.zz (id int);\n/* create index zz on t (id); */', 'table'),
    ).toEqual([]);
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

  it('are exactly the tables, indexes and functions it creates', () => {
    expect(createdIn(sql, 'table')).toEqual([...PIPELINE_TABLES].sort());
    expect(createdIn(sql, 'index')).toEqual([...PIPELINE_INDEXES].sort());
    expect(createdIn(sql, 'function')).toEqual([...PIPELINE_FUNCTIONS].sort());
  });
});
