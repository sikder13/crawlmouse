-- V2R A2 (CTO ruling, inbox 124): a member reads a check's page rows and link edges only once the
-- check is finished or partial.
--
-- Since F-330 (#214, #219) the pipeline writes a check's page rows and link edges in pieces before
-- persist_built_check marks the check finished, so a running check holds some of its rows, and a
-- check whose save failed keeps them. The app's readers never show them (pipeline/load.ts reads a
-- finished or partial check only). Until now a member could still read them through the Data API:
-- these two policies asked for membership of the check's site, not for its status. Only rows of the
-- member's own sites were ever readable.
--
-- access_tests_member_read is not changed: access tests are staged and written only inside
-- persist_built_check's transaction, so no running or failed check holds any.

drop policy if exists page_results_member_read on public.page_results;
create policy page_results_member_read on public.page_results
  for select to authenticated using (exists (
    select 1 from public.checks c
     where c.id = page_results.check_id
       and c.status in ('finished', 'partial')
       and public.is_member_for_site(c.site_id)));

drop policy if exists link_edges_member_read on public.link_edges;
create policy link_edges_member_read on public.link_edges
  for select to authenticated using (exists (
    select 1 from public.checks c
     where c.id = link_edges.check_id
       and c.status in ('finished', 'partial')
       and public.is_member_for_site(c.site_id)));
