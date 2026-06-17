-- SPEC 01 v2 §6/§7 — additive crawl-health & node-eligibility columns for ENGINE_V2.
-- Purely additive + backward-compatible: new nullable columns only, no drops, no type
-- changes, no backfill that rewrites existing rows. Existing audits/pages keep their values;
-- v1 (ENGINE_V2 off) writes NULL for the crawl-health columns, so prod is unchanged until the
-- flag flips (Task 12). public_reports (minted, frozen-at-mint) is intentionally NOT touched.
--
-- Two deliberate choices: (1) `confidence`/`fetch_outcome` are free `text` with NO CHECK (cf. SPEC 01
-- §7's enum sketch). The writer is already constrained by a TS union; a DB CHECK would convert a
-- future stray value into a persist failure -> a FAILED audit, which is worse than a cosmetic bad
-- value for a conversion-critical pipeline (fail-open, matching the rate-limit posture). (2) Every
-- column is left NULLABLE — that is what keeps the add metadata-only on PG15 (a later NOT NULL would
-- force a full table rewrite); do not add NOT NULL here.
-- Confirmed against the live schema (2026-06-17): none of these columns exist yet.

-- pages: §1/§7 per-page fetch outcome + whether the page was a gradeable node.
-- Only `ok` (HTTP 200) pages are gradeable nodes under v2.
alter table public.pages
  add column if not exists fetch_outcome text,                    -- 'ok' | 'blocked' | 'dead' (NULL on v1)
  add column if not exists excluded_from_grade boolean default false;
-- `excluded_from_grade` defaults false: every existing page was a gradeable node under v1, so
-- false is the accurate historical value. A constant default is metadata-only on PG15 (no rewrite).

-- audits: §6 per-audit crawl-health. All nullable, NO default => existing rows and future v1
-- audits read NULL ("no crawl-health computed"); the v2 engine populates them on completion.
alter table public.audits
  add column if not exists discovered_count  integer,           -- unique internal URLs seen (fetched ∪ targets)
  add column if not exists fetched_ok_count  integer,           -- HTTP 200 pages = gradeable nodes (the "N" in "N of ~M")
  add column if not exists blocked_count     integer,           -- 403/429/503/0 (throttled/blocked/timeout)
  add column if not exists coverage_pct      double precision,  -- fetched_ok / discovered (0..1)
  add column if not exists block_rate        double precision,  -- blocked / attempted (0..1)
  add column if not exists confidence        text,              -- 'low' | 'medium' | 'high'
  add column if not exists partial           boolean;           -- budget/cap truncated discovery
