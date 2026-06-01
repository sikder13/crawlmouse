-- Plan 3 hardening: atomic embed-view increment.
-- The embed badge previously did `update embed_badges set view_count = 1` (a literal
-- overwrite that also matched no rows, since nothing ever inserted an embed_badges
-- row). The mint flow now inserts the owner's badge row, and the embed route calls
-- this RPC to increment it. A SQL function is the only way to express col = col + 1
-- atomically via PostgREST. Keyed by domain alone (the public embed has no user
-- context); if two owners share a domain both counters advance, which is acceptable
-- for an approximate view metric.
create or replace function increment_embed_view(p_domain text)
returns void
language sql
security definer
set search_path = public
as $$
  update embed_badges set view_count = view_count + 1 where domain = p_domain;
$$;
