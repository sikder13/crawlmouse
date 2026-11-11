/**
 * Tables 027b's erasure reads that another session's migration creates, as that migration defines
 * them, for a database whose copy of the migration does not hold them yet.
 *
 * `fix_email_requests` is CC-26b's (20261112000001 section B, `build/cc-26b-dashboard` 9674dcba); this
 * branch's copy of that file is still the seam's empty one. `if not exists`, so once the real migration
 * is merged this creates nothing, and this file is deleted at that merge.
 */
export const FIX_EMAIL_REQUESTS = `
  create table if not exists public.fix_email_requests (
    id uuid primary key default gen_random_uuid(),
    fix_id uuid not null references public.site_fixes (id) on delete cascade,
    account_id uuid not null references public.accounts (id) on delete cascade,
    requested_by_seat_id uuid references public.seats (id) on delete set null,
    to_email text not null check (char_length(to_email) between 3 and 254),
    requested_at timestamptz not null default now(),
    sent_at timestamptz
  );`;
