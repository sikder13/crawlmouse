# Runbook — SPEC 5.1a fingerprint migration (owner-applied)

**Migration:** `infra/supabase/migrations/20260803000001_spec51a_crawl_fingerprint.sql`
**Project:** `ezspnfeyzwsisymytssm` · **Applied by:** owner · **Written by:** the build terminal
**Risk:** low — one additive nullable column, no backfill, no policy change, no rewrite.

Migrations are owner-applied only. This file is the exact SQL to approve, the rehearsal to run first,
and the verification to run after.

---

## 1. Pre-flight

Confirm the column does not already exist. Expect **zero rows**:

```sql
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'audits' and column_name = 'fingerprint';
```

Verified zero rows on 2026-08-03 via the Supabase MCP.

## 2. Rehearsal — transaction-rollback on live

The org is on the Free plan, so there is no branch to rehearse against (branching needs Pro, ~$25/mo).
Use the txn-rollback-on-live rehearsal the project already uses for additive migrations: run the real
DDL inside a transaction, assert the post-state, then force a rollback so nothing persists.

```sql
do $$
begin
  alter table public.audits add column if not exists fingerprint jsonb;

  -- Assert the shape we expect BEFORE rolling back.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'audits'
      and column_name = 'fingerprint' and data_type = 'jsonb' and is_nullable = 'YES'
  ) then
    raise exception 'REHEARSAL FAILED: fingerprint column missing or wrong shape';
  end if;

  -- A representative payload must round-trip through jsonb.
  perform '{"version":1,"discoveredCount":2055,"selectedCount":500,"digest":"abc",
            "strata":[{"templateKey":"/listing/{slug}","discovered":2000,"selected":445}],
            "seed":"cm-frontier-v1"}'::jsonb;

  raise exception 'REHEARSAL COMPLETE — rolling back deliberately';
end $$;
```

The final `raise exception` is intentional: it aborts the transaction so the rehearsal leaves the
database untouched. Seeing `REHEARSAL COMPLETE — rolling back deliberately` is the pass condition.
Any other error is a fail — stop and report.

## 3. Apply

Apply the migration file exactly as written. It is a single statement plus a comment:

```sql
alter table public.audits
  add column if not exists fingerprint jsonb;
```

`if not exists` makes it idempotent, so a re-run after a partial failure is safe.

## 4. Verification (run after applying)

**4.1 — the column exists with the right shape.** Expect one row, `jsonb`, `YES`:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'audits' and column_name = 'fingerprint';
```

**4.2 — existing rows are unaffected.** Expect `total = 209+` and `non_null = 0`:

```sql
select count(*) as total, count(fingerprint) as non_null from public.audits;
```

**4.3 — RLS is unchanged and still deny-by-default.** Compare the policy list against the pre-migration
state; the count and names must be identical:

```sql
select policyname, cmd, roles from pg_policies
where schemaname = 'public' and tablename = 'audits' order by policyname;
```

**4.4 — B16 column privilege: `anon` and `authenticated` must NOT have been granted anything new.**
A new column inherits table-level grants, so this asserts no column-level grant leaked in:

```sql
select grantee, privilege_type
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'audits' and column_name = 'fingerprint'
  and grantee in ('anon', 'authenticated');
```

Expect **zero rows** for `anon`. Any row here is a stop condition — report before proceeding.

## 5. Rollback

Nothing depends on the column until the persist path is wired, so rollback is a plain drop:

```sql
alter table public.audits drop column if exists fingerprint;
```

Safe at any point before the writer ships. After the writer ships, dropping it stops fingerprints being
recorded but breaks nothing — every reader treats NULL as "no fingerprint" (pre-5.1a audits already do).

## 6. What is NOT in this migration, deliberately

- `pages.classification` and `audits.coverage` (SPEC 5.1 §12) — those belong to Stage 4, are not yet
  written by the engine, and adding a column before anything writes it invites a schema that does not
  match the eventual payload.
- The `frontier` table (§8) — Stage 5.
- Any RLS or grant change. If any future 5.1a migration needs one, it gets its own runbook and its own
  approval; this one must stay boring.
