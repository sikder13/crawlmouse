import { describe, expect, it } from 'vitest';

import { accountDoorEnabled, pipelineEnabled } from './flags';
import { trialVariantFor } from './trial-variant';

describe('flags', () => {
  it.each([
    ['1', true],
    [' 1\n', true],
    ['0', false],
    ['true', false],
    ['', false],
    [undefined, false],
  ])('V2_ACCOUNT_DOOR=%j → %s, and V2_PIPELINE the same', (value, on) => {
    expect(accountDoorEnabled({ V2_ACCOUNT_DOOR: value })).toBe(on);
    expect(pipelineEnabled({ V2_PIPELINE: value })).toBe(on);
  });

  it('the two flags are independent', () => {
    expect(accountDoorEnabled({ V2_PIPELINE: '1' })).toBe(false);
    expect(pipelineEnabled({ V2_ACCOUNT_DOOR: '1' })).toBe(false);
  });
});

describe('trialVariantFor', () => {
  it('is no_card for every sign-up until CC-03', () => {
    expect(trialVariantFor('a@b.co')).toBe('no_card');
  });
});
