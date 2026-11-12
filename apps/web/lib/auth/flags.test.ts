import { describe, expect, it } from 'vitest';

import {
  accountDoorEnabled,
  checksPublicEnabled,
  pipelineEnabled,
  v2PublicPagesEnabled,
} from './flags';
import { trialVariantFor } from './trial-variant';

describe('flags', () => {
  it.each([
    ['1', true],
    [' 1\n', true],
    ['0', false],
    ['true', false],
    ['', false],
    [undefined, false],
  ])('V2_ACCOUNT_DOOR=%j → %s, and V2_PIPELINE and V2_CHECKS_PUBLIC the same', (value, on) => {
    expect(accountDoorEnabled({ V2_ACCOUNT_DOOR: value })).toBe(on);
    expect(pipelineEnabled({ V2_PIPELINE: value })).toBe(on);
    expect(checksPublicEnabled({ V2_CHECKS_PUBLIC: value })).toBe(on);
  });

  it('the three flags are independent', () => {
    expect(accountDoorEnabled({ V2_PIPELINE: '1', V2_CHECKS_PUBLIC: '1' })).toBe(false);
    expect(pipelineEnabled({ V2_ACCOUNT_DOOR: '1', V2_CHECKS_PUBLIC: '1' })).toBe(false);
    expect(checksPublicEnabled({ V2_ACCOUNT_DOOR: '1', V2_PIPELINE: '1' })).toBe(false);
  });
});

describe('trialVariantFor', () => {
  it('is no_card for every sign-up until CC-03', () => {
    expect(trialVariantFor('a@b.co')).toBe('no_card');
  });
});

describe('v2PublicPagesEnabled', () => {
  it('is on when either flag is 1, and off when neither is', () => {
    expect(v2PublicPagesEnabled({ V2_CHECKS_PUBLIC: '1' })).toBe(true);
    expect(v2PublicPagesEnabled({ V2_BILLING: ' 1 ' })).toBe(true);
    expect(v2PublicPagesEnabled({})).toBe(false);
    expect(v2PublicPagesEnabled({ V2_CHECKS_PUBLIC: 'true', V2_BILLING: '0' })).toBe(false);
  });
});
