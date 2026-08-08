import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { describe, expect, it, beforeAll } from 'vitest';

/**
 * FRONTIER RPC PRIVILEGE POSTURE — ASSERTED AGAINST THE CATALOG, NEVER AGAINST THE SOURCE.
 *
 * PostgREST publishes every function in the exposed schema at `/rest/v1/rpc/<name>`, and Postgres
 * grants EXECUTE on a new function to PUBLIC by default — of which `anon` and `authenticated` are
 * members. The REVOKE in each migration is the only thing between a row-deleting endpoint and the
 * open internet.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE REPLACES A SOURCE MATCHER, AND WHY THAT WAS A MEDIUM PROBLEM RATHER THAN A COVERAGE
 * PROBLEM.
 *
 * The predecessor read the migration TEXT. It was found evadable at three consecutive gates, and each
 * fix closed the instances it was shown while the class survived one radius smaller:
 *
 *   gate 4 — it carried its own list of FILENAMES (6 evasions)
 *   gate 5 — it carried its own NAMING CONVENTION, `name.includes('frontier')` (7 more)
 *   gate 6 — it carried its own BODY-SYNTAX assumption, `$$…$$` (11 more, across two reviewers)
 *
 * Gate 6's set is the proof that patching was the wrong move. All four of these are ordinary SQL, all
 * four define a `security definer` function that empties `public.frontier` with no revoke, and all
 * four passed a matcher that had just been rewritten to catch exactly this:
 *
 *   `as $fn$ … $fn$`                    a TAGGED dollar-quote — what `pg_dump` and `supabase db diff` emit
 *   `delete from frontier`              unqualified; resolves through the function's own pinned search_path
 *   `language sql … begin atomic … end` the PG14 SQL-standard body
 *   `as 'delete from public.frontier'`  a single-quoted body
 *
 * plus a revoke present only as a TRAILING `--` comment (the stripper blanked only lines that START
 * with one), `on ROUTINE` / `alter ROUTINE` spellings, and `grant service_role to anon`.
 *
 * There is no version of a text matcher that closes that set, because SQL has unboundedly many ways
 * to spell the same thing and the matcher has to enumerate them. **The catalog has one.** A dollar-
 * quote tag cannot evade `pg_proc`: by the time Postgres has the function, the syntax is gone and only
 * the fact remains.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * HOW GOVERNANCE IS DECIDED — from the catalog, by what a function TOUCHES.
 *
 * The previous file claimed this and did not do it. Here it is three catalog predicates, unioned,
 * and the first two are exactly complementary — which is why the set is complete rather than merely
 * larger:
 *
 *   1. `pg_depend`  — a recorded dependency on a governed table. PG only records these for bodies it
 *                     PARSES: `begin atomic` bodies, and signatures (e.g. `returns setof
 *                     public.frontier`). Measured: catches `begin atomic`, and nothing else here.
 *   2. `prosrc`     — the body as CONTENT, after quoting is resolved. Measured: `$fn$…$fn$`,
 *                     `$$…$$`, `'…'` and unqualified references all land here identically, because
 *                     the dollar-quote tag is syntax and `prosrc` is what survives parsing. Empty for
 *                     `begin atomic`, which is precisely the case (1) covers.
 *   3. `proname`    — belt and braces, for a wrapper that touches the tables only indirectly.
 *
 * (1) and (2) partition the two ways Postgres stores a body. That is the argument for completeness,
 * and it is checked by the negative controls below rather than asserted.
 *
 * THE MIGRATIONS ARE THE REAL FILES, APPLIED IN ORDER. Not a fixture, not a subset — all of them,
 * from `infra/supabase/migrations`, so a future migration that re-grants these functions is caught by
 * the same run that proves today's posture.
 *
 * THE ENVIRONMENT SHIM IS DECLARED, NOT HIDDEN. PGlite is stock Postgres and Supabase is not: the
 * roles (`anon`, `authenticated`, `service_role`), the `auth` schema and `auth.uid()`/`auth.role()`
 * exist on the platform, never in a migration. They are created below. `pgcrypto` is loaded as a
 * PGlite contrib extension. Nothing else is stubbed — if a migration needs anything more, it fails
 * here rather than being worked around.
 *
 * THIS IS THE PRE-APPLY CONTROL. The post-apply standard is unchanged and remains the runbook's:
 * verify the same posture from PRODUCTION's `pg_proc` after the owner applies a migration. That check
 * has matched this one twice (gates 5 and 6). Two independent readings of the same catalog is the
 * point — this one runs before a migration can reach production, that one confirms what landed.
 */

const MIGRATIONS = resolve(__dirname, '../../../infra/supabase/migrations');

/** The tables whose access this file governs. A function touching either of them is governed. */
const GOVERNED_TABLES = ['frontier', 'frontier_politeness'];

/** Roles that must never hold EXECUTE on a governed function. PUBLIC is checked separately. */
const CLIENT_ROLES = ['anon', 'authenticated'];

interface CatalogFn {
  name: string;
  args: string;
  securityDefiner: boolean;
  config: string[] | null;
  acl: string | null;
  via: string;
}

/**
 * The Supabase platform objects a migration assumes but never creates. Declared here so the shim is
 * auditable: if this list grows, someone has to justify the addition.
 */
const PLATFORM_SHIM = `
  create role anon;
  create role authenticated;
  create role service_role;
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key, email text);
  create or replace function auth.uid() returns uuid language sql stable as $shim$ select null::uuid $shim$;
  create or replace function auth.role() returns text language sql stable as $shim$ select null::text $shim$;
`;

const GOVERNED_FN_QUERY = `
  with governed as (
    -- (1) a dependency Postgres RECORDED: begin-atomic bodies and signature types.
    select p.oid, 'pg_depend' as via
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_depend d on d.objid = p.oid and d.classid = 'pg_proc'::regclass
      join pg_class c on c.oid = d.refobjid
      join pg_namespace cn on cn.oid = c.relnamespace
     where n.nspname = 'public' and cn.nspname = 'public' and c.relname = any($1)
    union
    -- (2) the body as CONTENT — quoting already resolved by the parser.
    select p.oid, 'prosrc' as via
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosrc ~* ('\\m(' || array_to_string($1::text[], '|') || ')\\M')
    union
    -- (3) the name, for a wrapper that reaches the tables only indirectly.
    select p.oid, 'proname' as via
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname ~* 'frontier'
  )
  select p.proname                                   as name,
         pg_get_function_identity_arguments(p.oid)   as args,
         p.prosecdef                                 as "securityDefiner",
         p.proconfig                                 as config,
         p.proacl::text                              as acl,
         string_agg(distinct g.via, '+')             as via
    from governed g
    join pg_proc p on p.oid = g.oid
   where p.prokind = 'f'
   group by p.oid, p.proname, p.prosecdef, p.proconfig, p.proacl
   order by 1;
`;

async function freshDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(PLATFORM_SHIM);
  return db;
}

async function applyAllMigrations(db: PGlite): Promise<string[]> {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) await db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  return files;
}

const governedFunctions = async (db: PGlite): Promise<CatalogFn[]> =>
  (await db.query<CatalogFn>(GOVERNED_FN_QUERY, [GOVERNED_TABLES])).rows;

/**
 * The posture rule, applied to one function. Returns the violations, so the negative controls can
 * assert that a hostile migration is CAUGHT rather than merely that the suite goes red somewhere.
 */
function postureViolations(fn: CatalogFn): string[] {
  const bad: string[] = [];
  if (fn.securityDefiner) bad.push(`${fn.name}: SECURITY DEFINER — would run as the owner`);
  if (!(fn.config ?? []).some((c) => c.startsWith('search_path='))) {
    bad.push(`${fn.name}: search_path is not pinned`);
  }
  // A null ACL means "defaults", and the default for a function is EXECUTE TO PUBLIC.
  if (fn.acl === null) {
    bad.push(`${fn.name}: no ACL — Postgres defaults to EXECUTE for PUBLIC`);
    return bad;
  }
  const items = fn.acl.replace(/^\{|\}$/g, '').split(',').filter(Boolean);
  for (const item of items) {
    const grantee = item.split('=')[0] ?? '';
    // An ACL item with an EMPTY grantee is the PUBLIC grant. This is the one that a missing REVOKE
    // leaves behind, and it is invisible to any check that only looks for role names.
    if (grantee === '') bad.push(`${fn.name}: PUBLIC holds privileges (${item})`);
    if (CLIENT_ROLES.includes(grantee)) bad.push(`${fn.name}: ${grantee} holds privileges (${item})`);
  }
  if (!items.some((i) => i.startsWith('service_role=') && i.includes('X'))) {
    bad.push(`${fn.name}: service_role does not hold EXECUTE`);
  }
  return bad;
}

describe('frontier RPC privilege posture, read from the catalog after applying the real migrations', () => {
  let db: PGlite;
  let files: string[];
  let fns: CatalogFn[];

  beforeAll(async () => {
    db = await freshDb();
    files = await applyAllMigrations(db);
    fns = await governedFunctions(db);
  }, 120_000);

  it('applies EVERY migration — a skipped file is a blind spot, not a passing test', () => {
    // The predecessor's fatal weakness was reading a subset. Applying all of them means a future
    // migration is covered by this run on the day it is added, with no list to update.
    expect(files.length).toBeGreaterThan(30);
  });

  it('discovers the governed functions from the catalog, by what they touch', () => {
    // Anti-vacuity: every rule below iterates this set, so an empty set would pass in silence — which
    // is exactly how the predecessor's `name.includes` version policed nothing for a whole gate.
    expect(fns.map((f) => f.name).sort()).toEqual([
      'claim_frontier',
      'delete_orphan_frontier_rows',
      'settle_frontier_batch',
      'upsert_frontier_batch',
    ]);
  });

  it('holds SECURITY INVOKER, a pinned search_path, no PUBLIC, and service_role-only EXECUTE', () => {
    const violations = fns.flatMap(postureViolations);
    expect(violations).toEqual([]);
  });

  it('reproduces production byte-for-byte, so this oracle is the same one the runbook reads', () => {
    // The ACL string measured on production `pg_proc` at gates 5 and 6, independently, by two
    // reviewers. If PGlite and production ever disagree, this test is the thing that says so.
    for (const fn of fns) {
      expect(fn.acl, `${fn.name} ACL`).toBe('{postgres=X/postgres,service_role=X/postgres}');
      expect(fn.config, `${fn.name} config`).toEqual(['search_path=public, pg_catalog']);
      expect(fn.securityDefiner, `${fn.name} prosecdef`).toBe(false);
    }
  });

  it('grants no client role MEMBERSHIP of service_role — inheritance is a grant too', async () => {
    // Gate 6 / R2-N5: `grant service_role to anon;` leaves every ACL above untouched and still hands
    // `anon` everything service_role holds. It is not a function grant and not a table grant, so it is
    // invisible to any rule phrased in terms of either — and it is one statement.
    const { rows } = await db.query<{ member: string; role: string }>(
      `select m.rolname as member, r.rolname as role
         from pg_auth_members am
         join pg_roles r on r.oid = am.roleid
         join pg_roles m on m.oid = am.member
        where r.rolname = 'service_role'`,
    );
    expect(rows.filter((r) => CLIENT_ROLES.includes(r.member))).toEqual([]);
  });

  it('keeps the frontier TABLES closed: RLS on, no policies, no client grants', () => {
    // A table grant is a different statement from a function grant, so nothing above would see it.
    return (async () => {
      for (const table of GOVERNED_TABLES) {
        const { rows } = await db.query<{ rls: boolean; policies: number; acl: string | null }>(
          `select c.relrowsecurity as rls,
                  (select count(*)::int from pg_policy where polrelid = c.oid) as policies,
                  c.relacl::text as acl
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = $1`,
          [table],
        );
        expect(rows[0]?.rls, `${table} RLS`).toBe(true);
        expect(rows[0]?.policies, `${table} policy count`).toBe(0);
        for (const role of [...CLIENT_ROLES, '']) {
          const items = (rows[0]?.acl ?? '').replace(/^\{|\}$/g, '').split(',').filter(Boolean);
          expect(items.some((i) => (i.split('=')[0] ?? '') === role), `${table} grants to '${role || 'PUBLIC'}'`).toBe(false);
        }
      }
    })();
  });
});

/**
 * NEGATIVE CONTROLS — every evasion that defeated the source matcher, applied ON TOP of the real
 * migrations and asserted to be CAUGHT.
 *
 * These are the mutation battery, kept in the file rather than run by hand, because the predecessor
 * was rewritten twice on the strength of hand-run mutations that were never committed and therefore
 * never re-run.
 */
describe('the evasions that defeated the source matcher are caught by the catalog', () => {
  const definerNoRevoke = (name: string, body: string) =>
    `create function public.${name}(p integer) returns void language sql security definer set search_path = public, pg_catalog ${body};`;

  const CASES: [label: string, sql: string][] = [
    ['gate 6 EV-A — tagged dollar-quote body', definerNoRevoke('reap_a', `as $fn$ delete from public.frontier $fn$`)],
    ['gate 6 EV-B — unqualified table reference', definerNoRevoke('reap_b', `as $$ delete from frontier $$`)],
    ['gate 6 EV-C — PG14 begin atomic body', definerNoRevoke('reap_c', `begin atomic delete from public.frontier; end`)],
    ['gate 6 EV-D — single-quoted body', definerNoRevoke('reap_d', `as 'delete from public.frontier'`)],
    [
      'gate 4 E6 — re-create an existing function as DEFINER with no revoke',
      `create or replace function public.claim_frontier(p_audit_id uuid, p_url_hashes text[], p_limit integer, p_extra integer)
         returns void language sql security definer set search_path = public, pg_catalog as $$ select 1 $$;`,
    ],
    ['gate 5 R2-A — schema-wide grant to a client role', `grant execute on all functions in schema public to anon, authenticated;`],
    ['gate 6 N6 — the ROUTINE spelling', `grant execute on routine public.claim_frontier(uuid, text[], integer) to anon;`],
    ['gate 5 R2-B — an unqualified grant', `grant execute on function claim_frontier(uuid, text[], integer) to anon;`],
    ['gate 5 R2-C — ALTER FUNCTION … SECURITY DEFINER', `alter function public.claim_frontier(uuid, text[], integer) security definer;`],
    ['gate 5 R2-G — ALTER FUNCTION … RESET search_path', `alter function public.claim_frontier(uuid, text[], integer) reset search_path;`],
    ['gate 6 N4 — a revoke that is only a trailing -- comment', `grant execute on function public.claim_frontier(uuid, text[], integer) to anon; -- revoke execute on function public.claim_frontier(uuid, text[], integer) from anon;`],
    ['gate 5 R2-D — ALTER DEFAULT PRIVILEGES, then a new function', `alter default privileges in schema public grant execute on functions to anon;\n${definerNoRevoke('reap_e', `as $$ delete from public.frontier $$`)}`],
  ];

  for (const [label, sql] of CASES) {
    it(`catches: ${label}`, async () => {
      const db = await freshDb();
      await applyAllMigrations(db);
      await db.exec(sql);
      const violations = (await governedFunctions(db)).flatMap(postureViolations);
      expect(violations.length, `${label} produced no violation`).toBeGreaterThan(0);
    }, 120_000);
  }

  it('catches: gate 6 N5 — role membership (`grant service_role to anon`)', async () => {
    // Checked here rather than in postureViolations because it is not a property of any function: the
    // ACLs stay correct and the privilege arrives through inheritance instead.
    const db = await freshDb();
    await applyAllMigrations(db);
    await db.exec(`grant service_role to anon;`);
    const { rows } = await db.query<{ member: string }>(
      `select m.rolname as member from pg_auth_members am
         join pg_roles r on r.oid = am.roleid join pg_roles m on m.oid = am.member
        where r.rolname = 'service_role'`,
    );
    expect(rows.map((r) => r.member)).toContain('anon');
  }, 120_000);

  it('does NOT flag an unrelated function — the rule is not simply always-red', async () => {
    // Without this, every assertion above would pass on a checker that rejects everything.
    const db = await freshDb();
    await applyAllMigrations(db);
    await db.exec(`create function public.unrelated_helper(p integer) returns integer language sql as $$ select p + 1 $$;`);
    const fns = await governedFunctions(db);
    expect(fns.map((f) => f.name)).not.toContain('unrelated_helper');
    expect(fns.flatMap(postureViolations)).toEqual([]);
  }, 120_000);
});
