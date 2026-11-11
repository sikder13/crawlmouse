import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { postgrestOver } from '../../../__tests__/helpers/postgrest-pglite';
import { supabaseFixesStore } from './fixes-store';
import { fixWorld, type FixWorld } from './test-support/fix-world';

/**
 * The fix store's site read pages past PostgREST's row cap: the stand-in caps every read at
 * MAX_ROWS, as `db-max-rows` caps production's at 1000, and the site holds more events than that.
 */

const MAX_ROWS = 10;
let fw: FixWorld;
let db: PGlite;
beforeAll(async () => {
  fw = await fixWorld();
  db = fw.db;
  // 25 events on one fix: more than two pages.
  for (let n = 0; n < 25; n++)
    await db.query(
      `insert into public.fix_events (id, fix_id, at, kind, check_id)
       values (gen_random_uuid(), $1, now() + make_interval(secs => $2), 'reopened', $3)`,
      [fw.ranked[0], n, fw.checkId],
    );
}, 120_000);
afterAll(async () => {
  await fw?.db.close();
});

const count = async (sql: string) => (await db.query<{ n: number }>(sql, [fw.w.site1])).rows[0]!.n;

describe('supabaseFixesStore.siteFixes', () => {
  it('reads every fix event and check of the site past the row cap', async () => {
    const store = supabaseFixesStore(postgrestOver(db, { maxRows: MAX_ROWS }));
    const site = await store.siteFixes(fw.w.site1);
    const events = await count(
      `select count(*)::int as n from public.fix_events e join public.site_fixes f on f.id = e.fix_id
        where f.site_id = $1`,
    );
    expect(events, 'anti-vacuity: more events than one capped read').toBeGreaterThan(2 * MAX_ROWS);
    expect(site.events).toHaveLength(events);
    expect(site.fixes).toHaveLength(
      await count(`select count(*)::int as n from public.site_fixes where site_id = $1`),
    );
    expect(site.checks.map((c) => c.status).every((s) => s === 'finished' || s === 'partial')).toBe(
      true,
    );
    expect(site.checks).toHaveLength(
      await count(
        `select count(*)::int as n from public.checks
          where site_id = $1 and status in ('finished', 'partial')`,
      ),
    );
  });
});
