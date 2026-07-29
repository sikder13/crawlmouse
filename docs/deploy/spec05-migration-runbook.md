# SPEC 05 — migration runbook (owner-applied)

Two migrations, in this order:

| # | Migration | Status | Gate |
|---|---|---|---|
| A | `20260708000001_spec05_ai_readiness.sql` | **APPLIED** 2026-07-08 | — |
| B | `20260727000001_spec05_pages_ai_signals_privilege.sql` | **APPLIED + VERIFIED 2026-07-29** | merge gate **SATISFIED** — re-verify on merge day |

> ## ✅ ORDERING CONSTRAINT — SATISFIED 2026-07-29
>
> **Migration B was applied to production BEFORE merge and before any `AI_READINESS_EXTRACTION=1`.**
> Owner-applied; independently re-verified read-only against `ezspnfeyzwsisymytssm`:
>
> ```
> has_column_privilege('authenticated','public.pages','ai_signals','SELECT')  = false   ✅
> has_column_privilege('anon',         'public.pages','ai_signals','SELECT')  = false   ✅
> has_column_privilege('authenticated','public.pages','url','SELECT')         = true    ✅
> has_column_privilege('anon',         'public.pages','url','SELECT')         = true    ✅
> has_column_privilege('service_role', 'public.pages','ai_signals','SELECT')  = true    ✅
> table-level SELECT grants to anon/authenticated on public.pages             = 0       ✅
> column-level SELECT grants to authenticated on public.pages                 = 13      ✅ (matches rehearsal)
> ```
>
> The `anon`/`url` check was added after a reviewer noted the original three could all pass while
> `anon` had been silently dropped from the re-grant. It passes. App verified working post-change.
>
> **The migration file stays in the repo and is idempotent**, so history is complete and merge day is
> a RE-VERIFICATION, not an application. Re-run the block above on merge day and confirm the same
> seven values before enabling extraction.
>
> Original rationale, retained: prod held no `ai_signals` data (the branch was unmerged), so the
> paywall bypass was not exploitable until extraction began writing — merging without B would have
> shipped the hole open, timed to spring on the canary flip.

---

# Part A — Stage 4 additive columns (APPLIED 2026-07-08)

**File:** `infra/supabase/migrations/20260708000001_spec05_ai_readiness.sql`
**Applies to:** Supabase project `ezspnfeyzwsisymytssm` (prod).
**Written by Terminal 2; APPLIED BY THE OWNER** (never autonomous — SPEC 04 precedent / CLAUDE.md §9).
**Risk: LOW.** Two additive NULLABLE `jsonb` columns, `add column if not exists`, no drops, no type
changes, no backfill, no CHECK, no default → metadata-only on PG15 (no table rewrite), RLS untouched.
Confirmed via the Supabase MCP (2026-07-08): neither column exists yet.

## What it does
**Sizing (corrected 2026-07-28).** The original estimate of "~2KB/page ⇒ ≤ ~1.2MB per 500-page audit"
counted UTF-16 code units, not the UTF-8 bytes Postgres stores — understating non-Latin pages by ~3x
(a Chinese-language page measured 12 947 bytes/row). All caps are now UTF-8 **byte** budgets, and the
measured worst case is **≤ 8.7 KB per page**: 4.5 KB for ASCII, CJK and astral text, and **8.7 KB**
for quote/backslash-dense text, which `JSON.stringify` renders as two bytes per character (1.89x, and
missed by two earlier estimates whose fixtures pinned the character class to `'X'`). That is **≤ 4.4
MB** per 500-page audit and **≤ 17.5 MB** at PRO_PAGE_CAP. The `pages` insert is additionally chunked
(`PAGE_INSERT_CHUNK = 250`), so no single request body scales with the page cap.

```sql
alter table public.pages   add column if not exists ai_signals   jsonb;  -- PageAiSignals payload (§4)
alter table public.audits  add column if not exists ai_readiness jsonb;  -- AiReadinessScore (§7)
```
Mirrors the `audits.confidence_band jsonb` precedent (`20260629000001`) and the additive-nullable posture of
the crawl-health migration (`20260617000001`). `public_reports` (frozen-at-mint) is intentionally NOT touched.

## Step 1 — Dry-run rehearsal (optional, org is Free so no branching)
A transaction-rollback rehearsal proves the DDL parses + applies cleanly with zero persistence:
```sql
do $$
begin
  alter table public.pages   add column if not exists ai_signals   jsonb;
  alter table public.audits  add column if not exists ai_readiness jsonb;
  raise exception 'ROLLBACK REHEARSAL OK — migration parses + applies; nothing persisted';
end $$;
```
Expect: it errors with `ROLLBACK REHEARSAL OK …` (the RAISE forces a rollback of the whole DO block). Any
OTHER error means stop and investigate.

## Step 2 — Apply (owner)
Apply via the Supabase MCP `apply_migration`:
- **name:** `20260708000001_spec05_ai_readiness`
- **query:** the contents of `infra/supabase/migrations/20260708000001_spec05_ai_readiness.sql`

(Or run the two `alter table … add column if not exists …` statements directly in the SQL editor.)

## Step 3 — Post-apply verification (Terminal 2 runs these via MCP once you confirm applied)
1. Columns exist + nullable:
   ```sql
   select table_name, column_name, data_type, is_nullable from information_schema.columns
   where table_schema='public' and ((table_name='pages' and column_name='ai_signals')
     or (table_name='audits' and column_name='ai_readiness'));
   ```
   Expect: both rows, `jsonb`, `is_nullable = YES`.
2. **RLS deny-by-default intact (A12):** confirm `pages`/`audits` still have `rowsecurity = true` and NO new
   policy was added; the new columns are reachable ONLY through the existing capability/owner read paths
   (no `user_id` on the wire). I'll verify `pg_policies` + `pg_class.relrowsecurity` are unchanged.

## After apply — Terminal 2 resumes Stage 4
Persistence (`inngest/persist-helpers.ts` `buildPageRows` → `pages.ai_signals`; `inngest/persist-results.ts`
→ `audits.ai_readiness`) + projection gating in `projectAuditForClient` (FREE: score+ledger+matrix+
homepageView; Pro-owner GATED: whatAiSees + on-demand aiPackets via `canUseActionPackets`, D4 — never
persisted) + tests A11 (gating security) / A12 (RLS). This all lands AFTER the columns exist.

## Rollback
Additive + nullable → safe to leave in place even if the feature is disabled (columns stay NULL). If a hard
revert is ever needed: `alter table public.pages drop column if exists ai_signals;` /
`alter table public.audits drop column if exists ai_readiness;` (only when no code reads them).

---

# Part B — `pages.ai_signals` column privilege (MERGE GATE, NOT YET APPLIED)

**File:** `infra/supabase/migrations/20260727000001_spec05_pages_ai_signals_privilege.sql`
**Applies to:** Supabase project `ezspnfeyzwsisymytssm` (prod).
**Written by Terminal 2; APPLIED BY THE OWNER.**
**Risk: LOW–MEDIUM.** No DDL, no data change: a `REVOKE` + re-`GRANT` of SELECT on an explicit column
list. Idempotent (confirmed across two rehearsal runs). Reversible in one statement.

## Why it is a merge gate

`20260707000003_spec04_column_privilege_hardening` converted `audits` and `public_reports` to explicit
column-grant lists, so when SPEC 05 added `audits.ai_readiness` it correctly inherited **no** client
grant. `pages` was never converted, so it still carries Supabase's default **table-level** SELECT grant
to `anon`/`authenticated` — and `ai_signals` inherited it. Verified live on prod:

```
has_column_privilege('authenticated','public.pages','ai_signals','SELECT')   = true    ← the defect
has_column_privilege('anon',         'public.pages','ai_signals','SELECT')   = true    ← the defect
has_column_privilege('authenticated','public.audits','ai_readiness','SELECT')= false   ← correct, via SPEC 04
```

A signed-in **free owner** can therefore bypass the Pro `whatAiSees` gate with a direct PostgREST read:
`GET /rest/v1/pages?audit_id=eq.<their own audit>&select=url,ai_signals`.

**Scope, stated honestly:** RLS (`pages_via_audit` → `audits.user_id = auth.uid()`) still scopes rows to
that user's own audits, and `anon` reads **0 rows**. This is **paywall integrity, not cross-tenant
exposure** — the data is the owner's own site's public text. It is a merge gate because shipping it open
is a decision, not because it is a confidentiality breach.

**Why the naive form is inert:** Postgres computes effective column access as the UNION of table- and
column-level grants, so a bare `REVOKE SELECT (ai_signals)` does **nothing** while the table grant
stands. A round-1 bare column REVOKE once shipped inert on this very repo, which is why
`apps/web/__tests__/spec04-column-privilege-guard.test.ts` exists. The only correct form — the idiom
`20260707000003` already uses — is REVOKE the table grant, then GRANT back an explicit column list that
excludes the sensitive column, generated from `information_schema` **at apply time** so no column is
missed.

## Step 1 — Dry-run rehearsal (org is Free, so no branching)

Two independent reviewers each ran this transaction-rollback rehearsal against the live DB and confirmed:
13/14 columns re-granted, `authenticated`/`anon` `ai_signals` → false, `url` → true, `service_role`
untouched and not lockout-able, idempotent across two runs.

```sql
begin;
  \i infra/supabase/migrations/20260727000001_spec05_pages_ai_signals_privilege.sql
  select has_column_privilege('authenticated','public.pages','ai_signals','SELECT') as auth_ai_signals,
         has_column_privilege('anon',         'public.pages','ai_signals','SELECT') as anon_ai_signals,
         has_column_privilege('authenticated','public.pages','url','SELECT')        as auth_url,
         has_column_privilege('service_role', 'public.pages','ai_signals','SELECT') as svc_ai_signals;
rollback;
```
Expect `false, false, true, true`. Anything else: stop and investigate.

## Step 2 — Apply (owner)

Supabase MCP `apply_migration`:
- **name:** `20260727000001_spec05_pages_ai_signals_privilege`
- **query:** the contents of the file above

## Step 3 — Post-apply verification (THE THREE CHECKS — all must pass before merge)

```sql
select has_column_privilege('authenticated','public.pages','ai_signals','SELECT');  -- MUST be false
select has_column_privilege('anon',         'public.pages','ai_signals','SELECT');  -- MUST be false
select has_column_privilege('authenticated','public.pages','url','SELECT');         -- MUST be true
```

The third is not a formality: it is what proves the re-grant actually happened rather than the REVOKE
landing alone and silently breaking every client read of `pages`.

Also confirm service-role is unaffected (the app's own reads are all service-role — `stream/route.ts`,
`llms-txt/route.ts`, `export/route.ts`, `mint-snapshot.ts`, `persist-results.ts`):
```sql
select has_column_privilege('service_role','public.pages','ai_signals','SELECT');   -- MUST be true
```

## Deny-by-default consequence (carry forward)

After this runs, a **future** column on `pages` is **not** auto-granted to `anon`/`authenticated`. Any
later migration that needs one client-readable must `GRANT SELECT (newcol)` explicitly. That is the
intended posture — it is exactly what made `audits.ai_readiness` safe by default.

## Rollback

```sql
grant select on public.pages to anon, authenticated;   -- restores the prior, more permissive state
```
Note this restores the bypass, so pair it with `AI_READINESS_EXTRACTION=0` + a redeploy.
