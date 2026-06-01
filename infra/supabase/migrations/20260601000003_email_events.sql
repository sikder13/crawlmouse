-- Cost control #7: track Resend deliveries/bounces/complaints; suppress sends to hard-bounced addresses.
create table email_events (
  id uuid primary key default gen_random_uuid(),
  resend_event_id text unique,
  email_address text not null,
  event_type text not null,            -- sent | delivered | bounced | complained | delivery_delayed
  bounce_type text,                    -- 'permanent' | 'transient' | null
  payload jsonb,
  created_at timestamptz not null default now()
);
create index on email_events (email_address, bounce_type) where bounce_type = 'permanent';

alter table email_events enable row level security;
create policy email_events_deny_client on email_events for all using (false) with check (false);
