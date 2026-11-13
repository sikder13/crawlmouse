import type { PGlite } from '@electric-sql/pglite';
import {
  AccessTestSchema,
  CheckSchema,
  LinkEdgeSchema,
  PageResultSchema,
} from '@crawlmouse/types/v2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';

/**
 * The JSON export writes the contract's records of four tables (csv.ts, `checkJson`). Each field of
 * those records is a column a signed-in member's own session may select: asked of the database, with
 * every migration applied.
 */

const RECORDS = {
  checks: CheckSchema,
  page_results: PageResultSchema,
  link_edges: LinkEdgeSchema,
  access_tests: AccessTestSchema,
} as const;

let db: PGlite;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 120_000);
afterAll(async () => db.close());

describe('the JSON export’s fields', () => {
  it.each(Object.keys(RECORDS) as (keyof typeof RECORDS)[])(
    '%s: each contract field is a column `authenticated` may select',
    async (table) => {
      const fields = Object.keys(RECORDS[table].shape).sort();
      const { rows } = await db.query<{ column_name: string }>(
        `select a.attname::text as column_name
           from pg_attribute a
          where a.attrelid = ('public.' || $1)::regclass and a.attnum > 0 and not a.attisdropped
            and has_column_privilege('authenticated', a.attrelid, a.attname, 'SELECT')
          order by 1`,
        [table],
      );
      const readable = new Set(rows.map((r) => r.column_name));
      expect(fields.length).toBeGreaterThan(0);
      expect(fields.filter((f) => !readable.has(f))).toEqual([]);
    },
  );
});
