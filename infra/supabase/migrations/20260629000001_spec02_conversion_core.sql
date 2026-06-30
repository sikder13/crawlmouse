-- SPEC 02 Conversion Core — additive, backward-compatible columns for the projected grade, the
-- confidence band, and the monitoring (re-audit) linkage. New NULLABLE columns + one nullable
-- self-FK only; no drops, no type changes, no backfill that rewrites rows. v1 (ENGINE_V2 off) writes
-- NULL → prod is unchanged until the flag flips. public_reports (minted, frozen-at-mint) is NOT touched.
-- Every add is metadata-only on PG15 (nullable, no constant rewrite). Confirmed additive against the
-- live schema before apply.

-- audits: §2 confidence band (jsonb snapshot) + §3 projected grade + §8 monitoring linkage.
alter table public.audits
  add column if not exists confidence_band   jsonb,            -- §2 ConfidenceBand snapshot (NULL on v1)
  add column if not exists projected_score   numeric(5,2),     -- §3 projected score 0..100 (NULL on v1; PostgREST serializes as string → coerce on read like `score`)
  add column if not exists projected_grade   text,             -- §3 projected letter grade (NULL on v1)
  add column if not exists previous_audit_id uuid;             -- §8 the audit this re-audits (monitoring delta linkage)

-- previous_audit_id → audits(id) ON DELETE SET NULL: when the TTL cleanup deletes an expired
-- predecessor, the successor survives with a NULL link (the delta degrades gracefully) and is NEVER
-- chain-deleted. Self-referential; added guarded so re-runs are idempotent.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'audits_previous_audit_id_fkey') then
    alter table public.audits
      add constraint audits_previous_audit_id_fkey
      foreign key (previous_audit_id) references public.audits(id) on delete set null;
  end if;
end $$;

-- Index the FK — an unindexed FK is flagged by the Supabase performance advisor and slows the delta lookup.
create index if not exists idx_audits_previous_audit_id on public.audits(previous_audit_id);

-- pages: SPEC 02 v1.2 — raw internal PageRank per node for the live graph (NULL on v1; metadata-only add).
alter table public.pages
  add column if not exists pagerank numeric;                   -- raw 0..1 PageRank (max-normalized at graph assembly)
