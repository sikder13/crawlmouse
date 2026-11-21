import { describe, expect, it } from 'vitest';
import { v1PurchasesClosed } from './v1-purchases';

describe('v1PurchasesClosed (CC-45 hotfix)', () => {
  it.each([
    ['public checks on, billing off', { V2_CHECKS_PUBLIC: '1' }, true],
    [
      'public checks on with whitespace, billing off',
      { V2_CHECKS_PUBLIC: ' 1\n', V2_BILLING: '' },
      true,
    ],
    ['public checks on, billing on', { V2_CHECKS_PUBLIC: '1', V2_BILLING: '1' }, false],
    ['both off (v1 as it was)', {}, false],
    ['public checks off, billing on', { V2_BILLING: '1' }, false],
    ['public checks set to a value that is not 1', { V2_CHECKS_PUBLIC: 'true' }, false],
  ])('%s → %s', (_, env, closed) => {
    expect(v1PurchasesClosed(env)).toBe(closed);
  });
});
