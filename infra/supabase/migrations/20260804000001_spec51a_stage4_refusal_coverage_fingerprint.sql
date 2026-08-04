-- SPEC 5.1a §12 — Stage 4 persistence: refusal, coverage accounting, and the crawl fingerprint.
--
-- ONE migration for all three, owner-ruled, so the owner applies once rather than three times. It
-- SUPERSEDES the never-applied `20260803000001_spec51a_crawl_fingerprint.sql`, which was removed in
-- the same commit — its column is folded in here, and its storage note was wrong (see STORAGE below).
--
-- Purely additive and backward-compatible: THREE new NULLABLE jsonb columns, plus two column-level
-- SELECT grants. No drops, no type changes, NO BACKFILL, no policy created/changed/widened, no
-- rewrite. Mirrors the `audits.confidence_band` (20260629000001) and `audits.ai_readiness`
-- (20260708000001) precedents.
--
-- ── WHAT EACH COLUMN IS FOR ───────────────────────────────────────────────────────────────────────
--
-- `refusal`   — WHY no letter was asserted: {refused, triggers[], confidenceCapped, unevaluable[]}.
--               The five approved trigger-specific copy bodies select on `triggers`, so until this
--               column exists that copy cannot be wired honestly at all. It is NOT derivable on the
--               read side: re-deriving `decideRefusal` from confidence/fetched_ok_count/partial would
--               be a second hand-synchronised copy of the gate, which is the defect class that made
--               the projection disagree with the grade it projects from.
--
-- `coverage`  — §7 accounting: {fetched, gradeable, excluded[], sitemapDeclared, sitemapUnreached,
--               sitemapRobotsExcluded, estimatedTotal, estimateSource, coverageRatio}. Counts and a
--               provenance tag; no URLs and no crawled text. SURVIVES a refusal by design — it is
--               evidence about what we read, not a verdict about the site.
--
-- `fingerprint` — §6.7: {version, discoveredCount, selectedCount, digest, strata[], seed,
--               strataTotal?, strataWithheld?}. Separates "the site changed" from "we sampled
--               differently": identical digest + different grade is an ENGINE defect; a different
--               digest is an explained input change and the strata table names which sections moved.
--
-- ── RLS AND COLUMN PRIVILEGE ──────────────────────────────────────────────────────────────────────
--
-- RLS IS UNTOUCHED. A new column inherits the table's existing deny-by-default policies; `audits` is
-- still read only through the capability/owner paths, with no `user_id` ever on the wire.
--
-- `audits` was converted to EXPLICIT COLUMN GRANTS by 20260707000003, so a new column is
-- DENY-BY-DEFAULT to anon/authenticated — verified live 2026-08-04:
--   has_table_privilege('authenticated','public.audits','SELECT')                    = false
--   has_column_privilege('authenticated','public.audits','ai_readiness','SELECT')    = false
-- That is why `pages`-style REVOKE/re-GRANT surgery (20260727000001) is NOT needed here: nothing is
-- granted unless this file grants it. The two GRANTs below are therefore deliberate acts, and the
-- third column's absence from them is equally deliberate.
--
--   GRANT `refusal`     — user-facing BY DESIGN. It is the reason we withheld a grade, and the
--                         dashboard reads `audits` RLS-scoped through PostgREST (loadDashboardSites),
--                         so the trigger-specific copy needs it. Contents are a closed enum of trigger
--                         names plus booleans: no URLs, no crawled text, no user_id, no secrets. RLS
--                         still scopes rows to the owner.
--   GRANT `coverage`    — §7.3 REQUIRES exclusions be surfaced to the user ("we excluded 412
--                         tag-archive pages"). Contents are integers plus PageKind enum names plus an
--                         `estimateSource` tag. No URLs, no crawled text.
--   NO GRANT on `fingerprint` — INTERNAL. Two independent reasons, either sufficient:
--                         (1) `seed` is our fixed frontier sampling salt. Publishing the salt beside
--                             the digest construction hands a third party the means to model, predict
--                             or probe which pages we sample. It is an instrument parameter, not a
--                             user-facing fact.
--                         (2) `strata[].templateKey` is an internal derived taxonomy of the crawl, not
--                             a claim about the site we are prepared to stand behind publicly.
--                         No client path reads it: the backtest harness and ops read it through
--                         service_role, which is unaffected by column grants (BYPASSRLS + own grants).
--
-- ── STORAGE (measured, not estimated) ─────────────────────────────────────────────────────────────
--
-- Anchors measured live 2026-08-04: 231 audit rows; `audits` total relation 904 kB; database 226 MB;
-- avg `confidence_band` = 231 B; avg `ai_readiness` = 13.3 kB (max 30.7 kB).
--
--   refusal      ~150–250 B   (shape comparable to confidence_band)
--   coverage     ~300–500 B   (scalars + at most 9 PageKind exclusion rows)
--   fingerprint  ~6.5 kB WORST CASE, bounded — 100 strata x ~60 B + scalars; typical sites have tens
--                of templates, so ~1–2 kB.
--
-- Worst case ≈ 7 kB per completed audit; typical ≈ 1.5–2.5 kB. No backfill, so day-one cost is ZERO;
-- free audits ride the existing 30-day TTL cleanup, so this is steady-state, not cumulative. At
-- 10 000 completed audits/month the ceiling is ~70 MB steady state against a 226 MB database — well
-- inside the ≤18%-MRR cost ceiling, and it adds no new storage lifecycle.
--
-- THE BOUND IS LOAD-BEARING AND IS WHY THE OLD NOTE WAS WRONG. The strata table is one row per
-- distinct templateKey and was UNBOUNDED; its size tracks `discoveredCount`, the PRE-SELECTION
-- discovered set, which the page cap does not bound. Live corpus maximum `discovered_count` =
-- **100 684**, i.e. ~6 MB of jsonb on a single row, and ~60 GB at 10 000 audits/month. The superseded
-- migration's "~120 KB worst case" reasoned from the page cap and was wrong by ~50x.
-- `boundFingerprintForPersist` (inngest/persist-helpers.ts) caps the stored table at
-- FINGERPRINT_PERSIST_MAX_STRATA = 100, keeps the LARGEST strata, records `strataTotal` /
-- `strataWithheld` so the truncation is never silent, and never touches `digest` — which is computed
-- over the selected URL set, not this table, so determinism is unaffected by construction.
--
-- ── DELIBERATE CHOICES, matching the precedents ───────────────────────────────────────────────────
--   (1) jsonb, NO CHECK — the writer is constrained by the TS types. A DB CHECK would turn a future
--       stray field into a persist failure, i.e. a FAILED audit, which is far worse than a cosmetic
--       value on a conversion-critical pipeline (fail-open, matching the rate-limit posture).
--   (2) NULLABLE, NO default — keeps the add metadata-only on PG15 (no table rewrite). Existing rows,
--       any v1 (ENGINE_V2-off) audit, and any crawl that did not run the deterministic frontier read
--       NULL. Only the v2 engine populates them.
--
-- Confirmed against the LIVE schema on 2026-08-04 via the Supabase MCP: none of `audits.refusal`,
-- `audits.coverage`, `audits.fingerprint` exists yet (information_schema.columns returned zero rows
-- for all three).

alter table public.audits
  add column if not exists refusal jsonb,
  add column if not exists coverage jsonb,
  add column if not exists fingerprint jsonb;

comment on column public.audits.refusal is
  'SPEC 5.1a Stage 4 refusal decision: {refused, triggers[], confidenceCapped, unevaluable[]}. '
  'WHY no letter was asserted — an absence of a verdict, never a failing one. Drives the '
  'trigger-specific refusal copy. NULL on pre-5.1a audits and on the v1 engine.';

comment on column public.audits.coverage is
  'SPEC 5.1a §7 coverage accounting: {fetched, gradeable, excluded[], sitemapDeclared, '
  'sitemapUnreached, sitemapRobotsExcluded, estimatedTotal, estimateSource, coverageRatio}. '
  'Survives a refusal — evidence about what we read, not a verdict. NULL on v1.';

comment on column public.audits.fingerprint is
  'SPEC 5.1a §6.7 crawl fingerprint: {version, discoveredCount, selectedCount, digest, strata[], seed, '
  'strataTotal?, strataWithheld?}. Identical digest + different grade = engine defect; different '
  'digest = explained input change. INTERNAL — not granted to anon/authenticated (the seed is our '
  'sampling salt). strata is capped at 100 rows at the write; strataWithheld states what was dropped.';

-- Client-readable columns. `audits` carries NO table-level SELECT for anon/authenticated (explicit
-- column grants since 20260707000003), so these two additions are the ONLY new client-visible surface
-- and `fingerprint` stays unreadable by both roles.
grant select (refusal)  on public.audits to anon, authenticated;
grant select (coverage) on public.audits to anon, authenticated;
