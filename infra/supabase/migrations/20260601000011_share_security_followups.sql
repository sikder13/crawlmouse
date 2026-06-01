-- Plan 3 hardening, round-2 security follow-ups.

-- 1. A takedown must actually suppress the report from the public API, not just the
--    rendered pages. The app reads public_reports via the service role (bypasses RLS)
--    and filters takedown_requested_at in code, but the anon SELECT policy was
--    `using (true)`, so a direct `GET /rest/v1/public_reports` with the publishable
--    anon key returned taken-down rows (grade/score/domain/cms_detected/audit_id).
--    Scope the public read to live reports only.
alter policy public_reports_select_all on public_reports using (takedown_requested_at is null);

-- 2. The ...10 `revoke ... from public` did not remove Supabase's explicit per-role
--    EXECUTE grants, so anon/authenticated could still reach the two share functions
--    via /rpc. (increment_embed_view was a no-op for anon under embed_badges RLS, but
--    it's a latent footgun if the function ever reverts to SECURITY DEFINER.) Revoke
--    from the named roles so only the service role (mint + embed route) can call them.
revoke execute on function increment_embed_view(text) from anon, authenticated;
revoke execute on function populate_public_report() from anon, authenticated;
