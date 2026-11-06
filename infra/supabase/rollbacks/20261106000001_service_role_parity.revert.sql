-- Revert of infra/supabase/migrations/20261106000001_service_role_parity.sql.
--
-- Deliberately does nothing. On production that migration adds nothing: production already held
-- every grant, default privilege and the bucket it names before it ran. Undoing it on production is
-- therefore to leave production as it is. Revoking those service_role grants instead would take away
-- access the app's server code uses on production, which no rollback should do.
--
-- After this runs on production and its history row is removed, a branch again lacks the
-- service_role lines, and the dry run fails at the fingerprint until the migration is applied again.
do $$
begin
  raise notice '20261106000001_service_role_parity: nothing to revert';
end;
$$;
