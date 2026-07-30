import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SPEC 05 §11/§12 security guard — the direct sibling of `spec04-column-privilege-guard.test.ts`,
 * which exists precisely because a round-1 bare column REVOKE once shipped INERT on this repo.
 *
 * `20260727000001` subtracts `pages.ai_signals` from the anon/authenticated column grants. Without a
 * guard, nothing in the suite would fail if it regressed to the proven-inert form: Postgres computes
 * effective column access as the UNION of table- and column-level grants, so a bare
 * `REVOKE SELECT (ai_signals)` is a no-op while the default table grant stands. The migration would
 * still read like a fix, still apply without error, and still leave the paywall open.
 *
 * What is at stake: `pages.ai_signals` carries the per-page excerpt, which is the Pro-owner
 * "What AI Sees" artifact. RLS still scopes rows to the owner's own audits (anon reads 0 rows), so
 * this is PAYWALL INTEGRITY, not cross-tenant exposure — but a signed-in FREE owner could otherwise
 * read every excerpt straight from PostgREST and skip the gate entirely.
 *
 * This guard pins the MECHANISM in source. Effectiveness against the live DB is proven separately by
 * the three `has_column_privilege` checks in `docs/deploy/spec05-migration-runbook.md`, which are a
 * merge gate. FAILS LOUD (ENOENT) if the migration is renamed or removed.
 */
const MIGRATION = 'infra/supabase/migrations/20260727000001_spec05_pages_ai_signals_privilege.sql';
const RUNBOOK = 'docs/deploy/spec05-migration-runbook.md';
const read = (rel: string) => readFileSync(resolve(__dirname, '../../..', rel), 'utf8');
const sql = () => read(MIGRATION).toLowerCase();
/** Executable statements only — this file's header prose discusses REVOKE and service_role at length. */
const stmts = () => sql().replace(/--[^\n]*/g, '');

describe('SPEC 05 pages.ai_signals column-privilege migration (effective, not text-only)', () => {
  it('revokes the TABLE-LEVEL select — the only form that overrides the default table grant', () => {
    expect(sql()).toMatch(/revoke\s+select\s+on\s+(public\.)?pages\s+from\s+anon\s*,\s*authenticated/);
  });

  it('re-grants SELECT on a column list, so legitimate client reads keep working', () => {
    // Without the re-grant the REVOKE lands alone and every client read of `pages` breaks. That is the
    // failure mode the runbook's third verification (`url` → true) exists to catch on the live DB.
    expect(sql()).toMatch(/grant\s+select\s*\(%s\)\s+on\s+public\.pages\s+to\s+anon\s*,\s*authenticated/);
  });

  it('builds the grant list to EXCLUDE ai_signals, generated at apply time', () => {
    // Generated from information_schema rather than hardcoded, so a column added between authoring and
    // applying cannot be silently dropped from the grant.
    expect(sql()).toMatch(/from information_schema\.columns/);
    expect(sql()).toMatch(/column_name\s*<>\s*'ai_signals'/);
  });

  it('does NOT rely on a bare column-scoped revoke (the proven-inert form)', () => {
    expect(sql()).not.toMatch(/revoke\s+select\s*\(\s*ai_signals\s*\)\s+on/);
  });

  it('refuses to apply if the table is missing, rather than granting nothing silently', () => {
    // `string_agg` over an empty set returns NULL, and `grant select () ...` would be a syntax error at
    // best and a silent no-grant at worst. The migration must bail explicitly.
    expect(sql()).toMatch(/if cols is null then/);
    expect(sql()).toMatch(/raise exception/);
  });

  it('leaves service_role alone — every app read of `pages` is service-role', () => {
    // Asserted on statements only: the header prose discusses both REVOKE and service_role, and a
    // comment-inclusive match would fail on documentation rather than on behaviour.
    const s = stmts();
    expect(s).not.toMatch(/revoke[^;]*service_role/);
    expect(s).not.toMatch(/revoke\s+select\s+on\s+(public\.)?pages\s+from\s+public\b/);
    expect(s).toMatch(/revoke\s+select\s+on\s+public\.pages\s+from\s+anon,\s*authenticated/);
  });

  it('the RUNBOOK carries the three verifications and states the ordering constraint', () => {
    // The migration was written but referenced NOWHERE — no runbook entry, no guard, no spec mention.
    // An unreferenced migration is an unapplied migration; this pins the paper trail as well as the SQL.
    const doc = read(RUNBOOK);
    expect(doc).toContain('20260727000001');
    for (const check of [
      "has_column_privilege('authenticated','public.pages','ai_signals','SELECT')",
      "has_column_privilege('anon',         'public.pages','ai_signals','SELECT')",
      "has_column_privilege('authenticated','public.pages','url','SELECT')",
    ]) {
      expect(doc, `runbook must document: ${check}`).toContain(check);
    }
    expect(doc).toMatch(/AI_READINESS_EXTRACTION=1/);
    expect(doc.toLowerCase()).toContain('merge gate');
  });
});
