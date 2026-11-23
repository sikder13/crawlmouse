-- v2 V2R A2 (session B's question 011): a check inserted on a site that is being kept must not expire.
--
-- requestCheck reads the site, then inserts the check with a 24-hour expires_at when nobody keeps it.
-- If keep_check commits between the two, it has already cleared the expiries it could see, and the
-- insert writes a new one on a kept site. After 24 hours that customer's audit reads as expired.
--
-- This trigger decides at the insert, from the site row. It takes FOR KEY SHARE, which waits for the
-- FOR UPDATE keep_check holds on the site:
--   - keep_check first: the insert waits, sees the account and stores no expiry;
--   - the insert first: keep_check waits for it, and its own update then clears the new row.
-- Security definer because a row lock needs a privilege the inserting role need not hold.
create or replace function public.checks_kept_site_has_no_expiry()
returns trigger
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_owner uuid;
begin
  select s.account_id into v_owner from public.sites s where s.id = new.site_id for key share;
  if v_owner is not null then
    new.expires_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.checks_kept_site_has_no_expiry() from public, anon, authenticated, service_role;

drop trigger if exists checks_kept_site_has_no_expiry on public.checks;
create trigger checks_kept_site_has_no_expiry
  before insert on public.checks
  for each row
  when (new.expires_at is not null)
  execute function public.checks_kept_site_has_no_expiry();
