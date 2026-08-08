# `audits.coverage` column comment still documents `sitemapUnreached`, which D4 cut

**Filed:** 2026-08-08 · **Source:** SPEC 5.1a gate 9, FC-7 · **Severity:** low (documentation-only)
**Status:** open — **needs a small owner-applied migration**

## What is wrong

`infra/supabase/migrations/20260804000001_spec51a_stage4_refusal_coverage_fingerprint.sql` documents
the `coverage` jsonb shape as including `sitemapUnreached`, at line 21 (a file comment) and line 111
(a `comment on column`, which is **live in production** and readable via `col_description`).

**D4 was cut from 5.1a.** `packages/types/src/audit.ts:162` says so explicitly — *"`sitemapUnreached`
USED TO LIVE HERE AND IS DELIBERATELY GONE"* — and nothing writes the key. So the production database
documents a field that no audit will ever carry.

## Why it is not fixed in place

Applied migrations are never edited — the file records what ran. And migrations are **owner-applied
only**, via runbook, with the exact SQL approved and dry-run first (`OPERATING-RULES` §7). So this
needs a small follow-up migration rather than a file edit.

## The fix, when it is scheduled

One statement, re-issuing the comment without the dead key. It touches no data, no privileges and no
schema — only `pg_description`.

```sql
comment on column public.audits.coverage is
  '§7 coverage accounting: {fetched, gradeable, excluded[], sitemapDeclared, '
  'sitemapRobotsExcluded, estimatedTotal, estimateSource, coverageRatio}. '
  'sitemapUnreached was removed with D4 and is never written.';
```

Verify with:

```sql
select col_description('public.audits'::regclass,
         (select attnum from pg_attribute
           where attrelid = 'public.audits'::regclass and attname = 'coverage'));
```

## Already corrected without a migration

`docs/deploy/spec51a-stage4-migration-runbook.md` — §4c's post-apply query no longer selects
`coverage->>'sitemapUnreached'` (it would have read NULL on every audit forever), and the §2 rehearsal
payload no longer contains the key.

## Related

- `evidence/2026-08-08-gate9-reports.md` — FC-7, where this was found.
- `docs/tickets/2026-08-06-spec51-stage-numbering-inconsistency.md` — same family (D4-cut residue).
