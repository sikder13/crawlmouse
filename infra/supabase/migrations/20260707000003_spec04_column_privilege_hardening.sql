-- SPEC 04 §11/§12 — column-privilege hardening for the Runbook A/B columns. APPLY AFTER
-- 20260707000001 and 20260707000002 (it grants over their columns). Additive.
--
-- Why (and why the naive form does NOT work): public_reports carries a live anon SELECT-all policy
-- (public_reports_select_all) and audits carries owner SELECT/UPDATE policies. Supabase grants
-- anon+authenticated TABLE-LEVEL SELECT/UPDATE by default, and Postgres computes effective column
-- access as the UNION of table- and column-level grants — so a bare `REVOKE SELECT (col)` is a NO-OP
-- while the table grant stands (proven against the live DB with a rolled-back has_column_privilege
-- probe). The ONLY correct way to subtract a column is: REVOKE the table-level privilege, then GRANT
-- it back on an explicit column list that EXCLUDES the sensitive columns. (Same idiom the repo used
-- in 20260602000013 for users entitlement grants.)
--
-- What this enforces:
--   - public_reports.minted_by (a users.id) is NOT anon/authenticated-selectable → "no user_id on
--     the wire" (§11; the value is null until Stage B's claim flow writes it, so this closes the
--     leak BEFORE it can happen). The rest of the row stays public (grade/score/domain/snapshot/
--     white_label/visibility) — that is the public report data by design.
--   - audits.notify_email/notify_requested_at/notified_at are NOT client-selectable → a third
--     party's PII (entered on the shared capability URL) never reaches the audit owner.
--   - NO client-role UPDATE of audits or public_reports → the notify send-trigger cap-bypass, the
--     write-once report_snapshot contract, and the Pro white_label entitlement gate are all enforced
--     server-side only. Verified: every write to both tables goes through the service role (mint,
--     claim, visibility, white-label, takedown, cancel, reaudit) — no client-role write exists, so
--     the table-level UPDATE revoke breaks nothing. service_role BYPASSRLS + keeps its own grants,
--     so the app is unaffected.
--
-- The GRANT column lists are generated from information_schema AT APPLY TIME (after 000001/000002),
-- excluding only the named sensitive columns — so no column can be missed. NOTE (deny-by-default):
-- a FUTURE column added to either table is NOT auto-granted to anon/authenticated; a later migration
-- that needs it client-readable must GRANT SELECT (newcol) explicitly. That is the intended posture.
--
-- DEPLOY NOTE: apply this file as a SINGLE transaction (the standard Supabase migration runner does)
-- so there is no window between `revoke select` and the re-`grant` where a client role has zero
-- SELECT. (Anon/public read paths use the service role, so any such window would only affect a
-- logged-in dashboard read during a hand-run — but keep it atomic regardless.)

-- ── audits: no client UPDATE; hide notify_* from client SELECT ────────────────────────────────
revoke update on public.audits from anon, authenticated;
revoke select on public.audits from anon, authenticated;
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ')
    into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'audits'
     and column_name not in ('notify_email', 'notify_requested_at', 'notified_at');
  execute format('grant select (%s) on public.audits to anon, authenticated', cols);
end $$;

-- ── public_reports: no client UPDATE; hide minted_by from client SELECT ───────────────────────
revoke update on public.public_reports from anon, authenticated;
revoke select on public.public_reports from anon, authenticated;
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ')
    into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'public_reports'
     and column_name <> 'minted_by';
  execute format('grant select (%s) on public.public_reports to anon, authenticated', cols);
end $$;

-- Post-apply verification (run manually; expect the commented results):
--   select has_column_privilege('anon','public.public_reports','minted_by','SELECT')  as must_be_false,
--          has_column_privilege('anon','public.public_reports','domain','SELECT')     as must_be_true,
--          has_column_privilege('authenticated','public.audits','notify_email','SELECT') as must_be_false,
--          has_column_privilege('authenticated','public.audits','url','SELECT')       as must_be_true,
--          has_column_privilege('authenticated','public.audits','url','UPDATE')       as must_be_false;
