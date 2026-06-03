-- Developer-waitlist signups for the v1.2 CLI/GitHub Action pre-announce.
-- Service-role writes only (the /api/developers route, like takedown); no client RLS access.
create table waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  source text not null default 'developers',
  created_at timestamptz not null default now()
);
-- One signup per email per source. Idempotent re-submit: the route lowercases email before
-- insert and treats the resulting 23505 unique-violation as success (mirrors reports/mint).
create unique index waitlist_email_source_uniq on waitlist (lower(email), source);

alter table waitlist enable row level security;
-- Closed by default: no anon/authenticated row access at all; the service-role route is the only writer.
create policy waitlist_deny_client on waitlist for all using (false) with check (false);
-- Defense-in-depth: drop the implicit table grants Supabase gives anon/authenticated on new public tables.
revoke all on table waitlist from anon, authenticated;
