-- SPEC 04 §2 (the honest wait): batched crawl-progress columns + the email-me-when-done valve.
-- All additive + nullable. The worker writes progress in batches (every 10 pages or ~5s, never
-- per-page) guarded on status='crawling'; the SSE stream projects them as activity events.
-- crawl_activity holds a bounded ring (<= 30) of {kind, at, label, seq} events — seq is the
-- client's dedup cursor. notify_email is NEVER serialized to any client (capability page or SSE);
-- it is read only by the worker's completion send. Owner-applied (Runbook A).
alter table public.audits
  add column pages_crawled integer,
  add column crawl_estimated_total integer,
  add column crawl_phase text,
  add column crawl_activity jsonb,
  add column notify_email text,
  add column notify_requested_at timestamptz,
  add column notified_at timestamptz;
