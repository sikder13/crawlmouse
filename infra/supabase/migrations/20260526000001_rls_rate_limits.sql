-- Enable RLS on rate_limits and deny all client (anon/authenticated) access.
-- The application writes to rate_limits via the service-role key (lib/rate-limit.ts uses supabaseAdmin()),
-- which bypasses RLS regardless. This deny-all policy is defense-in-depth: if the anon key were ever
-- misconfigured to have broader permissions, this table would still be unreachable from the client.

alter table rate_limits enable row level security;

create policy rate_limits_deny_client on rate_limits for all using (false) with check (false);
