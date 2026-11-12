import { describe, expect, it } from 'vitest';
import { FixTypeSchema, type FixType } from '@crawlmouse/types/v2';
import { NOT_WRITTEN } from './by-type/pending.js';
import { PACKETS } from './registry.js';

/** The fix types the engine writes no packet for, each with its reason in its entry. */
const NO_PACKET: readonly FixType[] = ['robots_txt_blocks_crawler', 'js_only_navigation'];

describe('the packet registry', () => {
  it('has an entry for each fix type of the contract and no other', () => {
    expect(Object.keys(PACKETS).sort()).toEqual([...FixTypeSchema.options].sort());
  });

  describe.each(FixTypeSchema.options)('%s', (type) => {
    const entry = PACKETS[type];
    // A type still waiting for its builder is expected to fail here; the moment its builder is
    // written this turns into an ordinary test, and `it.fails` would then fail on a pass.
    const check = entry === NOT_WRITTEN ? it.fails : it;

    check('has a builder, or is one of the types with none', () => {
      expect(entry).not.toBe(NOT_WRITTEN);
      expect(entry.kind).toBe(NO_PACKET.includes(type) ? 'none' : 'builder');
    });

    it('gives its reason when it has no builder', () => {
      if (entry.kind === 'none') expect(entry.reason.length).toBeGreaterThan(20);
    });
  });
});
