# Runbook — SPEC 5.1a Stage 4 migration (owner-applied)

**Migration:** `infra/supabase/migrations/20260804000001_spec51a_stage4_refusal_coverage_fingerprint.sql`
**Project:** `ezspnfeyzwsisymytssm` · **Applied by:** owner · **Written by:** the build terminal
**Risk:** low — three additive nullable columns + two column-level grants. No backfill, no policy
change, no rewrite, no drops.

> **SUPERSEDES** `20260803000001_spec51a_crawl_fingerprint.sql` and its runbook, both **never applied**
> and both deleted in the same commit. Owner-ruled: one migration, applied once, not three times.
>
> **The superseded file's storage note was WRONG** — it claimed "~120 KB worst case" for the
> fingerprint by reasoning from the page cap. The real bound is the *pre-selection discovered set*.
> See §6.

Migrations are owner-applied only. This file is the exact SQL to approve, the rehearsal to run
**first**, the verification to run **after**, and the rollback statement.

---

## 1. Pre-flight — confirm the columns are absent

Expect **zero rows**:

```sql
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'audits'
  and column_name in ('refusal', 'coverage', 'fingerprint');
```

Verified zero rows for all three on **2026-08-04** via the Supabase MCP.

**Note on the migration ledger.** `list_migrations` reports its most recent entry as `20260707000005`,
yet `audits.ai_readiness` (from `20260708000001`) and the `pages.ai_signals` privilege change (from
`20260727000001`) are both live. The ledger under-reports what has actually been applied, so **trust
`information_schema`, not the ledger** — that is what the query above reads.

## 2. Rehearsal — transaction-rollback on live, run this FIRST

The org is on the Free plan, so there is no branch to rehearse against (branching needs Pro, ~$25/mo).
Use the txn-rollback-on-live rehearsal this project already uses for additive migrations: run the real
DDL inside a transaction, assert the post-state, then force a rollback so nothing persists.

**Expected outcome: `ERROR: REHEARSAL COMPLETE — rolling back deliberately`.** Any other error means
stop and report. Anything that *succeeds without erroring* also means stop — the rollback did not fire.

```sql
do $$
begin
  alter table public.audits
    add column if not exists refusal jsonb,
    add column if not exists coverage jsonb,
    add column if not exists fingerprint jsonb;

  -- All three present, jsonb, nullable.
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'audits'
         and column_name in ('refusal','coverage','fingerprint')
         and data_type = 'jsonb' and is_nullable = 'YES') <> 3 then
    raise exception 'REHEARSAL FAILED: expected 3 nullable jsonb columns';
  end if;

  -- Representative payloads must round-trip through jsonb.
  perform '{"refused":true,"triggers":["no_observed_links"],"confidenceCapped":false,"unevaluable":[]}'::jsonb;
  perform '{"fetched":550,"gradeable":496,"excluded":[{"kind":"archive","count":412}],
            "sitemapDeclared":821,"sitemapRobotsExcluded":0,
            "estimatedTotal":878,"estimateSource":"sitemap","coverageRatio":0.56}'::jsonb;
  perform '{"version":1,"discoveredCount":100684,"selectedCount":500,"digest":"abc",
            "strata":[{"templateKey":"/listing/{slug}","discovered":2000,"selected":445}],
            "seed":"cm-frontier-v1","strataTotal":4000,"strataWithheld":3900}'::jsonb;

  -- The grants are part of the change, so they are part of the rehearsal.
  execute 'grant select (refusal)  on public.audits to anon, authenticated';
  execute 'grant select (coverage) on public.audits to anon, authenticated';

  if not has_column_privilege('authenticated','public.audits','refusal','SELECT') then
    raise exception 'REHEARSAL FAILED: refusal grant did not take';
  end if;
  -- The one that must NOT be readable.
  if has_column_privilege('authenticated','public.audits','fingerprint','SELECT') then
    raise exception 'REHEARSAL FAILED: fingerprint is readable by authenticated';
  end if;
  if has_column_privilege('anon','public.audits','fingerprint','SELECT') then
    raise exception 'REHEARSAL FAILED: fingerprint is readable by anon';
  end if;

  raise exception 'REHEARSAL COMPLETE — rolling back deliberately';
end $$;
```

Confirm nothing persisted (expect **zero rows** again):

```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='audits'
  and column_name in ('refusal','coverage','fingerprint');
```

## 3. The SQL to approve

Apply the file verbatim:
`infra/supabase/migrations/20260804000001_spec51a_stage4_refusal_coverage_fingerprint.sql`

Its operative statements, in full — everything else in the file is commentary:

```sql
alter table public.audits
  add column if not exists refusal jsonb,
  add column if not exists coverage jsonb,
  add column if not exists fingerprint jsonb;

comment on column public.audits.refusal is '…';
comment on column public.audits.coverage is '…';
comment on column public.audits.fingerprint is '…';

grant select (refusal)  on public.audits to anon, authenticated;
grant select (coverage) on public.audits to anon, authenticated;
```

## 4. Verification — run after apply

### 4a. Shape

All three present, jsonb, nullable — expect **3 rows**:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema='public' and table_name='audits'
  and column_name in ('refusal','coverage','fingerprint')
order by column_name;
```

No backfill happened — expect **0, 0, 0**:

```sql
select count(refusal) as refusal_set,
       count(coverage) as coverage_set,
       count(fingerprint) as fingerprint_set
from public.audits;
```

### 4b. COLUMN PRIVILEGE — the required check

Every assertion below must hold. The first block is the new surface; the second proves nothing else
moved.

```sql
select
  -- INTENDED READABLE: user-facing by design.
  has_column_privilege('authenticated','public.audits','refusal','SELECT')      as authed_refusal,      -- true
  has_column_privilege('anon',         'public.audits','refusal','SELECT')      as anon_refusal,        -- true
  has_column_privilege('authenticated','public.audits','coverage','SELECT')     as authed_coverage,     -- true
  has_column_privilege('anon',         'public.audits','coverage','SELECT')     as anon_coverage,       -- true
  -- INTERNAL: must be UNREADABLE by both client roles.
  has_column_privilege('authenticated','public.audits','fingerprint','SELECT')  as authed_fingerprint,  -- FALSE
  has_column_privilege('anon',         'public.audits','fingerprint','SELECT')  as anon_fingerprint,    -- FALSE
  -- NO REGRESSION: the pre-existing posture is unchanged.
  has_table_privilege ('authenticated','public.audits','SELECT')                as authed_table_audits, -- false
  has_column_privilege('authenticated','public.audits','ai_readiness','SELECT') as authed_ai_readiness, -- false
  has_column_privilege('authenticated','public.audits','grade','SELECT')        as authed_grade,        -- true
  has_column_privilege('anon',         'public.audits','grade','SELECT')        as anon_grade,          -- true
  has_column_privilege('authenticated','public.pages','ai_signals','SELECT')    as authed_ai_signals;   -- false
```

**Expected:** `true, true, true, true, false, false, false, false, true, true, false`.

Also confirm no RLS policy moved — this migration creates, alters and drops none. Compare against the
pre-apply count:

```sql
select policyname, cmd from pg_policies
where schemaname='public' and tablename='audits' order by policyname;
```

### 4c. Live behaviour (after the next deploy, not now)

The worker only writes these columns on the v2 engine path. After a v2 audit completes:

```sql
select id, grade, score,
       refusal->>'refused'            as refused,
       refusal->'triggers'            as triggers,
       coverage->>'estimateSource'    as estimate_source,
       fingerprint->>'strataWithheld' as strata_withheld
from public.audits
where completed_at > now() - interval '1 hour'
order by completed_at desc limit 5;
```

> ⚠ **`sitemapUnreached` RESIDUE (gate 9 / FC-7).** This query used to select
> `coverage->>'sitemapUnreached'`, and the rehearsal payload above used to contain it. **D4 was CUT
> from 5.1a** (`packages/types/src/audit.ts:162` — *"USED TO LIVE HERE AND IS DELIBERATELY GONE"*), so
> nothing ever writes that key and the column would have read NULL on every audit forever — an
> operator would either rubber-stamp it or read it as a broken write path. Both are corrected here.
>
> **One residue is NOT corrected here and needs the owner.** Migration
> `20260804000001_…sql:21,111` documents the `coverage` shape as including `sitemapUnreached`, and that
> `comment on column` is **LIVE IN PRODUCTION** (read back via `col_description`). Applied migrations
> are never edited, and migrations are owner-applied only (§7), so fixing it needs a small follow-up
> migration that re-issues the `comment on column` without the key. Filed as
> `docs/tickets/2026-08-08-sitemap-unreached-column-comment.md`. It is documentation-only — no code
> reads the comment — so it is recorded rather than rushed.

A **refused** audit must show `grade` and `score` NULL with `refused = true` and a non-empty
`triggers` array. That pairing is the contract; either half alone is a defect.

## 5. Rollback

Restores the exact prior state. The grants disappear with the columns, so dropping is sufficient —
the explicit revokes are listed only for the case where the columns are kept but the grants are not.

```sql
-- Full rollback:
alter table public.audits
  drop column if exists refusal,
  drop column if exists coverage,
  drop column if exists fingerprint;

-- Grants only (if the columns are being kept):
revoke select (refusal)  on public.audits from anon, authenticated;
revoke select (coverage) on public.audits from anon, authenticated;
```

**Rollback is data-destructive for these three columns only** — everything written to them is lost.
Nothing else reads them, so no other feature degrades: the engine recomputes all three on every audit,
and every surface already treats them as optional (`undefined` on the v1 path).

> ### ⚠ CODE ROLLBACK HAZARD — read this before reverting the APPLICATION
>
> This is about rolling the **code** back to `main@69b039f`, not about the SQL above.
>
> **EVERY LINE BELOW WAS EXECUTED**, not reasoned about. `main@69b039f` was checked out in a worktree,
> its real `loadDashboardSites` and `deltaSentence` were driven with a graded predecessor (B/81.39)
> and a refused re-audit, and each candidate remedy was run through the same code. The first version
> of this section was written from a mental model and its recommended remedy did nothing — see B.
>
> **The hazard.** Once refused rows exist, reverting to pre-5.1a code makes the dashboard fabricate a
> decline it never measured. A refused audit stores `grade = NULL` / `score = NULL` — the point of the
> honesty gate. Pre-5.1a code has no concept of a refusal, so `toDeltaAudit` coerces those nulls
> unconditionally and renders a real previous grade against a fabricated zero.
>
> **The hazard grows with time**, proportional to refused rows written since merge, so a fast revert is
> materially safer than a slow one. Measured merge impact: **51 of 215 completed audits (23.7%) refuse**
> (gradeable-population basis — see `docs/OPERATING-RULES.md` §5).
>
> **Identify the affected rows** (no 5.1a code required, but this needs the `refusal` column to still
> exist — which is one reason not to drop it first):
>
> ```sql
> select count(*) from public.audits
>  where status = 'completed' and grade is null and refusal is not null;
> ```
>
> #### What each candidate remedy actually does — measured on `main@69b039f`
>
> | # | remedy | what main renders | verdict |
> |---|---|---|---|
> | A | *(do nothing)* | `scoreDelta -81.39` → **"Down 81 points since your last visit — worth a look"** | the hazard |
> | B | **drop the `refusal`/`coverage` columns** | `scoreDelta -81.39` → **identical** | ❌ **DOES NOTHING** |
> | C | **expire the refused rows** | the previous graded audit, B/81.39, "Holding steady" | ✅ **works** |
> | D | null `previous_audit_id` on refused rows | `grade ""`, `score 0`, "Holding steady" | ❌ trades one fabrication for another |
> | E | delete the refused rows | the previous graded audit, B/81.39 | ✅ works, destructive |
>
> **B was this document's recommended remedy and it is wrong.** `main@69b039f:apps/web/lib/dashboard.ts`
> never selects `refusal` — `git grep -c refusal 69b039f -- apps/web` returns one unrelated hit — so the
> row main reads is byte-identical with or without the columns. Dropping them also destroys the
> identification query above. **Do not drop the columns as a rollback remedy.**
>
> **D is not acceptable** even though it removes the `-81`: it leaves an empty grade and a score of 0 on
> the card and says "Holding steady" about a verdict that was never issued. A quieter fabrication is
> still a fabrication.
>
> #### THE REMEDY: expire the refused rows, then roll the code back
>
> ```sql
> -- Excludes them from the pre-5.1a dashboard window, which filters
> -- `expires_at.is.null,expires_at.gt.<now>` server-side. Non-destructive.
> update public.audits
>    set expires_at = now() - interval '1 second'
>  where status = 'completed' and grade is null and refusal is not null;
> ```
>
> ⚠ **TWO WAYS THIS BITES. READ BOTH BEFORE RUNNING IT.**
>
> **(1) Pause the TTL cleanup cron, or C becomes E.** `deleteExpiredAudits`
> (`inngest/billing-helpers.ts:218`) selects `expires_at <= now()` and DELETES, so once the daily
> cleanup runs these rows are gone.
>
> **(2) ⚠ THE UNDO IS NOT A RESTORE, AND THIS SECTION PREVIOUSLY SAID IT WAS.** The roll-forward used
> to read `set expires_at = null`, described as "non-destructive and reversible". It is not: `null`
> means *never expires*, and **free/anonymous audits do not start that way** —
> `apps/web/app/api/audits/start/route.ts:97` writes `expiresAt = proUser ? null : now + AUDIT_TTL_DAYS`.
> Measured live 2026-08-08: **190 of 212 completed audits carry a non-null `expires_at`**. Nulling them
> would permanently exempt those rows from TTL cleanup — voiding the 30-day retention promise and the
> ≤18%-MRR cost control, and landing them in the state already filed as
> `docs/tickets/2026-08-06-expired-audits-null-expiry-never-deleted.md` (22 such rows exist today).
>
> **So snapshot the prior values first.** Non-destructive only if you do:
>
> ```sql
> -- BEFORE remedy C — capture what you are about to overwrite.
> create table if not exists public._rollback_expiry_backup as
> select id, expires_at from public.audits
>  where status = 'completed' and grade is null and refusal is not null;
> ```
>
> ```sql
> -- ROLL-FORWARD — restore each row's own prior value, not a blanket null.
> update public.audits a
>    set expires_at = b.expires_at
>   from public._rollback_expiry_backup b
>  where a.id = b.id;
> drop table public._rollback_expiry_backup;
> ```
>
> **If you skip the snapshot, remedy C is ONE-WAY.** State that to whoever authorises the rollback
> rather than discovering it afterwards.
>
> **Do not roll the code back and leave refused rows readable.**

## 6. Storage — measured against the ≤18%-MRR ceiling

Anchors measured live **2026-08-04**: 231 audit rows · `audits` relation 904 kB · database 226 MB ·
avg `confidence_band` 231 B · avg `ai_readiness` 13.3 kB (max 30.7 kB).

| column | size | basis |
|---|---|---|
| `refusal` | ~150–250 B | shape comparable to `confidence_band` |
| `coverage` | ~300–500 B | scalars + at most 9 `PageKind` exclusion rows |
| `fingerprint` | **~34 kB worst case on disk** (bounded) | 100 strata × 256 B cap; typical ~1–2 kB |

> ⚠ **THIS ROW READ "~6.5 kB worst case (bounded) — 100 strata × ~60 B", AND THAT FIGURE IS WITHDRAWN.**
> It assumed ~60-byte keys. Intermediate URL segments are kept literal, so a crawled key can be far
> longer; a per-string 256-byte cap was added at the persist boundary, and the honest post-cap worst
> case is **~57 kB on the wire** or **~34 kB on disk** — measured on two *different* hostile payloads
> (quote-maximal maximises the wire and compresses to ~1 kB on disk; high-entropy maximises disk at
> ~34 kB and is ~31 kB on the wire). JSON escaping doubles `"` and `\`, which the UTF-8 byte budget
> does not count. Registered in `apps/web/__tests__/docs-withdrawn-claims.test.ts`, which is what
> surfaced this file: the withdrawal named only the migration SQL, and there were two documents.
> Typical sites are unaffected — the cap binds only on pathological keys.

**Worst case ≈ 35 kB per completed audit; typical ≈ 1.5–2.5 kB.** No backfill, so day-one cost is
**zero**. Free audits ride the existing 30-day TTL cleanup, so this is steady state, not cumulative:
at 10 000 completed audits/month the ceiling is **~350 MB worst case** (typical ~20 MB) against a
226 MB database — the worst case assumes every audit is hostile, which no observed audit is. Comfortably
inside the ceiling, and it adds no new storage lifecycle.

### The bound is load-bearing — and it is why the superseded note was wrong

The fingerprint's strata table is one row per distinct `templateKey` and was **unbounded**. Its size
tracks `discoveredCount` — the **pre-selection** discovered set, which the page cap does not bound.

Measured on the live corpus: **max `discovered_count` = 100 684**. A site whose URLs share no path
structure would have written **~6 MB of jsonb onto a single audit row**, and ~60 GB/month at 10 000
audits. The superseded migration's "~120 KB worst case" reasoned from the page cap and was wrong by
roughly **50×**.

`boundFingerprintForPersist` (`inngest/persist-helpers.ts`) closes it, mirroring
`boundAiReadinessForPersist`: cap at `FINGERPRINT_PERSIST_MAX_STRATA = 100`, keep the **largest**
strata (the sections a delta is actually attributed to), record `strataTotal` / `strataWithheld` so the
truncation is never silent, and **never touch `digest`** — which is computed over the selected URL set,
not this table, so determinism is unaffected by construction. The engine's in-memory fingerprint stays
complete for the backtest harness; only the stored copy is capped.

## 7. After apply — what unblocks

Wiring the five approved trigger-specific refusal copy bodies at the single
`NO_GRADE_EXPLANATION` seam in `apps/web/lib/refusal-copy.ts`. Until `refusal.triggers` is persisted
they cannot be selected, and they must **not** be re-derived from
`confidence` / `fetched_ok_count` / `partial` — that would be a second hand-synchronised copy of
`decideRefusal`. One call site, not thirteen.
