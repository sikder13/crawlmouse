import { describe, it, expect } from 'vitest';
import { isUndefinedColumnError } from './pg-errors';

// Deploy-order safety hinges on detecting an "unknown column" error across BOTH surfaces:
//   - a SELECT / filter of an unknown column → Postgres passes SQLSTATE 42703 through PostgREST;
//   - an unknown column in a WRITE BODY (insert/update) → PostgREST returns its own PGRST204
//     ("Could not find the '<col>' column of '<table>' in the schema cache"), NOT 42703.
// Both must trigger the legacy/503 fallback; a transient error must NOT.

describe('isUndefinedColumnError', () => {
  it('matches the Postgres undefined-column code (42703) — SELECT/filter reads', () => {
    expect(isUndefinedColumnError({ code: '42703', message: 'column "report_snapshot" does not exist' })).toBe(true);
  });

  it('matches the PostgREST schema-cache code (PGRST204) — write bodies (mint INSERT / hide UPDATE)', () => {
    expect(isUndefinedColumnError({ code: 'PGRST204', message: "Could not find the 'report_snapshot' column of 'public_reports' in the schema cache" })).toBe(true);
  });

  it('falls back to a message match when the code is unexpected (version variance)', () => {
    expect(isUndefinedColumnError({ code: 'PGRST999', message: 'Could not find the column in the schema cache' })).toBe(true);
    expect(isUndefinedColumnError({ message: 'column "hidden_at" does not exist' })).toBe(true);
  });

  it('is FALSE for a transient / unrelated error, null, or a non-object (never a spurious fallback)', () => {
    expect(isUndefinedColumnError({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(false);
    expect(isUndefinedColumnError({ code: '23505', message: 'duplicate key value' })).toBe(false);
    expect(isUndefinedColumnError(null)).toBe(false);
    expect(isUndefinedColumnError(undefined)).toBe(false);
    expect(isUndefinedColumnError('boom')).toBe(false);
  });
});
