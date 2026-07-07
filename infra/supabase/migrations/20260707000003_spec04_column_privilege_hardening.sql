-- SPEC 04 §11/§12 — column-privilege hardening for the Runbook A/B columns. APPLY AFTER
-- 20260707000001 and 20260707000002 (it references their columns). Additive + idempotent-safe
-- (REVOKE of an absent grant is a no-op).
--
-- Why: public_reports and audits both carry LIVE anon/authenticated PostgREST access
-- (public_reports_select_all = anon SELECT of every column; the owner UPDATE/SELECT policies on
-- both). Supabase's default per-role grants persist unless explicitly revoked, so the new columns
-- would be reachable by the publishable anon key / a logged-in owner the moment anything writes
-- them. These revokes make the new sensitive columns SERVICE-ROLE-ONLY, matching the repo's
-- deny-by-default posture (the app reads/writes both tables via the service role; see
-- lib/reports.ts, the mint/claim/visibility/white-label/notify routes). service_role has its own
-- grants and BYPASSRLS, so it is unaffected by these role-scoped column revokes.
--
-- Verified before writing: no client-role (anon/authenticated) code path SELECTs `*` on either
-- table, and every public_reports write goes through the service role — so column-scoped revokes
-- break no legitimate query (dashboard/report/compare reads use explicit column lists that never
-- include these columns).

-- ── public_reports ──────────────────────────────────────────────────────────────────────────
-- 1. No client-role UPDATE at all: mint, claim, visibility toggles, white-label, and takedown all
--    run service-side. This enforces the write-once snapshot contract (report_snapshot immutable)
--    AND the Pro entitlement gate on white_label — a domain-verified owner must NOT be able to set
--    white_label / rewrite report_snapshot / flip listed·indexable directly via /rest, bypassing
--    the claim+entitlement-verified server routes (SPEC 04 §5, §10; non-regression #5).
--    (public_reports_owner_update stays as belt-and-suspenders; with no grant it can grant nothing.)
revoke update on public_reports from anon, authenticated;

-- 2. minted_by is a users.id — it must NEVER reach the wire (SPEC 04 §11; the repo's no-user_id
--    rule). The rest of the row (grade/score/domain/report_snapshot/white_label/visibility) stays
--    anon-SELECTable: that is the public report data by design.
revoke select (minted_by) on public_reports from anon, authenticated;

-- ── audits ──────────────────────────────────────────────────────────────────────────────────
-- 3. The notify_* columns are PII + a send-trigger: notify_email may be entered by a THIRD PARTY
--    holding the shared capability URL, so the audit owner must not read it; and an owner must not
--    UPDATE notify_email on their own running audit to fire an unsolicited "report ready" email
--    from magic@crawlmouse.com, bypassing the notify route's per-IP/per-email caps. Both the notify
--    route and the worker use the service role.
revoke select (notify_email, notify_requested_at, notified_at) on audits from anon, authenticated;
-- 4. The new progress + notify columns are all service-role-written (the worker's batcher + the
--    notify route). No client role should UPDATE them (owner self-corruption of progress; the
--    notify send-trigger above). Column-scoped UPDATE revoke leaves the owner's legitimate updates
--    (status/canceled_at via the cancel route) untouched.
revoke update (
  notify_email, notify_requested_at, notified_at,
  pages_crawled, crawl_estimated_total, crawl_phase, crawl_activity
) on audits from anon, authenticated;
