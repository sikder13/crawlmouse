-- B-F2: deleting an auth user deletes its public.users row, and through the foreign keys into
-- public.users the rows of audits, sessions, domain_verifications, embed_badges and seats, while
-- public_reports, share_links and api_keys keep their rows with the reference set null. The keys:
--   select conrelid::regclass, confdeltype from pg_constraint where confrelid = 'public.users'::regclass;
-- Before this, public.users had no foreign key to auth.users, so deleting the auth user left the
-- profile behind.
--
-- Measured on production 2026-11-09 (read-only): 12 rows in each table, no orphan either way.
-- Added `not valid`, then validated; at this size the two steps gain nothing over one, and they keep
-- the lock short if the table grows. Running this file twice changes nothing: the constraint is
-- dropped if present and added again (apps/web/__tests__/users-auth-cascade.test.ts).
-- Rollback: infra/supabase/rollbacks/20261109000003_users_auth_cascade.revert.sql.

alter table public.users drop constraint if exists users_id_auth_fkey;
alter table public.users
  add constraint users_id_auth_fkey foreign key (id) references auth.users (id)
  on delete cascade not valid;
alter table public.users validate constraint users_id_auth_fkey;
