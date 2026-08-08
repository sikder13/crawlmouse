-- SPEC 5.1a §8 (Stage 5) — the durable frontier checkpoint.
--
-- Its OWN migration, owner-ruled: the one-apply rule was about not splitting ONE logical change across
-- three files, not about deferring genuinely separate changes to the end of a long branch. Bundling
-- this into close-out would mean unverified schema landing last, which inverts the discipline.
--
-- TWO NEW TABLES. No existing table is altered, no policy is created, changed or widened, no backfill.
--
-- ── WHAT THIS IS, AND IS NOT ──────────────────────────────────────────────────────────────────────
--
-- NOT resumability in the SPEC 06 sense. A durable home for frontier state so a timed-out crawl
-- resumes rather than restarts, and so the §6.7 fingerprint survives the interruption. Multi-step
-- Inngest continuation, scheduled re-crawls and incremental crawling are explicitly SPEC 06 (§13).
--
-- ── WORKING STATE, NOT A RECORD — THE RETENTION DECISION ───────────────────────────────────────────
--
-- These rows are TRANSIENT. They exist only while a crawl is in flight and are deleted when it
-- completes; nothing downstream reads them afterwards, because the artifact that outlives the crawl is
-- `audits.fingerprint`, which is already persisted and bounded.
--
-- That decision is what makes the table affordable, and it is measured rather than assumed. Had the
-- frontier existed for the corpus so far it would hold **602 149 rows** — at the ~500 B/row derived
-- below, roughly **300 MB, larger than the entire 226 MB database.** Retaining frontier rows for the
-- audit's 30-day TTL is therefore not an option, and this is stated here so nobody later "fixes" the
-- cleanup by aligning it with the audit TTL.
--
-- THREE cleanup paths, because the first two cover ONLY THE HAPPY PATH:
--   1. An explicit delete at completion in the worker — covers a crawl that finishes.
--   2. `on delete cascade` — covers an audit the TTL cron actually deletes. Matches the convention
--      pages/links/findings/fixes already use (verified live).
--   3. An ORPHAN SWEEP BY AGE (`deleteOrphanFrontierRows`) — covers everything else, and it is not
--      optional. Measured live 2026-08-06: `deleteExpiredAudits` filters on `expires_at <= now` and
--      nothing else, and 20 completed + 2 cancelled audits carry `expires_at NULL`, so their cascade
--      NEVER fires. Add 7 failed and 7 pending (oldest stuck ~29 days) and the uncovered set is
--      failed, cancelled, no-expiry, and worker-died-mid-crawl — rows that would live 30 days or
--      FOREVER. The sweep's rule is self-contained (untouched for 24 h ⇒ dead, whatever killed it),
--      because a crawl cannot meaningfully outlive its 240 s budget.
-- None of the three needs a NEW cron: the sweep rides the existing daily cleanup as its own step.
--
-- ── STORAGE (measured against live, 2026-08-05) ───────────────────────────────────────────────────
--
-- Anchor, derived from a real row-per-URL table rather than estimated: `public.pages` holds 41 228
-- rows in 24 428 544 B total = **593 B/row** (heap 13.1 MB + indexes 11.0 MB — indexes are ~45%).
-- Average URL length 65 chars, max 409.
--
-- A frontier row carries fewer columns than a page row but adds `sample_key` (64 hex) and
-- `template_key`, and pays for two indexes. Estimate **~500 B/row including indexes.**
--
--   typical audit   avg discovered 2 909  →  ~1.5 MB
--   p95 audit       3 858                 →  ~1.9 MB
--   WORST measured  100 684               →  **~50 MB for a single audit**
--
-- Steady state is bounded by CONCURRENT crawls, not by corpus size, because the rows are transient:
-- at `INNGEST_AUDIT_CONCURRENCY = 5` the typical footprint is **~8 MB** and the pathological ceiling
-- is **~250 MB** if five worst-case sites ran at once. That ceiling is transient and self-clearing,
-- but it is real and it is recorded rather than smoothed over.
--
-- THE 100 684-URL CASE — RULED, not left open. A discovery cap was built (`capDiscovered`,
-- `MAX_DISCOVERED_URLS`) and then STOPPED before wiring, because it MOVES GRADES on exactly the sites
-- that hit it: all five are Wikipedia, whose `/wiki/{article}` yields one stratum per article, and a
-- global smallest-key cut there replaces ~78 % of the selected sample (measured, 111/500 overlap).
-- That makes it 5.1b work rather than a Stage 5 storage guard. Nothing in this migration depends on it.
--
-- Truncating the persisted BASIS remains forbidden regardless: `resumeSelection` selects over the
-- COMPLETE discovered set, and shrinking it is precisely the naive-resume defect B6 exists to catch.
--
-- Storage is instead bounded by RETENTION (see the orphan sweep below), which turns a permanent cost
-- into a transient one without touching a single grade.
--
-- ── RLS ───────────────────────────────────────────────────────────────────────────────────────────
--
-- Deny-by-default, and NO client grant at all. This is internal crawl machinery: it is written and read
-- exclusively by the worker through `service_role` (BYPASSRLS + its own grants). No anon/authenticated
-- SELECT is granted, so unlike `audits` there is no column-grant surface to reason about. RLS is
-- enabled with no policies, which denies every non-service role outright.

create table if not exists public.frontier (
  audit_id    uuid        not null references public.audits(id) on delete cascade,
  -- sha256 hex of the canonical URL. Paired with audit_id as the row identity, so a re-discovery of
  -- the same URL updates rather than duplicates — the discovered set is a SET.
  url_hash    text        not null,
  url         text        not null,
  -- §6 stratum key and §6.4 sample key are DERIVED but STORED, so a resume never recomputes a rule
  -- that could have changed between the two halves of one crawl.
  template_key text       not null,
  sample_key  text        not null,
  depth       integer     not null,
  state       text        not null default 'discovered'
                check (state in ('discovered','claimed','fetched','failed','skipped')),
  source      text        not null
                check (source in ('homepage','sitemap','link')),
  claimed_at  timestamptz,
  updated_at  timestamptz not null default now(),
  primary key (audit_id, url_hash)
);

-- The claim query filters on (audit_id, state); §8 names this index explicitly.
create index if not exists frontier_audit_state_idx on public.frontier (audit_id, state);

-- The ORPHAN SWEEP scans by age across all audits, so it needs its own index — without it the daily
-- cron degrades to a full scan of the largest table in the schema exactly when it is largest.
create index if not exists frontier_updated_at_idx on public.frontier (updated_at);

comment on table public.frontier is
  'SPEC 5.1a §8 durable frontier checkpoint. TRANSIENT working state: deleted when the crawl completes, '
  'and cascaded on audit delete. Nothing downstream reads it — the artifact that outlives a crawl is '
  'audits.fingerprint. Internal only: no anon/authenticated grant.';

comment on column public.frontier.state is
  'discovered → claimed → fetched|failed|skipped. NOTE: state is NOT an input to selection. '
  'resumeSelection() selects over EVERY discovered row whatever its state; filtering the basis by '
  'state is the naive-resume defect Stage 5 B6 exists to catch.';

-- Per-host politeness, so backoff SURVIVES a resume. Without it a resumed crawl forgets it was being
-- throttled and reopens at full concurrency against a host that just asked it to slow down — turning a
-- temporary 429 into a durable block, which would later read as the site's own configuration.
--
-- Keyed by host rather than folded into `audits` because it describes the HOST, not the run.
create table if not exists public.frontier_politeness (
  audit_id         uuid        not null references public.audits(id) on delete cascade,
  host             text        not null,
  crawl_delay_ms   integer     not null default 0,
  backoff_until    timestamptz,
  consecutive_429s integer     not null default 0,
  updated_at       timestamptz not null default now(),
  primary key (audit_id, host)
);

comment on table public.frontier_politeness is
  'SPEC 5.1a §8 per-host politeness, persisted so backoff survives a resume. TIMING ONLY — §6.6 '
  'forbids politeness from changing WHICH urls are selected. Transient, cascaded on audit delete.';

-- Deny-by-default. RLS on with NO policies denies every role except service_role (BYPASSRLS).
alter table public.frontier enable row level security;
alter table public.frontier_politeness enable row level security;

-- Belt and braces: no client role may touch these even if a future migration adds a policy by mistake.
revoke all on public.frontier from anon, authenticated;
revoke all on public.frontier_politeness from anon, authenticated;
