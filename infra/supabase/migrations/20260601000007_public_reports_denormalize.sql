-- Plan 3 hardening: denormalize the immutable audit stats a public report needs
-- onto public_reports itself, so every viral hot-path read (the report page, the
-- OG card, the embed badge, the leaderboard) is a single indexed single-table
-- query instead of a report->audit(->pages) fan-out. An audit is immutable once
-- completed and a public_report's audit_id is fixed + UNIQUE, so these copies can
-- never drift. A BEFORE INSERT trigger populates them from the source of truth, so
-- the mint path stays a plain insert and the fields can't be forgotten.

alter table public_reports
  add column if not exists score numeric(5,2),
  add column if not exists grade text,
  add column if not exists cms_detected text,
  add column if not exists orphan_count integer,
  add column if not exists avg_depth double precision;

create or replace function populate_public_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select a.score, a.grade, a.cms_detected
    into new.score, new.grade, new.cms_detected
  from audits a
  where a.id = new.audit_id;

  -- Match the owner-facing GradeCard semantics exactly (lib/audit-stats.ts):
  -- orphans by the is_orphan flag; mean click depth over non-null depths, 0 if none.
  select count(*) filter (where is_orphan), coalesce(avg(depth), 0)
    into new.orphan_count, new.avg_depth
  from pages
  where audit_id = new.audit_id;

  return new;
end;
$$;

drop trigger if exists trg_populate_public_report on public_reports;
create trigger trg_populate_public_report
  before insert on public_reports
  for each row execute function populate_public_report();

-- Backfill any pre-existing rows (none at launch) so the new columns are consistent.
update public_reports pr
set score = a.score, grade = a.grade, cms_detected = a.cms_detected
from audits a
where a.id = pr.audit_id and pr.grade is null;

-- Leaderboard: top-N by score within a CMS platform, only opt-in & not-taken-down.
-- Partial covering index so /top/[platform] is an index range scan instead of a
-- seq scan of the growing audits table joined per request.
create index if not exists public_reports_leaderboard_idx
  on public_reports (cms_detected, score desc)
  where opt_in_leaderboard and takedown_requested_at is null;
