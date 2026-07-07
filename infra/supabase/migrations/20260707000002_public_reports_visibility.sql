-- SPEC 04 §3/§5/§8/§10: public-report visibility metadata, white-label, the mint-time snapshot,
-- and the audits FK swap CASCADE -> SET NULL.
--
-- Why the FK swap: free audits are TTL-deleted after 30 days (deleteExpiredAudits) and the old
-- ON DELETE CASCADE deleted the minted public report with them — fatal once claimed reports are
-- indexed + sitemapped. From this migration on, a report outlives its audit: report_snapshot
-- (written once at mint; bounded; never contains prescriptions/packets/monitoring) carries
-- everything the report page renders. Legacy rows keep rendering from the existing denormalized
-- columns (grade/score/orphan_count/avg_depth) via the designed fallback.
--
-- Visibility semantics: claimed_at/listed/indexable/hidden_at/white_label are the ONLY
-- owner-mutable columns (via claim-verified server routes); snapshot + denormalized audit columns
-- stay write-once at mint (non-regression: minted-snapshot immutability).
alter table public.public_reports
  add column claimed_at timestamptz,
  add column listed boolean not null default false,
  add column indexable boolean not null default false,
  add column hidden_at timestamptz,
  add column white_label jsonb,
  add column minted_by uuid references public.users(id) on delete set null,
  add column report_snapshot jsonb;

alter table public.public_reports alter column audit_id drop not null;

-- Swap the audits FK to ON DELETE SET NULL. The original constraint was created inline
-- (auto-named), so look it up rather than hardcoding the name.
do $$
declare fk_name text;
begin
  select conname into fk_name
    from pg_constraint
   where conrelid = 'public.public_reports'::regclass
     and contype = 'f'
     and confrelid = 'public.audits'::regclass;
  if fk_name is null then
    raise exception 'public_reports -> audits FK not found';
  end if;
  execute format('alter table public.public_reports drop constraint %I', fk_name);
end $$;

alter table public.public_reports
  add constraint public_reports_audit_id_fkey
  foreign key (audit_id) references public.audits(id) on delete set null;

-- Backfill: every pre-existing report was minted under mandatory domain verification, so the
-- cutover is behavior-preserving — they stay listed + indexable exactly as today.
update public.public_reports
   set claimed_at = created_at, listed = true, indexable = true
 where claimed_at is null;

-- Supports the claimed+indexable sitemap /r/ section and browse surfaces.
create index public_reports_indexable_idx
  on public.public_reports (created_at desc)
  where indexable and hidden_at is null;
