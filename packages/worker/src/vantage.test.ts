import { describe, expect, it } from 'vitest';
import { UNRELEASED, vantageOf } from './vantage.js';

/**
 * Where the worker's requests come from, read from the environment Fly gives a Machine
 * (FLY_REGION, FLY_MACHINE_ID): Fly egress only when both are present, and never a region invented
 * off Fly.
 */

describe('vantageOf', () => {
  it('on a Fly Machine: its region, and fly_egress', () => {
    expect(vantageOf({ FLY_REGION: 'iad', FLY_MACHINE_ID: '3d8d9e1c2f4e89' }, 'abc123def456')).toEqual(
      { flyRegion: 'iad', sourceIpClass: 'fly_egress', release: 'abc123def456' },
    );
  });

  it('off Fly: no region, and other_egress', () => {
    expect(vantageOf({}, UNRELEASED)).toEqual({
      flyRegion: null,
      sourceIpClass: 'other_egress',
      release: UNRELEASED,
    });
  });

  it('a region without a Machine id is not Fly: the region alone is a variable anyone can set', () => {
    expect(vantageOf({ FLY_REGION: 'iad' }, UNRELEASED)).toMatchObject({
      flyRegion: null,
      sourceIpClass: 'other_egress',
    });
  });

  it.each(['IAD', 'iad1', 'ia', '', 'iad\n', 'x'.repeat(100)])(
    'refuses to start on Fly with a malformed FLY_REGION (%j)',
    (FLY_REGION) => {
      expect(() => vantageOf({ FLY_REGION, FLY_MACHINE_ID: 'm' }, UNRELEASED)).toThrow(/FLY_REGION/);
    },
  );

  it('the release is a short commit id or the unreleased marker, nothing else', () => {
    expect(() => vantageOf({}, 'not a sha')).toThrow(/release/);
    expect(() => vantageOf({}, 'abcdef0123456')).toThrow(/release/);
  });
});
