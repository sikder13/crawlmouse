-- SPEC 05 §11 — additive nullable columns for the AI / Agent-Readiness score.
-- Purely additive + backward-compatible: two new NULLABLE jsonb columns, no drops, no type changes,
-- no backfill. Mirrors the `audits.confidence_band jsonb` precedent (20260629000001) and the additive-
-- nullable posture of the crawl-health migration (20260617000001). RLS is UNTOUCHED — a new column
-- inherits the table's existing deny-by-default policies; `pages`/`audits` are still read only through the
-- capability/owner paths (no `user_id` ever on the wire). public_reports (frozen-at-mint) is NOT touched.
--
-- Deliberate choices, same as the crawl-health precedent:
--   (1) jsonb, NO CHECK — the writer is constrained by the TS `PageAiSignals` / `AiReadinessScore` types;
--       a DB CHECK would turn a future stray field into a persist failure → a FAILED audit, worse than a
--       cosmetic value for a conversion-critical pipeline (fail-open, matching the rate-limit posture).
--   (2) NULLABLE, NO default — keeps the add metadata-only on PG15 (no table rewrite). Existing rows and
--       any v1 (ENGINE_V2-off) or extraction-disabled audit read NULL; only the v2 engine populates them.
-- Confirmed against the live schema (2026-07-08, via the Supabase MCP): neither column exists yet.

-- pages: §4 per-page AI-legibility signals (pageClass + bounded "What AI Sees" excerpt + legibility flags).
-- The `PageAiSignals` payload. SUPERSEDED — see docs/deploy/spec05-migration-runbook.md: measured ≤ 8.7 KB/page, ≤ 4.4 MB per 500-page audit, ≤ 17.5 MB at PRO_PAGE_CAP. The original estimate counted UTF-16 code units, not the UTF-8 bytes Postgres stores; rides the existing 30-day free-audit
-- TTL cleanup (no new storage lifecycle). NULL for pages crawled before SPEC 05 / on v1 / when disabled.
alter table public.pages
  add column if not exists ai_signals jsonb;

-- audits: §7 the sibling AI-readiness score (the persisted `AiReadinessScore` — score + breakdown + findings
-- ledger + access matrix + llms.txt status). One column, mirroring the `confidence_band jsonb` precedent.
-- NULL on existing rows / v1 / when the feature is hidden (Amendment §2 null-assembly). History-ready by
-- construction (stable finding ids) for the SPEC 06 delta dashboard — no schema change needed there.
alter table public.audits
  add column if not exists ai_readiness jsonb;
