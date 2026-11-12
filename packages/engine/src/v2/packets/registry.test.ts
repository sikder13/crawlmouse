import { describe, expect, it } from 'vitest';
import { FixTypeSchema, type FixType } from '@crawlmouse/types/v2';
import { PACKETS } from './registry.js';

/** The fix types the engine writes no packet for, each with its reason in its entry. */
const NO_PACKET: readonly FixType[] = ['robots_txt_blocks_crawler', 'js_only_navigation'];

describe('the packet registry', () => {
  it('has an entry for each fix type of the contract and no other', () => {
    expect(Object.keys(PACKETS).sort()).toEqual([...FixTypeSchema.options].sort());
  });

  describe.each(FixTypeSchema.options)('%s', (type) => {
    const entry = PACKETS[type];

    it('has a builder, or is one of the types with none and says why', () => {
      expect(entry.kind).toBe(NO_PACKET.includes(type) ? 'none' : 'builder');
      if (entry.kind === 'none') expect(entry.reason.length).toBeGreaterThan(20);
    });

    it('cites a documentation page for each stack body it writes', () => {
      if (entry.kind !== 'builder') return;
      for (const [framework, body] of Object.entries(entry.stacks)) {
        expect(body.sources.length, `${type} ${framework}`).toBeGreaterThan(0);
        for (const source of body.sources) {
          expect(source.url, `${type} ${framework}`).toMatch(/^https:\/\//);
          expect(source.read, `${type} ${framework}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
      }
    });
  });
});
