import { describe, expect, it } from 'vitest';
import { billingV2Enabled } from './flags';

describe('billingV2Enabled', () => {
  it.each([
    ['1', true],
    [' 1\n', true],
    ['0', false],
    ['true', false],
    ['', false],
    [undefined, false],
  ])('V2_BILLING=%j → %s', (value, on) => {
    expect(billingV2Enabled({ V2_BILLING: value })).toBe(on);
  });

  it('is not switched on by the other v2 flags', () => {
    expect(billingV2Enabled({ V2_ACCOUNT_DOOR: '1', V2_PIPELINE: '1' })).toBe(false);
  });
});
