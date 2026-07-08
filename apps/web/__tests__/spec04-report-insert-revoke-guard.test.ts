import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SPEC 04 §3/§11 (Stage B carry-in) — the mint/claim path (service role) is the only creator of
// public_reports rows. This pins that the migration revoking client-role INSERT exists, so a future
// migration reshuffle can't silently re-open the direct-PostgREST insert vector. Proven effective by
// a rolled-back live has_table_privilege probe (recorded in the migration + progress log). FAILS LOUD
// (ENOENT) if the file is renamed/removed.
const MIGRATION = 'infra/supabase/migrations/20260707000004_public_reports_client_insert_revoke.sql';
const read = () => readFileSync(resolve(__dirname, '../../..', MIGRATION), 'utf8').toLowerCase();

describe('SPEC 04 public_reports client-INSERT revoke migration', () => {
  it('revokes table-level INSERT on public_reports from anon + authenticated', () => {
    expect(read()).toMatch(/revoke\s+insert\s+on\s+(public\.)?public_reports\s+from\s+anon\s*,\s*authenticated/);
  });

  it('is table-level (not a no-op column-scoped revoke)', () => {
    expect(read()).not.toMatch(/revoke\s+insert\s*\([^)]*\)\s+on/);
  });
});
