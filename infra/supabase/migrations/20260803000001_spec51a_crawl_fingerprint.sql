-- SPEC 5.1a §6.7 / §12 — additive nullable column for the crawl fingerprint.
--
-- WHAT IT IS FOR. The fingerprint is the artifact that separates "the site changed" from "we sampled
-- differently". Identical digest + different grade is an ENGINE defect; a different digest is an
-- explained input change, and the strata table names which sections moved. It exists because the
-- racedays.run reproducibility control could not answer that question and was retired for it — two
-- identical runs had been read as proof of determinism when they were equally consistent with a site
-- that had not changed yet (evidence/2026-07-31-racedays-reproducibility-control-retired.md).
--
-- One artifact serves three needs: SPEC 5.1 determinism, FU-9's per-run crawl composition, and SPEC 06
-- monitoring — which will otherwise report phantom grade movement to users on exactly the class of
-- site where composition wanders.
--
-- Purely additive + backward-compatible: ONE new NULLABLE jsonb column, no drops, no type changes, no
-- backfill. Mirrors the `audits.confidence_band jsonb` precedent (20260629000001) and the additive-
-- nullable posture of the crawl-health (20260617000001) and AI-readiness (20260708000001) migrations.
--
-- RLS IS UNTOUCHED. A new column inherits the table's existing deny-by-default policies; `audits` is
-- still read only through the capability/owner paths, with no `user_id` ever on the wire. No policy is
-- widened, created or dropped by this file. `public_reports` (frozen-at-mint) is NOT touched — a
-- minted snapshot is immutable by contract.
--
-- Deliberate choices, matching the precedents:
--   (1) jsonb, NO CHECK — the writer is constrained by the TS `CrawlFingerprint` type. A DB CHECK would
--       turn a future stray field into a persist failure, i.e. a FAILED audit, which is far worse than a
--       cosmetic value on a conversion-critical pipeline (fail-open, matching the rate-limit posture).
--   (2) NULLABLE, NO default — keeps the add metadata-only on PG15 (no table rewrite). Existing rows,
--       any v1 (ENGINE_V2-off) audit, and any crawl that did not run the deterministic frontier read
--       NULL. Only the v2 engine populates it.
--
-- STORAGE. The payload is counts plus one digest plus a per-stratum table. Measured on the E1-shaped
-- fixture: 6 strata → ~0.4 KB. A pathological site with one stratum per page would be bounded by the
-- page cap; at PRO_PAGE_CAP (2000) with every page its own stratum the worst case is ~120 KB, and the
-- realistic case for a 500-page crawl is under 5 KB. It rides the existing 30-day free-audit TTL
-- cleanup, so it adds no new storage lifecycle and stays inside the ≤18%-MRR ceiling.
--
-- Confirmed against the LIVE schema on 2026-08-03 via the Supabase MCP: `audits.fingerprint` does not
-- exist yet (information_schema.columns returned no row).

alter table public.audits
  add column if not exists fingerprint jsonb;

comment on column public.audits.fingerprint is
  'SPEC 5.1a §6.7 crawl fingerprint: {version, discoveredCount, selectedCount, digest, strata[], seed}. '
  'Identical digest + different grade = engine defect; different digest = explained input change. '
  'NULL on pre-5.1a audits, on the v1 engine, and when the deterministic frontier did not run.';
