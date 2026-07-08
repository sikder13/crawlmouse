import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SPEC 04 §11/§12 security guard (adversarial-gate hardening, round 2). The Runbook A/B migrations
// add columns to two tables with LIVE anon/authenticated PostgREST access. Because Supabase grants
// table-level SELECT/UPDATE by default and Postgres unions table- and column-level grants, a bare
// `REVOKE SELECT (col)` is a NO-OP — the ONLY effective hardening is REVOKE the table-level
// privilege then GRANT it back on a column list that EXCLUDES the sensitive columns.
//
// This guard therefore pins the EFFECTIVE mechanism, not just "a revoke exists" (the round-1 guard's
// flaw — it green-lit an inert column-only revoke). It fails if the migration regresses to the
// ineffective form (table-level revoke missing) OR if a sensitive column is handed back in a grant.
// FAILS LOUD (ENOENT) if the file is renamed/removed. Effectiveness itself was proven against the
// live DB with a rolled-back has_column_privilege probe; the migration ships that probe as a
// documented post-apply verification.
const MIGRATION = 'infra/supabase/migrations/20260707000003_spec04_column_privilege_hardening.sql';
const read = () => readFileSync(resolve(__dirname, '../../..', MIGRATION), 'utf8').toLowerCase();

describe('SPEC 04 column-privilege hardening migration (effective, not text-only)', () => {
  it('uses TABLE-LEVEL revokes (the only form that overrides the default table grant)', () => {
    const sql = read();
    // Table-level (no column parens) revoke of SELECT + UPDATE on both tables.
    for (const table of ['audits', 'public_reports']) {
      expect(sql, `${table} needs a table-level SELECT revoke`).toMatch(
        new RegExp(`revoke\\s+select\\s+on\\s+(public\\.)?${table}\\s+from\\s+anon\\s*,\\s*authenticated`),
      );
      expect(sql, `${table} needs a table-level UPDATE revoke`).toMatch(
        new RegExp(`revoke\\s+update\\s+on\\s+(public\\.)?${table}\\s+from\\s+anon\\s*,\\s*authenticated`),
      );
    }
  });

  it('re-grants SELECT back to the roles (so legitimate reads keep working) excluding the sensitive columns', () => {
    const sql = read();
    // A column-scoped SELECT grant is re-issued for each table…
    expect(sql).toMatch(/grant\s+select\s*\(%s\)\s+on\s+public\.audits\s+to\s+anon\s*,\s*authenticated/);
    expect(sql).toMatch(/grant\s+select\s*\(%s\)\s+on\s+public\.public_reports\s+to\s+anon\s*,\s*authenticated/);
    // …and the grant column list is built to EXCLUDE the sensitive columns.
    expect(sql, 'audits grant must exclude notify_email').toMatch(/not in \([^)]*'notify_email'[^)]*\)/);
    expect(sql, 'public_reports grant must exclude minted_by').toMatch(/column_name\s*<>\s*'minted_by'/);
  });

  it('does NOT rely on a bare column-scoped revoke as a control (the proven-inert form)', () => {
    const sql = read();
    // The migration must not present `revoke select (minted_by) ... from anon` as THE control — that
    // is a no-op against the table grant and is exactly what round 1 shipped by mistake.
    expect(sql).not.toMatch(/revoke\s+select\s*\(\s*minted_by\s*\)\s+on/);
    expect(sql).not.toMatch(/revoke\s+select\s*\([^)]*notify_email[^)]*\)\s+on/);
  });
});
