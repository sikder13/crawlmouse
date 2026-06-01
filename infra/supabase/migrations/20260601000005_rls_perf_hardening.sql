-- RLS hardening (Plan 2 review):
--   1. Wrap auth.uid() in (select auth.uid()) so Postgres evaluates it once per query
--      instead of once per row (Supabase advisor: auth_rls_initplan). Material on the
--      pages/links/findings policies, which run per-row over 2,000-page Pro audits.
--   2. Drop audits_owner_insert: every audit insert goes through the service-role client
--      in /api/audits/start (after SSRF validation + rate limits + Turnstile). The policy
--      only ever granted the anon/authenticated key a way to insert forged rows directly
--      (the `or user_id is null` arm), bypassing those controls. No legitimate client insert.
--   3. Add covering indexes for the FKs on the cascade-delete path (advisor:
--      unindexed_foreign_keys) so the 30-day TTL cleanup cron doesn't seq-scan.

-- users
alter policy users_self_read on users using (id = (select auth.uid()));
alter policy users_self_update on users using (id = (select auth.uid()));

-- audits
alter policy audits_owner_read on audits using (user_id = (select auth.uid()));
drop policy audits_owner_insert on audits;
alter policy audits_owner_update on audits using (user_id = (select auth.uid()));

-- pages / links / findings (read via parent-audit ownership)
alter policy pages_via_audit on pages using (
  exists (select 1 from audits a where a.id = pages.audit_id and a.user_id = (select auth.uid()))
);
alter policy links_via_audit on links using (
  exists (select 1 from audits a where a.id = links.audit_id and a.user_id = (select auth.uid()))
);
alter policy findings_via_audit on findings using (
  exists (select 1 from audits a where a.id = findings.audit_id and a.user_id = (select auth.uid()))
);

-- sharing tables
alter policy verifications_owner_all on domain_verifications
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy public_reports_owner_insert on public_reports
  with check (exists (select 1 from domain_verifications v
    where v.domain = public_reports.domain and v.user_id = (select auth.uid()) and v.verified_at is not null));
alter policy public_reports_owner_update on public_reports
  using (exists (select 1 from domain_verifications v
    where v.domain = public_reports.domain and v.user_id = (select auth.uid()) and v.verified_at is not null));
alter policy embeds_owner_all on embed_badges
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy takedown_owner_select on takedown_requests
  using (exists (select 1 from domain_verifications v
    where v.domain = takedown_requests.domain and v.user_id = (select auth.uid())));

-- covering indexes for cascade-delete FKs
create index if not exists findings_page_id_idx on findings (page_id);
create index if not exists links_from_page_id_idx on links (from_page_id);
create index if not exists links_to_page_id_idx on links (to_page_id);
create index if not exists takedown_requests_slug_idx on takedown_requests (public_report_slug);
