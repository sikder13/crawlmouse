# SPEC 05 — Stage 4 migration runbook (owner-applied)

**File:** `infra/supabase/migrations/20260708000001_spec05_ai_readiness.sql`
**Applies to:** Supabase project `ezspnfeyzwsisymytssm` (prod).
**Written by Terminal 2; APPLIED BY THE OWNER** (never autonomous — SPEC 04 precedent / CLAUDE.md §9).
**Risk: LOW.** Two additive NULLABLE `jsonb` columns, `add column if not exists`, no drops, no type
changes, no backfill, no CHECK, no default → metadata-only on PG15 (no table rewrite), RLS untouched.
Confirmed via the Supabase MCP (2026-07-08): neither column exists yet.

## What it does
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
