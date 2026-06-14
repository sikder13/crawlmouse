-- User-cancelable audits: add a `canceled_at` timestamp for the new 'canceled' terminal status.
-- `audits.status` is free text (no enum / CHECK constraint), so the 'canceled' value itself needs
-- no constraint change — only this timestamp column is added. Additive + nullable: existing audits
-- and every reader are unaffected, and the Stripe/Paddle/entitlement paths are untouched. A canceled
-- audit is a DISTINCT terminal state from 'failed', so a user-cancel never fires the audit-failed
-- Sentry alert or counts as a failure. Written only by the service-role cancel route.
alter table public.audits add column if not exists canceled_at timestamptz;
