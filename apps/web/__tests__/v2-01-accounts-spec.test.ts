import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { V1_READER_PLAN } from '../lib/entitlement-spec';
import { v1EntitlementReaders } from './helpers/accounts-spec-catalog';
import { SPEC_PATH, buildAccountsSpec } from './helpers/accounts-spec-build';

describe('docs/specs/v2/01-accounts.md', () => {
  it('is what the generator writes', async () => {
    expect(readFileSync(SPEC_PATH, 'utf8')).toBe(await buildAccountsSpec());
  }, 120_000);

  it('gives every v1 entitlement reader a plan, and plans no file that is not one', () => {
    expect(Object.keys(V1_READER_PLAN).sort()).toEqual(v1EntitlementReaders());
  });
});
