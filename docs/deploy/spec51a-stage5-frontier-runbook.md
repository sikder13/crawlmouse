# Runbook — SPEC 5.1a Stage 5 frontier checkpoint (owner-applied)

**Migration:** `infra/supabase/migrations/20260805000001_spec51a_stage5_frontier_checkpoint.sql`
**Project:** `ezspnfeyzwsisymytssm` · **Applied by:** owner · **Written by:** the build terminal
**Risk:** low — two NEW tables. No existing table altered, no policy created/changed/widened, no
backfill, no rewrite, no data touched.

> **Its own migration, not bundled with Stage 6** — owner-ruled. The one-apply rule was about not
> splitting one logical change across three files, not about deferring separate changes to close-out.

Migrations are owner-applied only. This is the SQL to approve, the rehearsal to run **first**, the
verification to run **after**, and the rollback.

---

## 1. Pre-flight — confirm the tables are absent

Expect **zero rows**:

```sql
select table_name from information_schema.tables
where table_schema = 'public' and table_name in ('frontier', 'frontier_politeness');
```

## 2. Rehearsal — transaction-rollback on live, run this FIRST

Free plan, so no branch to rehearse against. Same txn-rollback-on-live pattern as the Stage 4
migration: run the real DDL in a transaction, assert the post-state, force a rollback.

**Expected outcome: `ERROR: REHEARSAL COMPLETE — rolling back deliberately`.** Any other error, or a
success with no error, means stop and report.

```sql
do $$
declare
  test_audit uuid;
begin
  create table public.frontier (
    audit_id uuid not null references public.audits(id) on delete cascade,
    url_hash text not null,
    url text not null,
    template_key text not null,
    sample_key text not null,
    depth integer not null,
    state text not null default 'discovered'
      check (state in ('discovered','claimed','fetched','failed','skipped')),
    source text not null check (source in ('homepage','sitemap','link')),
    claimed_at timestamptz,
    updated_at timestamptz not null default now(),
    primary key (audit_id, url_hash)
  );
  create index frontier_audit_state_idx on public.frontier (audit_id, state);
  alter table public.frontier enable row level security;

  -- A real row must round-trip, and the CHECK constraints must actually bite.
  select id into test_audit from public.audits limit 1;
  if test_audit is null then raise exception 'REHEARSAL FAILED: no audit row to reference'; end if;

  insert into public.frontier (audit_id, url_hash, url, template_key, sample_key, depth, source)
  values (test_audit, repeat('a', 64), 'https://x.test/', '/{slug}', repeat('b', 64), 0, 'homepage');

  begin
    insert into public.frontier (audit_id, url_hash, url, template_key, sample_key, depth, source, state)
    values (test_audit, repeat('c', 64), 'https://x.test/z', '/{slug}', repeat('d', 64), 1, 'link', 'bogus');
    raise exception 'REHEARSAL FAILED: the state CHECK did not reject an invalid value';
  exception when check_violation then null;  -- expected
  end;

  -- FOR UPDATE SKIP LOCKED must parse and run against the real table.
  perform * from public.frontier
   where audit_id = test_audit and state = 'discovered'
   order by sample_key
   limit 1
   for update skip locked;

  raise exception 'REHEARSAL COMPLETE — rolling back deliberately';
end $$;
```

Confirm nothing persisted (expect **zero rows**):

```sql
select table_name from information_schema.tables
where table_schema='public' and table_name in ('frontier','frontier_politeness');
```

## 3. The SQL to approve

Apply the file verbatim:
`infra/supabase/migrations/20260805000001_spec51a_stage5_frontier_checkpoint.sql`

Two `create table if not exists`, one index, two `comment on`, two `enable row level security`, two
`revoke all`. Everything else in the file is commentary.

## 4. Verification — run after apply

### 4a. Shape

```sql
select table_name from information_schema.tables
where table_schema='public' and table_name in ('frontier','frontier_politeness')
order by table_name;                                            -- expect 2 rows

select indexname from pg_indexes
where schemaname='public' and tablename='frontier' order by indexname;
-- expect frontier_pkey AND frontier_audit_state_idx

select relname, relrowsecurity from pg_class
where relname in ('frontier','frontier_politeness');             -- relrowsecurity = true for both

select count(*) as should_be_zero from public.frontier;          -- 0, no backfill
```

Cascade is wired (this is what makes the TTL story work without a new cron):

```sql
select tc.table_name, rc.delete_rule
from information_schema.table_constraints tc
join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name
where tc.constraint_type='FOREIGN KEY' and tc.table_schema='public'
  and tc.table_name in ('frontier','frontier_politeness');       -- both CASCADE
```

### 4b. Privilege — internal only

Unlike the Stage 4 columns, **nothing here is client-readable.** Every assertion must be false:

```sql
select
  has_table_privilege('anon',         'public.frontier','SELECT')             as anon_frontier,
  has_table_privilege('authenticated','public.frontier','SELECT')             as authed_frontier,
  has_table_privilege('anon',         'public.frontier_politeness','SELECT')  as anon_politeness,
  has_table_privilege('authenticated','public.frontier_politeness','SELECT')  as authed_politeness,
  has_table_privilege('service_role', 'public.frontier','SELECT')             as service_frontier;
```

**Expected:** `false, false, false, false, true`.

RLS is enabled with **no policies**, which denies every non-service role outright — confirm there are
none, so a future policy addition is a visible change rather than a silent one:

```sql
select count(*) as should_be_zero from pg_policies
where schemaname='public' and tablename in ('frontier','frontier_politeness');
```

## 5. Rollback

```sql
drop table if exists public.frontier_politeness;
drop table if exists public.frontier;
```

Non-destructive to anything else: no existing table is touched, and nothing outside the worker reads
these. A crawl interrupted mid-flight after a rollback restarts instead of resuming — the pre-Stage-5
behaviour.

## 6. Storage — measured, and the retention answer

**The retention question, answered explicitly: frontier rows are TRANSIENT working state and are NOT
kept for the audit's 30-day TTL.** They are deleted when the crawl completes, and cascaded if the
audit is deleted. **No new cleanup cron is needed** — that is the point of doing it this way.

That is a measurement, not a preference. Had the frontier existed for the corpus so far it would hold
**602 149 rows ≈ 300 MB — larger than the entire 226 MB database.**

Anchor derived from a real row-per-URL table rather than guessed: `public.pages` holds **41 228 rows
in 24 428 544 B = 593 B/row** (heap 13.1 MB + indexes 11.0 MB; indexes are ~45% of the total). Average
URL 65 chars, max 409. A frontier row has fewer columns but adds `sample_key` + `template_key` and
carries two indexes → **~500 B/row including indexes.**

| case | discovered | frontier size |
|---|---|---|
| typical (mean) | 2 909 | ~1.5 MB |
| p95 | 3 858 | ~1.9 MB |
| **worst measured** | **100 684** | **~50 MB for ONE audit** |

Because the rows are transient, steady state is bounded by **concurrent crawls, not corpus size**. At
`INNGEST_AUDIT_CONCURRENCY = 5`: typical **~8 MB**, pathological ceiling **~250 MB** if five worst-case
sites ran simultaneously — transient and self-clearing, but real, and recorded rather than smoothed.

### ⚠ Watch-item carried forward, deliberately not fixed here

The 100 684-URL case is bounded only by discovery. The two honest options are to cap **discovery** (a
crawl-integrity change that moves grades → 5.1b) or to truncate the persisted basis.

**Truncating the basis is not done.** `resumeSelection` selects over the COMPLETE discovered set, and
shrinking it is exactly the naive-resume defect Stage 5's B6 exists to catch — measured on the fixture
as digest `b6860ec…` against the straight-through `d64233f…`. Breaking the acceptance criterion to save
disk would be the wrong trade made quietly.

## 7. After apply — what unblocks

Wiring the SQL-backed `FrontierStore` (the interface is already defined and unit-tested in
`packages/engine/src/analysis/frontier-checkpoint.ts`) into the crawl path: `upsertDiscovered` on
discovery, `claim` via `FOR UPDATE SKIP LOCKED`, `settle` on each fetch outcome, and the explicit
delete at completion. The engine stays DB-free — the store is injected by the worker.
