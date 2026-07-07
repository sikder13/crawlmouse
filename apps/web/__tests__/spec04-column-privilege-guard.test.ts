import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SPEC 04 §11/§12 security guard (adversarial-gate hardening). The Runbook A/B migrations add
// columns to two tables that carry LIVE anon/authenticated PostgREST access:
//   - public_reports has `public_reports_select_all` (anon SELECT of every column) + a domain-
//     verified owner UPDATE policy;
//   - audits has owner SELECT/UPDATE policies.
// Supabase's default per-role grants persist unless explicitly revoked, so without the
// column-privilege revokes below, the moment Stage B (or the wait valve) writes these columns:
//   - anon could SELECT public_reports.minted_by (a users.id → "no user_id on the wire" breach);
//   - a domain-verified owner could UPDATE white_label / report_snapshot / listed / indexable
//     directly via /rest (bypassing the Pro entitlement gate + the write-once snapshot contract);
//   - an audit owner could read a third party's notify_email (PII entered on the shared capability
//     URL) or set notify_email to fire an unsolicited email, bypassing the notify route's caps.
// This guard pins that the enforcing hardening migration exists and contains those revokes, so a
// future migration reshuffle can't silently re-arm the exposure. FAILS LOUD (ENOENT) if the file
// is renamed/removed.
const MIGRATION = 'infra/supabase/migrations/20260707000003_spec04_column_privilege_hardening.sql';
const read = () => readFileSync(resolve(__dirname, '../../..', MIGRATION), 'utf8').toLowerCase();

describe('SPEC 04 column-privilege hardening migration', () => {
  it('revokes client-role UPDATE on public_reports (all writes are service-role routes)', () => {
    const sql = read();
    expect(sql).toMatch(/revoke\s+update\s+on\s+(public\.)?public_reports\s+from\s+anon\s*,\s*authenticated/);
  });

  it('revokes anon/authenticated SELECT of public_reports.minted_by (no user_id on the wire)', () => {
    const sql = read();
    expect(sql).toMatch(/revoke\s+select\s*\(\s*minted_by\s*\)\s+on\s+(public\.)?public_reports\s+from\s+anon\s*,\s*authenticated/);
  });

  it('revokes anon/authenticated SELECT + UPDATE of the audits notify_* columns (PII + send-trigger)', () => {
    const sql = read();
    // SELECT of the PII columns
    expect(sql).toMatch(/revoke\s+select\s*\([^)]*notify_email[^)]*\)\s+on\s+(public\.)?audits\s+from\s+anon\s*,\s*authenticated/);
    // UPDATE of the service-role-written columns (notify + progress)
    expect(sql).toMatch(/revoke\s+update\s*\([^)]*notify_email[^)]*\)\s+on\s+(public\.)?audits\s+from\s+anon\s*,\s*authenticated/);
  });
});
