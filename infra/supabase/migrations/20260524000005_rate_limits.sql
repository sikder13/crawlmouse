create table rate_limits (
  bucket_key text not null,
  window_start timestamptz not null,
  request_count int not null default 1,
  primary key (bucket_key, window_start)
);
create index on rate_limits (window_start);

create or replace function increment_rate_limit(p_bucket_key text, p_window_start timestamptz)
returns int language plpgsql as $$
declare new_count int;
begin
  insert into rate_limits (bucket_key, window_start, request_count) values (p_bucket_key, p_window_start, 1)
    on conflict (bucket_key, window_start) do update set request_count = rate_limits.request_count + 1
    returning request_count into new_count;
  return new_count;
end; $$;
