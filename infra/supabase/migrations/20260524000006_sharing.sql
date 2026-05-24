-- Domain ownership verification
create table domain_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  domain text not null,
  method text not null check (method in ('dns_txt', 'meta_tag')),
  verification_token text not null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, domain)
);
create index on domain_verifications (domain) where verified_at is not null;

-- Public reports (verified-owners only can mint)
create table public_reports (
  slug text primary key,
  audit_id uuid not null references audits(id) on delete cascade unique,
  domain text not null,
  og_image_url text,
  opt_in_leaderboard boolean not null default true,
  created_at timestamptz not null default now(),
  takedown_requested_at timestamptz,
  takedown_reason text
);
create index on public_reports (domain, created_at desc);

-- Embed badges
create table embed_badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  domain text not null,
  style jsonb default '{}'::jsonb,
  view_count bigint not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, domain)
);

-- Takedown requests
create table takedown_requests (
  id uuid primary key default gen_random_uuid(),
  public_report_slug text references public_reports(slug) on delete cascade,
  domain text not null,
  requester_email text not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'verified', 'removed', 'rejected')),
  created_at timestamptz not null default now()
);

-- RLS
alter table domain_verifications enable row level security;
alter table public_reports enable row level security;
alter table embed_badges enable row level security;
alter table takedown_requests enable row level security;

create policy verifications_owner_all on domain_verifications for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy public_reports_select_all on public_reports for select using (true);
create policy public_reports_owner_insert on public_reports for insert with check (
  exists (select 1 from domain_verifications v where v.domain = public_reports.domain and v.user_id = auth.uid() and v.verified_at is not null)
);
create policy public_reports_owner_update on public_reports for update using (
  exists (select 1 from domain_verifications v where v.domain = public_reports.domain and v.user_id = auth.uid() and v.verified_at is not null)
);
create policy embeds_owner_all on embed_badges for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy takedown_anyone_insert on takedown_requests for insert with check (true);
create policy takedown_owner_select on takedown_requests for select using (
  exists (select 1 from domain_verifications v where v.domain = takedown_requests.domain and v.user_id = auth.uid())
);
