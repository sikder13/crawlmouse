import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { V1_READER_PLAN } from '../lib/entitlement-spec';
import { readSpecCatalog, v1EntitlementReaders } from './helpers/accounts-spec-catalog';
import { SPEC_PATH, buildAccountsSpec } from './helpers/accounts-spec-build';
import { applyAllMigrations, freshDb } from './helpers/pglite-migrations';

describe('docs/specs/v2/01-accounts.md', () => {
  it('is what the generator writes', async () => {
    expect(readFileSync(SPEC_PATH, 'utf8')).toBe(await buildAccountsSpec());
  }, 120_000);

  it('gives every v1 entitlement reader a plan, and plans no file that is not one', () => {
    expect(Object.keys(V1_READER_PLAN).sort()).toEqual(v1EntitlementReaders());
  });

  it('reads grants from the catalog as the migration writes them (hand-written truth)', async () => {
    // The file test above compares the doc with the generator, so a reader that misreads the
    // catalog would agree with itself. These values are typed from the migration by hand.
    const db = await freshDb();
    await applyAllMigrations(db);
    const catalog = await readSpecCatalog(db);
    expect(Object.fromEntries(catalog.functions.map((f) => [f.name, f.execute]))).toEqual({
      apply_entitlement_transition: ['service_role'],
      assert_entitlement_version: ['service_role'],
      accounts_keep_first_history_entry: [],
      handle_new_user: ['service_role'],
      is_member: ['authenticated', 'service_role'],
      member_role: ['authenticated', 'service_role'],
    });
    const byTable = Object.fromEntries(catalog.tables.map((t) => [t.name, t.grants]));
    // 027b adds the deletion mark, and CC-29 the agency trial's Checkout and consent, which no client reads.
    expect(byTable.accounts!.hiddenColumns).toEqual([
      'stripe_customer_id',
      'deletion_confirmed_at',
      'purge_after',
      'agency_checkout_url',
      'agency_checkout_at',
      'agency_checkout_interval',
      'agency_trial_consent_at',
    ]);
    // 031 adds the invitation's expiry and number, which no client reads.
    expect(byTable.seats!.hiddenColumns).toEqual([
      'invite_token_hash',
      'invite_expires_at',
      'invite_seq',
    ]);
    expect(byTable.trial_ledger!.authenticatedColumns).toBeNull();
    for (const t of catalog.tables) {
      expect(t.grants.anon, t.name).toEqual([]);
      expect(t.grants.authenticated, t.name).toEqual([]);
    }
  }, 120_000);
});
