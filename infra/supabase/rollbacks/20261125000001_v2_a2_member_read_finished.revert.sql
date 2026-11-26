-- Revert of infra/supabase/migrations/20261125000001_v2_a2_member_read_finished.sql: the two
-- policies as migration 003 made them, membership of the check's site with no status condition.

drop policy if exists page_results_member_read on public.page_results;
create policy page_results_member_read on public.page_results
  for select to authenticated using (exists (
    select 1 from public.checks c where c.id = page_results.check_id and public.is_member_for_site(c.site_id)));

drop policy if exists link_edges_member_read on public.link_edges;
create policy link_edges_member_read on public.link_edges
  for select to authenticated using (exists (
    select 1 from public.checks c where c.id = link_edges.check_id and public.is_member_for_site(c.site_id)));
