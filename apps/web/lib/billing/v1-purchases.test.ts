import { describe, expect, it } from 'vitest';
import { v1PurchasesClosed } from './v1-purchases';

describe('v1PurchasesClosed (CC-45 hotfix)', () => {
  it.each([
    ['public checks on, billing off', true, { V2_CHECKS_PUBLIC: '1' }],
    [
      'public checks on with whitespace, billing off',
      true,
      { V2_CHECKS_PUBLIC: ' 1\n', V2_BILLING: '' },
    ],
    ['public checks on, billing on', false, { V2_CHECKS_PUBLIC: '1', V2_BILLING: '1' }],
    ['both off (v1 as it was)', false, {}],
    ['public checks off, billing on', false, { V2_BILLING: '1' }],
    ['public checks set to a value that is not 1', false, { V2_CHECKS_PUBLIC: 'true' }],
  ])('%s → closed: %s', (_, closed, env) => {
    expect(v1PurchasesClosed(env)).toBe(closed);
  });
});
