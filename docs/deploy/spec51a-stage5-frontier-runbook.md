# Runbook — SPEC 5.1a Stage 5 frontier checkpoint (owner-applied)

**Migration:** `infra/supabase/migrations/20260805000001_spec51a_stage5_frontier_checkpoint.sql`
**Project:** `ezspnfeyzwsisymytssm` · **Applied by:** owner · **Written by:** the build terminal
**Risk:** low — two NEW tables. No existing table altered, no policy created/changed/widened, no
backfill, no rewrite, no data touched.

> **Its own migration, not bundled with Stage 6** — owner-ruled.
>
> **Two owner items resolved:** the retention hole is closed by an age-based orphan sweep (§6), and the
> discovery cap is **STOPPED and handed back** because it moves grades on every site that hits it (§8).

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

Two `create table if not exists`, **two** indexes on `frontier` (`(audit_id, state)` for the claim,
`updated_at` for the orphan sweep), three `comment on`, two `enable row level security`, two
`revoke all`. Everything else in the file is commentary.

## 4. Verification — run after apply

### 4a. Shape

```sql
select table_name from information_schema.tables
where table_schema='public' and table_name in ('frontier','frontier_politeness')
order by table_name;                                            -- expect 2 rows

select indexname from pg_indexes
where schemaname='public' and tablename='frontier' order by indexname;
-- expect frontier_pkey, frontier_audit_state_idx AND frontier_updated_at_idx (the sweep's)

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

## 6. Retention — the answer, including every non-happy path

**Frontier rows are TRANSIENT working state and are NOT kept for the audit's 30-day TTL.** Three
mechanisms, and the third exists because the first two cover only the happy path.

| # | mechanism | covers |
|---|---|---|
| 1 | explicit delete at completion (worker) | a crawl that finishes |
| 2 | `on delete cascade` | an audit the TTL cron actually deletes |
| 3 | **orphan sweep, by AGE** (new) | **everything else** |

### Why 1 + 2 were not enough — measured live, 2026-08-06

`deleteExpiredAudits` filters on **`expires_at <= now` and nothing else.** An audit whose `expires_at`
is NULL is therefore never deleted, so its cascade **never fires**. Live counts:

| status | rows | with `expires_at` NULL | note |
|---|---|---|---|
| completed | 214 | **20** | never TTL'd → cascade never fires |
| failed | 7 | 0 | row survives; only the 30-day TTL removes it |
| pending | 7 | 0 | **oldest started 2026-07-08 — ~29 days stuck** |
| canceled | 5 | **2** | never TTL'd → cascade never fires |

So the uncovered set is: **failed audits, cancelled audits, any audit with no expiry at all, and any
crawl whose worker died mid-flight.** Those rows would have lived 30 days — or forever. That is
precisely the ~300 MB shape the transient-rows design exists to avoid, arriving through the back door.

### The sweep

`deleteOrphanFrontierRows` (`inngest/billing-helpers.ts`), riding the **existing daily cron** as its
own step — **no new schedule**. It runs *before* the audit sweep so that an Inngest step retry on the
frontier can never abort the TTL sweep, which is the load-bearing one.

The rule is **self-contained and says nothing about audit status or TTL**: delete any frontier row
untouched for `FRONTIER_ORPHAN_TTL_HOURS = 24`. A crawl cannot meaningfully outlive its wall-clock
budget (240 s default, 260 s clamp), so 24 h is ~360× the budget — it cannot truncate a live crawl even
with retries and queueing, and it covers every way a crawl can die with **one predicate instead of one
branch per failure mode**. Bounded and batched exactly like the audit sweep.

Verify after apply (expect 0 once a day has passed with no in-flight crawls older than 24 h):

```sql
select count(*) as orphaned_rows
from public.frontier
where updated_at < now() - interval '24 hours';
```

## 7. Storage — measured

Anchor derived from a real row-per-URL table rather than estimated: `public.pages` holds **41 228 rows
in 24 428 544 B = 593 B/row** (heap 13.1 MB + indexes 11.0 MB; indexes ~45%). Average URL 65 chars,
max 409. A frontier row has fewer columns but adds `sample_key` + `template_key` and carries **three**
indexes (PK, `(audit_id, state)`, `updated_at`) → **~500 B/row**.

| case | discovered | frontier size |
|---|---|---|
| typical (mean) | 2 909 | ~1.5 MB |
| p95 | 3 539 | ~1.8 MB |
| **worst measured** | **100 684** | **~50 MB for ONE audit** |

Because the rows are transient, steady state is bounded by **concurrent crawls, not corpus size**: at
`INNGEST_AUDIT_CONCURRENCY = 5`, typical **~8 MB**, pathological ceiling **~250 MB** — transient and
self-clearing, but real.

## 8. ⛔ THE DISCOVERY CAP — STOPPED, and why

**You ruled: cap discovery, record it in the fingerprint, and STOP if it moves grades on any panel
site. It moves grades. So this is stopped and handed back.**

The mechanism is built and unit-tested, but **it is NOT wired into the crawl path and this migration
does not depend on it.**

### What was built

`capDiscovered` keeps the `MAX_DISCOVERED_URLS` records with the **smallest sample key** — the same
Efraimidis–Spirakis min-k mechanism §6.4 already uses. A naive "stop discovering at N" cap was
rejected outright: it keeps whichever URLs arrived first, and **arrival order is a forbidden input
(§6.6)** — it is concurrency and host latency wearing a hat, so two runs would keep different prefixes.
The cap is self-declaring via `discoveryCapped: true` / `discoveredAtCap: N`, absent (never `false`)
when uncapped so an old fingerprint cannot masquerade as a capped one.

### The proposed value, and why it is insensitive

`MAX_DISCOVERED_URLS = 25 000`. Distribution over the 208 live audits carrying a discovered count:

| p50 | p90 | p95 | p99 | max |
|---|---|---|---|---|
| 79 | 2 098 | 3 539 | 100 236 | 100 684 |

The corpus is **bimodal**: 202 audits under 12 000, five between 88 583 and 100 684, and the band
**11 487 … 88 582 is empty.** Every cap between 12 000 and 88 000 therefore affects **exactly the same
five audits** — the same "insensitive, not tuned" argument the grading floor uses. 25 000 is ~7× p95.

### Why it is STOPPED — the measurement

The five audits that would hit it are **all Wikipedia** (`ru.wikipedia.org` ×4, `ar.wikipedia.org` ×1),
all already `partial: true`, `confidence: low`, coverage **0.40–0.49 %**.

Wikipedia's URLs template to `/wiki/{article}` — **one stratum per article.** Measured impact of
capping on that shape:

| shape | strata | selection overlap after cap (budget 500) |
|---|---|---|
| one stratum | 1 | **500/500 — unchanged** |
| forty even strata | 40 | **500/500 — unchanged** |
| two lopsided strata | 2 | 346/500 |
| long tail | 101 | 206/500 |
| **one stratum per URL (Wikipedia's shape)** | **5 000** | **111/500 — ~78 % of the sample replaced** |

So the cap is selection-preserving when each stratum keeps at least what selection draws from it, and
**grade-moving when a global smallest-key cut wipes out whole strata** — which is exactly what happens
on the only sites that hit it.

**Per your rule, that makes it 5.1b work, not a Stage 5 storage guard.** Two further facts for that
decision: those sites are *already* non-reproducible — four runs of `https://ru.wikipedia.org/`
discovered 100 684 / 100 576 / 100 236 / 100 152 URLs and scored 83.82 / 83.76 / 83.66 / 83.65 — and
the storage problem is solved without the cap by §6's sweep, at a transient ceiling rather than a
permanent one.

## 9. After apply — what unblocks

Wiring the SQL-backed `FrontierStore` (the interface is already defined and unit-tested in
`packages/engine/src/analysis/frontier-checkpoint.ts`) into the crawl path: `upsertDiscovered` on
discovery, `claim` via `FOR UPDATE SKIP LOCKED`, `settle` on each fetch outcome, and the explicit
delete at completion. The engine stays DB-free — the store is injected by the worker.
