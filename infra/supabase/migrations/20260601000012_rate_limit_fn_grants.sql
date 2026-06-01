-- Defense-in-depth (round-3 review): take increment_rate_limit off the public REST
-- surface. It's SECURITY INVOKER and rate_limits has deny-all RLS, so a direct anon
-- /rpc call is already a no-op — but the default anon/authenticated EXECUTE grant is
-- the same footgun shape just closed for the share functions: if anyone ever flips it
-- to SECURITY DEFINER (a tempting "fix" for the RLS-blocked insert) it would instantly
-- become anon-callable bucket poisoning. It's only ever invoked server-side via the
-- service role, so restrict EXECUTE to that.
revoke execute on function increment_rate_limit(text, timestamptz) from public, anon, authenticated;
