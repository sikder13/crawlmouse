import { describe, expect, it } from 'vitest';
import {
  agencySalesOpen,
  billingOnlyUser,
  billingOpenTo,
  billingPublic,
  billingV2Enabled,
} from './flags';

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

describe('agencySalesOpen', () => {
  it.each([
    ['1', true],
    [' 1\n', true],
    ['0', false],
    ['true', false],
    ['', false],
    [undefined, false],
  ])('V2_AGENCY_SALES=%j → %s', (value, on) => {
    expect(agencySalesOpen({ V2_AGENCY_SALES: value })).toBe(on);
  });

  it('is not opened by V2_BILLING', () => {
    expect(agencySalesOpen({ V2_BILLING: '1' })).toBe(false);
  });
});

describe('the owner-only window (V2_BILLING_ONLY_USER)', () => {
  const OWNER = '11111111-1111-4111-8111-111111111111';
  const OTHER = '22222222-2222-4222-8222-222222222222';
  const env = (only: string | undefined, billing = '1') => ({
    V2_BILLING: billing,
    V2_BILLING_ONLY_USER: only,
  });

  it('unset: paying is open to everyone signed in, and public', () => {
    expect(billingOpenTo(OTHER, env(undefined))).toBe(true);
    expect(billingPublic(env(undefined))).toBe(true);
    expect(billingOnlyUser(env(''))).toBeNull();
  });

  it('set: open to that user alone, and not public', () => {
    expect(billingOpenTo(OWNER, env(OWNER))).toBe(true);
    expect(billingOpenTo(` ${OWNER} `.trim(), env(` ${OWNER} `))).toBe(true);
    expect(billingOpenTo(OTHER, env(OWNER))).toBe(false);
    expect(billingOpenTo(null, env(OWNER))).toBe(false);
    expect(billingPublic(env(OWNER))).toBe(false);
  });

  it('with billing off, the variable opens nothing', () => {
    expect(billingOpenTo(OWNER, env(OWNER, ''))).toBe(false);
    expect(billingPublic(env(undefined, ''))).toBe(false);
  });
});
