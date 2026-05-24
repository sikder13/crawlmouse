create table audits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  anonymous_session_id text,
  url text not null,
  status text not null default 'pending',
  cms_detected text,
  cms_metadata jsonb,
  page_count int,
  link_count int,
  score numeric(5,2),
  grade text,
  commit_sha text,
  environment text,
  branch text,
  deployment_id text,
  settings jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  failure_reason text
);

create table pages (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references audits(id) on delete cascade,
  url text not null,
  url_hash text not null,
  title text,
  status_code int not null,
  depth int,
  in_degree int not null default 0,
  out_degree int not null default 0,
  is_orphan boolean not null default false,
  unique (audit_id, url)
);

create table links (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references audits(id) on delete cascade,
  from_page_id uuid not null references pages(id) on delete cascade,
  to_page_id uuid not null references pages(id) on delete cascade,
  anchor_text text,
  is_generic_anchor boolean not null default false
);

create table findings (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references audits(id) on delete cascade,
  category text not null,
  severity text not null,
  page_id uuid references pages(id) on delete cascade,
  payload jsonb
);
