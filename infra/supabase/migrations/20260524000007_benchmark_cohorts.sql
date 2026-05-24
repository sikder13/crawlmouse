create table benchmark_cohorts (
  id uuid primary key default gen_random_uuid(),
  cms text not null,
  size_bucket text not null check (size_bucket in ('tiny', 'small', 'medium', 'large')),
  category text,
  metric text not null,
  percentiles jsonb not null,
  n_sites int not null check (n_sites >= 25),
  updated_at timestamptz not null default now(),
  unique (cms, size_bucket, category, metric)
);

alter table benchmark_cohorts enable row level security;
create policy cohorts_select_all on benchmark_cohorts for select using (true);
