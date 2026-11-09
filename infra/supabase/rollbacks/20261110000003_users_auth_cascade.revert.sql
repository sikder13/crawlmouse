-- Revert of infra/supabase/migrations/20261110000003_users_auth_cascade.sql. Rows the cascade
-- already deleted stay deleted; this removes the constraint only.

alter table public.users drop constraint if exists users_id_auth_fkey;
