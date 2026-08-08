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
 * ⚠ ARITHMETIC CORRECTION (gate 7 / B2). Commit `15628ca`'s message claims "all six from gate 4, all
 * seven from gate 5" are committed here as cases. They are not, and the true count is what this file
 * actually contains: **13 committed evasion cases — 1 from gate 4, 5 from gate 5, 7 from gate 6.**
 * The separate and TRUE claim is that the MECHANISM catches the rest: a catalog read does not care
 * which filename or naming convention an evasion used, so the uncommitted ones have nothing left to
 * evade. Those two claims were conflated; the numbers above are the measured ones. The commit message
 * is already pushed and history is not rewritten here, so the correction lives in the tracked file.
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
 * WHAT THIS COVERS. NO CLAIM IS MADE ABOUT WHAT ESCAPES.
 *
 * This file discovers functions three ways and applies the posture rule to every one it finds:
 *
 *   1. `pg_depend`  — a dependency Postgres RECORDED. It records these only for bodies it PARSES:
 *                     `begin atomic` bodies, and signatures (e.g. `returns setof public.frontier`).
 *   2. `prosrc`     — the body as CONTENT, after quoting is resolved, matched as a SUBSTRING.
 *                     `$fn$…$fn$`, `$$…$$`, `'…'` and unqualified references all land here
 *                     identically, because the dollar-quote tag is syntax and `prosrc` is what
 *                     survives parsing. Empty for `begin atomic`, which is what (1) covers.
 *   3. `proname`    — the function's own name.
 *
 * Every case below is a shape that was RUN and CAUGHT. That is the whole of what this file asserts.
 *
 * ⚠ THIS DOCSTRING HAS NOW CLAIMED A BOUND ON WHAT ESCAPES TWICE, AND BEEN WRONG BOTH TIMES.
 * Gate 7 killed "the set is complete". Gate 8 killed its replacement, "the gap is exactly these four"
 * — a same-schema `security definer` wrapper calling the governed `delete_orphan_frontier_rows`
 * escaped, because `_` is a word character in Postgres ARE so `\mfrontier\M` never matched it, and it
 * deleted real rows as `anon` with this suite green. Two bounded claims, two gates, both false.
 *
 * So there is no third one. **This file says what it covers and says nothing about what escapes.**
 * Known-uncovered shapes are recorded in
 * `docs/tickets/2026-08-07-frontier-catalog-guard-uncovered-shapes.md` as a running list, not as a
 * bound. The post-apply runbook check is the shape-agnostic control and is the thing to strengthen
 * when a new shape is found.
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

/** Roles that must never hold privileges on a governed TABLE. PUBLIC is checked separately. */
const CLIENT_ROLES = ['anon', 'authenticated'];

/**
 * The ONLY grantees allowed to hold EXECUTE on a governed function. Everything else is a violation,
 * including roles nobody has thought of — see `postureViolations`. `postgres` is the owner (migrations
 * run as it); `service_role` is the worker.
 */
const ALLOWED_GRANTEES = ['postgres', 'service_role'];

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

  -- ⚠ PRODUCTION'S DEFAULT PRIVILEGES. Without these the sandbox is STRICTLY SAFER than production,
  -- which is the one direction that manufactures false greens on a security control (gate 7 / B3).
  --
  -- Read live from pg_default_acl on ezspnfeyzwsisymytssm:
  --   objtype=f  {postgres=X, anon=X, authenticated=X, service_role=X}   ← and NO public (=X) entry
  --   objtype=r  {postgres=arwdDxtm, anon=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm}
  --
  -- Migrations run as postgres, so on production EVERY new function in public is created with an
  -- explicit anon/authenticated EXECUTE entry and every new table with full DML for both. Stock
  -- Postgres grants neither. Measured consequence without this block: narrowing both revokes to
  -- from public — the spelling the migration's own header emphasises — passed GREEN while leaving
  -- anon holding EXECUTE on the row-claiming and row-deleting RPCs live. The revoke from public case
  -- below is the permanent regression test.
  --
  -- ⚠ THE NEXT LINE IS A NO-OP UNDER PGlite, MEASURED. It records nothing in pg_default_acl and a
  -- new function still comes out holding =X (PUBLIC). PUBLIC therefore holds EXECUTE by default in
  -- the sandbox — production's pg_default_acl has no PUBLIC entry either way, so the sandbox is at
  -- worst MORE permissive here, which for a guard can only add violations and never mask one. It is
  -- kept, not deleted, because it states the intent; but if PGlite ever implements it the sandbox
  -- becomes SAFER than production on the PUBLIC axis — the exact direction B3 failed in — and this
  -- block must be re-measured against production that day.
  alter default privileges in schema public revoke execute on functions from public;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
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
    --
    -- SUBSTRING, NOT WORD-BOUNDED. It used to be word-bounded, and UNDERSCORE IS A WORD CHARACTER
    -- in Postgres ARE, so delete_orphan_frontier_rows never matched a word-bounded "frontier". A
    -- same-schema SECURITY DEFINER wrapper calling that already-governed helper therefore escaped
    -- discovery entirely and deleted real rows as anon with this suite green (gate 8 / R2-B1).
    -- Substring matching over-discovers instead, which for a posture rule is the harmless
    -- direction: an extra function simply gets its ACL checked.
    select p.oid, 'prosrc' as via
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosrc ~* ('(' || array_to_string($1::text[], '|') || ')')
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
   -- ⚠ FUNCTIONS ONLY. prokind = 'p' (PROCEDURES) are dropped here, and a procedure can empty
   -- public.frontier just as well. Documented rather than silently filtered — see the coverage
   -- limit in this file's header and the ticket it names.
   where p.prokind = 'f'
   group by p.oid, p.proname, p.prosecdef, p.proconfig, p.proacl
   order by 1;
`;

async function freshDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(PLATFORM_SHIM);
  return db;
}

/**
 * @param edit optional transform applied to each migration's TEXT before it executes. Appending SQL
 *             cannot model a migration MISTAKE — the correct statements have already run — so a case
 *             like "the revoke was written too narrowly" has to change the file's content.
 */
async function applyAllMigrations(db: PGlite, edit?: (sql: string) => string): Promise<string[]> {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const raw = readFileSync(join(MIGRATIONS, f), 'utf8');
    await db.exec(edit ? edit(raw) : raw);
  }
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
    // ALLOWLIST, NOT DENYLIST. This enumerated `anon`/`authenticated`/PUBLIC, so EXECUTE held by any
    // OTHER role — an intermediary a migration invents, or one an `alter default privileges` line
    // names — was invisible (gate 8 / R2-N2). The rule these functions are actually held to is
    // "service_role only", so state that: anything outside the allowlist is a violation, whatever it
    // is called. An ACL item with an EMPTY grantee is the PUBLIC grant.
    if (grantee === '') bad.push(`${fn.name}: PUBLIC holds privileges (${item})`);
    else if (!ALLOWED_GRANTEES.includes(grantee)) bad.push(`${fn.name}: ${grantee} holds privileges (${item})`);
  }
  if (!items.some((i) => i.startsWith('service_role=') && i.includes('X'))) {
    bad.push(`${fn.name}: service_role does not hold EXECUTE`);
  }
  return bad;
}

/**
 * THE TABLE-POSTURE RULE, as a function returning violations.
 *
 * GATE 7 / B2. It used to be inline in its `it`, asserting only that the clean state is clean — so it
 * had NO negative control and nothing showed it could fail for the right reason. A rule that has only
 * ever been run against a passing input is a rule nobody has tested. Extracted so the controls below
 * can drive it against hostile ones.
 */
async function tableViolations(db: PGlite, table: string): Promise<string[]> {
  const { rows } = await db.query<{ rls: boolean; policies: number; acl: string | null }>(
    `select c.relrowsecurity as rls,
            (select count(*)::int from pg_policy where polrelid = c.oid) as policies,
            c.relacl::text as acl
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = $1`,
    [table],
  );
  const row = rows[0];
  const bad: string[] = [];
  if (!row) return [`${table}: not found`];
  if (!row.rls) bad.push(`${table}: RLS is disabled`);
  if (row.policies !== 0) bad.push(`${table}: has ${row.policies} policy/policies`);
  const items = (row.acl ?? '').replace(/^\{|\}$/g, '').split(',').filter(Boolean);
  for (const item of items) {
    const grantee = item.split('=')[0] ?? '';
    if (grantee === '') bad.push(`${table}: PUBLIC holds privileges (${item})`);
    if (CLIENT_ROLES.includes(grantee)) bad.push(`${table}: ${grantee} holds privileges (${item})`);
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

  it('keeps the frontier TABLES closed: RLS on, no policies, no client grants', async () => {
    // A table grant is a different statement from a function grant, so nothing above would see it.
    for (const table of GOVERNED_TABLES) {
      expect(await tableViolations(db, table), `${table} posture`).toEqual([]);
    }
  });
});

/**
 * NEGATIVE CONTROLS FOR THE TABLE RULE — gate 7 / B2.
 *
 * The rule above asserted only that a clean database is clean, which is satisfied by a rule that
 * never fires. Each case below breaks the posture one way and asserts the rule NAMES that way, so a
 * future edit that quietly stops checking RLS (or policies, or the ACL) fails here instead of
 * passing. The last case is the anti-vacuity control: the rule is not simply always-red.
 */
describe('the table-posture rule catches a hostile table change', () => {
  const hostile = async (sql: string): Promise<string[]> => {
    const db = await freshDb();
    await applyAllMigrations(db);
    await db.exec(sql);
    return tableViolations(db, 'frontier');
  };

  it('catches: a direct grant to a client role', async () => {
    // Measured shape: relacl gains `anon=r/postgres` while RLS and the policy count stay correct.
    expect((await hostile(`grant select on public.frontier to anon;`)).join(' ')).toMatch(/anon holds privileges/);
  }, 120_000);

  it('catches: a grant to PUBLIC, which names no role at all', async () => {
    expect((await hostile(`grant select on public.frontier to public;`)).join(' ')).toMatch(/PUBLIC holds privileges/);
  }, 120_000);

  it('catches: RLS switched off', async () => {
    expect((await hostile(`alter table public.frontier disable row level security;`)).join(' ')).toMatch(/RLS is disabled/);
  }, 120_000);

  it('catches: a permissive policy added — RLS on is not the same as closed', async () => {
    expect((await hostile(`create policy p_open on public.frontier for select to anon using (true);`)).join(' '))
      .toMatch(/policy/);
  }, 120_000);

  it('does NOT fire on an unrelated table — the rule is not simply always-red', async () => {
    const db = await freshDb();
    await applyAllMigrations(db);
    await db.exec(`grant select on public.audits to anon;`);
    expect(await tableViolations(db, 'frontier')).toEqual([]);
  }, 120_000);
});

/**
 * TRUE NEGATIVES, DOCUMENTED — gate 7 / B2.
 *
 * `ALTER DEFAULT PRIVILEGES` on its own produces 0 violations, and that is CORRECT, not a gap: default
 * privileges are prospective, so they cannot change the ACL of a function that already exists. The old
 * `R2-D` case bundled this harmless statement with a hostile one and credited the catch to the wrong
 * half. Asserting the true negative explicitly is what stops that from being re-introduced as a
 * "coverage" case, and it pins WHY the split above is shaped the way it is.
 */
describe('what the rule correctly does NOT flag', () => {
  it('ALTER DEFAULT PRIVILEGES alone changes nothing about the four live functions', async () => {
    const db = await freshDb();
    await applyAllMigrations(db);
    await db.exec(`alter default privileges in schema public grant execute on functions to anon;`);
    const fns = await governedFunctions(db);
    expect(fns).toHaveLength(4); // anti-vacuity: the set is still populated
    expect(fns.flatMap(postureViolations)).toEqual([]);
  }, 120_000);
});

/**
 * THE ADP HAZARD, WITH THE STATEMENT ACTUALLY LOAD-BEARING — gate 8 / R3-B8-3.
 *
 * This case has now been wrong twice in the same way. Originally it paired an ADP grant with a new
 * DEFINER function and passed entirely on the second statement. Gate 7 "fixed" it by splitting out an
 * INVOKER function — and it STILL passed with the ADP line deleted, because `PLATFORM_SHIM` already
 * runs `alter default privileges … grant execute on functions to anon, authenticated, service_role`
 * (that is what production has). Granting `anon` something `anon` is already granted is a no-op, so
 * the statement contributed nothing and the label credited it anyway.
 *
 * Fixed by granting to a role the shim does NOT pre-grant, and asserting THAT GRANTEE BY NAME. The
 * ADP line is now the only thing that can produce the asserted violation: delete it and this test
 * fails, which is the property the previous two versions both lacked.
 */
describe('ALTER DEFAULT PRIVILEGES to an unexpected role reaches a later function', () => {
  it('names the role the ADP line granted to — the statement is what produces the violation', async () => {
    const db = await freshDb();
    await applyAllMigrations(db);
    await db.exec(`create role reporting_ro;`);
    // The hazard: a default-privilege line naming a role nobody audits, then any later frontier
    // function silently inherits it. `reporting_ro` is outside ALLOWED_GRANTEES, so the allowlist
    // catches it without anyone having had to predict the name.
    await db.exec(`alter default privileges in schema public grant execute on functions to reporting_ro;`);
    await db.exec(`create function public.reap_adp(p integer) returns void language sql
                     set search_path = public, pg_catalog as $$ delete from public.frontier $$;`);
    const violations = (await governedFunctions(db)).flatMap(postureViolations);
    expect(violations.join(' '), 'the ADP grantee is not named in the violations').toContain('reporting_ro holds privileges');
  }, 120_000);

  it('CONTROL: without the ADP line the same function produces NO reporting_ro violation', async () => {
    // This is the assertion the two previous versions of R2-D were missing. It is what makes the
    // statement above load-bearing rather than decorative.
    const db = await freshDb();
    await applyAllMigrations(db);
    await db.exec(`create role reporting_ro;`);
    await db.exec(`create function public.reap_adp(p integer) returns void language sql
                     set search_path = public, pg_catalog as $$ delete from public.frontier $$;`);
    const violations = (await governedFunctions(db)).flatMap(postureViolations);
    expect(violations.join(' ')).not.toContain('reporting_ro');
    // …and the function is still caught, for the reason it should be: it never revoked.
    expect(violations.join(' ')).toContain('anon holds privileges');
  }, 120_000);
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
    // GATE 8 / R2-B1 — the shape that escaped the word-bounded prosrc match. A same-schema SECURITY
    // DEFINER wrapper calling the already-governed helper: no view, static SQL, same schema,
    // prokind='f'. It deleted 2 real rows as `anon` end to end while this suite was green, and the
    // control (anon calling delete_orphan_frontier_rows directly) was DENIED — so the wrapper was the
    // entire escalation. Caught now because predicate (2) matches `frontier` as a substring.
    [
      'gate 8 R2-B1 — a same-schema DEFINER wrapper around a governed helper',
      `create function public.reap_wrap(p integer default 500) returns integer
         language sql security definer set search_path = public, pg_catalog
         as $$ select public.delete_orphan_frontier_rows(p) $$;
       grant execute on function public.reap_wrap(integer) to anon, authenticated;`,
    ],
    // Was an OPEN uncovered shape in the gate-7 ticket. Dropping the word boundary closed it as a
    // side effect — `frontier_v` contains `frontier` as a substring — so it is pinned here rather
    // than left to regress silently. Measured before/after, not assumed.
    [
      'view indirection — a DEFINER function deleting from a view over frontier',
      `create view public.frontier_v as select * from public.frontier;
       create function public.reap_via_view(p integer) returns void
         language sql security definer set search_path = public, pg_catalog
         as $$ delete from public.frontier_v $$;`,
    ],
    // The compliant-except-it-never-revoked shape, which no other case covers. Kept in the shared
    // loop; the ADP hazard it used to be bundled with now has its own test below, because in this
    // sandbox that statement was inert — see `what the rule correctly does NOT flag`.
    [
      'a function compliant in every respect EXCEPT that it never revoked',
      `create function public.reap_e(p integer) returns void language sql set search_path = public, pg_catalog as $$ delete from public.frontier $$;`,
    ],
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

/**
 * MIGRATION-CONTENT MISTAKES — cases that change what a migration SAYS, not what runs after it.
 *
 * GATE 7 / B3, the most serious finding of that gate because it failed in the UNSAFE direction. The
 * shim did not model production's `pg_default_acl`, so the sandbox was STRICTLY SAFER than
 * production: stock Postgres gives a new function EXECUTE to PUBLIC and nothing to the client roles,
 * while production (migrations run as `postgres`) gives every new function an explicit `anon` and
 * `authenticated` EXECUTE entry and no PUBLIC entry at all.
 *
 * The consequence was measured, not theorised: narrowing the revokes to `from public` — the spelling
 * the migration's own header calls out as the dangerous one to get wrong — passed GREEN while leaving
 * `anon` holding EXECUTE on the row-claiming and row-deleting RPCs at `/rest/v1/rpc/`.
 */
describe('migration-content mistakes, now that the shim models production defaults', () => {
  it('catches: gate 7 B3 — the revokes narrowed to `from public`', async () => {
    const db = await freshDb();
    await applyAllMigrations(db, (sql) => sql.replace(/from public, anon, authenticated;/g, 'from public;'));
    const violations = (await governedFunctions(db)).flatMap(postureViolations);
    expect(violations.length, 'a narrowed revoke produced no violation').toBeGreaterThan(0);
    expect(violations.join(' ')).toMatch(/anon|authenticated/);
  }, 120_000);

  it('catches: the frontier TABLE revoke deleted', async () => {
    // B3's sibling: on stock Postgres that revoke was a no-op all along, so its absence was
    // invisible. With production's defaults modelled, deleting it hands both tables full DML to anon.
    const db = await freshDb();
    await applyAllMigrations(db, (sql) => sql.replace(/revoke all on public\.frontier[^;]*;/g, ''));
    const { rows } = await db.query<{ acl: string | null }>(
      `select c.relacl::text as acl from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'frontier'`,
    );
    const items = (rows[0]?.acl ?? '').replace(/^\{|\}$/g, '').split(',').filter(Boolean);
    expect(items.some((i) => CLIENT_ROLES.includes(i.split('=')[0] ?? '')), 'the table revoke is unpinned').toBe(true);
  }, 120_000);

  it('the UNEDITED migrations still pass — the edit hook is what fails, not the harness', async () => {
    const db = await freshDb();
    await applyAllMigrations(db);
    expect((await governedFunctions(db)).flatMap(postureViolations)).toEqual([]);
  }, 120_000);
});
