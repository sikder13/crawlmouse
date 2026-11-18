/**
 * Migration 20261121000001 (CC-GL D2): the purge's three functions are SECURITY DEFINER with the
 * search_path the definer check allows, owned by postgres, and executable by service_role alone; the
 * revert drops all three and the file applies again after it. What they do is tested in
 * lib/v2/pipeline/purge-removed.test.ts and lib/v2/pipeline/expire-store.test.ts.
 */
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyAllMigrations,
  freshDb,
  migrationFiles,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';

const FILE = migrationFiles().find((f) => f.endsWith('_v2_gl_removed_site_purge.sql'))!;
const REVERT = FILE.replace(/\.sql$/, '.revert.sql');
const SIGNATURES = [
  'removed_sites_past_keeping(timestamp with time zone, uuid, integer)',
  'removed_site_checks(uuid, uuid, integer)',
  'delete_removed_site_checks(uuid, timestamp with time zone, uuid[])',
];

let db: PGlite;
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 300_000);
afterAll(async () => {
  await db?.close();
});

interface Fn {
  signature: string;
  definer: boolean;
  owner: string;
  config: string[] | null;
}

const functions = async (): Promise<Fn[]> =>
  (
    await db.query<Fn>(
      `select format('%s(%s)', p.proname, oidvectortypes(p.proargtypes)) as signature,
              p.prosecdef as definer, pg_get_userbyid(p.proowner) as owner, p.proconfig as config
         from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname in ('removed_sites_past_keeping', 'removed_site_checks',
                            'delete_removed_site_checks')
        order by 1`,
    )
  ).rows;

describe('migration 20261121000001: the removed-site purge', () => {
  it('creates the three functions as SECURITY DEFINER, owned by postgres, searching pg_catalog then pg_temp', async () => {
    const fns = await functions();
    expect(fns.map((f) => f.signature)).toEqual([...SIGNATURES].sort());
    for (const f of fns) {
      expect(f, f.signature).toMatchObject({
        definer: true,
        owner: 'postgres',
        config: ['search_path=pg_catalog, pg_temp'],
      });
    }
  });

  it('lets service_role execute each, and no other client role', async () => {
    for (const signature of SIGNATURES) {
      for (const [role, allowed] of [
        ['service_role', true],
        ['anon', false],
        ['authenticated', false],
        ['public', false],
      ] as const) {
        const { rows } = await db.query<{ ok: boolean }>(
          role === 'public'
            ? `select exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                               where p.oid = $1::regprocedure and a.grantee = 0) as ok`
            : `select has_function_privilege($2, $1::regprocedure, 'execute') as ok`,
          role === 'public' ? [`public.${signature}`] : [`public.${signature}`, role],
        );
        expect(rows[0]!.ok, `${role} on ${signature}`).toBe(allowed);
      }
    }
  });

  it('states no number of days: the cutoff is the caller’s, from RESTORE_DAYS', () => {
    const sql = readMigration(FILE).replace(/^\s*--.*$/gm, '');
    expect(sql).not.toMatch(/interval|days?\b/i);
  });

  it('the revert drops all three, and the file applies again after it', async () => {
    await db.exec(readRollback(REVERT));
    expect(await functions()).toEqual([]);
    await db.exec(readMigration(FILE));
    expect((await functions()).map((f) => f.signature)).toEqual([...SIGNATURES].sort());
  });
});
