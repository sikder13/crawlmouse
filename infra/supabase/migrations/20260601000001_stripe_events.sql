-- Idempotency ledger for Stripe webhooks. Primary key on the Stripe event id
-- means a replayed event collides and is skipped. Service-role writes only.
create table stripe_events (
  id text primary key,                 -- Stripe event.id
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table stripe_events enable row level security;
create policy stripe_events_deny_client on stripe_events for all using (false) with check (false);
