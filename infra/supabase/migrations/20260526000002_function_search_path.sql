-- Pin the search_path on increment_rate_limit to prevent search-path-based attacks.
-- Supabase database-linter warning 0011_function_search_path_mutable.

create or replace function increment_rate_limit(p_bucket_key text, p_window_start timestamptz)
returns int
language plpgsql
set search_path = public, pg_catalog
as $$
declare new_count int;
begin
  insert into rate_limits (bucket_key, window_start, request_count) values (p_bucket_key, p_window_start, 1)
    on conflict (bucket_key, window_start) do update set request_count = rate_limits.request_count + 1
    returning request_count into new_count;
  return new_count;
end; $$;
