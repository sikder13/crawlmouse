-- Billing integrity: pro_until / stripe_customer_id must be writable ONLY by the
-- service-role webhook + reconcile cron.
--
-- users_self_update had `using (id = auth.uid())` with NO `with check`, and anon/authenticated
-- held an UPDATE grant on public.users, with no protecting trigger — so a logged-in user could
-- `PATCH /rest/v1/users?id=eq.<own uid>` with a far-future pro_until and self-grant Pro (a full
-- paywall bypass). No client path updates users (every client access is SELECT; only the
-- service-role webhook + reconcile cron write it), so revoke UPDATE from the publishable-key
-- roles and drop the now-dead update policy. service_role retains UPDATE and is unaffected.
--
-- Applied to remote via Supabase MCP apply_migration (remote version 20260602054456).
revoke update on table public.users from anon, authenticated;
drop policy if exists users_self_update on public.users;
