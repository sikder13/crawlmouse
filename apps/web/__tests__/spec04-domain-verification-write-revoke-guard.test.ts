import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SPEC 04 §9/§11 (Stage C security deploy-gate) — the report claim + visibility routes authorize every
// privileged public_reports write on a VERIFIED domain_verifications row (isDomainVerifiedForUser →
// verified_at IS NOT NULL). That table must therefore NOT be client-writable: Supabase's default
// table-level grant + the verifications_owner_all RLS policy (which constrains only user_id, NOT
// verified_at) would otherwise let any authenticated user INSERT a row with a FORGED verified_at
// straight against PostgREST — bypassing the DNS/meta challenge — and claim / de-index any victim's
// report. This pins that the migration revoking client-role write exists + is table-level, so a
// migration reshuffle can't silently re-open the forgery vector. Proven effective by a rolled-back live
// has_table_privilege probe (recorded in the migration). FAILS LOUD (ENOENT) if the file is renamed.
const MIGRATION = 'infra/supabase/migrations/20260707000005_domain_verifications_client_write_revoke.sql';
const read = () => readFileSync(resolve(__dirname, '../../..', MIGRATION), 'utf8').toLowerCase();

describe('SPEC 04 domain_verifications client-write revoke migration', () => {
  it('revokes table-level INSERT/UPDATE/DELETE on domain_verifications from anon + authenticated', () => {
    expect(read()).toMatch(
      /revoke\s+insert\s*,\s*update\s*,\s*delete\s+on\s+(public\.)?domain_verifications\s+from\s+anon\s*,\s*authenticated/,
    );
  });

  it('is table-level (not a no-op column-scoped revoke)', () => {
    // A column-scoped revoke (`revoke insert (col) on …`) is a Postgres no-op while the role holds a
    // table-level grant — pin that this migration is the effective table-level form.
    expect(read()).not.toMatch(/revoke\s+[a-z, ]*\([^)]*\)\s+on\s+(public\.)?domain_verifications/);
  });
});
