import { PACKETS } from '@crawlmouse/engine/v2/pipeline';
import { FixTypeSchema, type FixType } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { FOUND_ABOVE, NOT_WRITTEN_BY_CHECK, NO_STEPS_FOR_TYPE, noPacketLine } from './no-packet';
import { noPacketReason } from './packet-reason';

/** A registry in which `built` has a builder and each other type has none, with its name as the reason. */
const registryWith = (built: FixType) =>
  Object.fromEntries(
    FixTypeSchema.options.map((t) => [
      t,
      t === built
        ? { kind: 'builder' as const }
        : { kind: 'none' as const, reason: `No packet for ${t}.` },
    ]),
  ) as Parameters<typeof noPacketReason>[1];

describe('noPacketReason', () => {
  it('is the registry’s reason for a type the engine writes no packet for', () => {
    const registry = registryWith('orphan_pages');
    for (const type of FixTypeSchema.options.filter((t) => t !== 'orphan_pages')) {
      expect(noPacketReason(type, registry)).toBe(`No packet for ${type}.`);
    }
  });

  it('is null for a type that has a builder: a stored fix without a packet predates it', () => {
    expect(noPacketReason('orphan_pages', registryWith('orphan_pages'))).toBeNull();
    expect(noPacketReason('deep_pages', registryWith('deep_pages'))).toBeNull();
  });

  it('reads the engine’s registry: a robots.txt disallow has its reason there', () => {
    const entry = PACKETS.robots_txt_blocks_crawler;
    if (entry.kind !== 'none') throw new Error('the engine writes no packet for a robots.txt rule');
    expect(noPacketReason('robots_txt_blocks_crawler')).toBe(entry.reason);
    expect(entry.reason).toMatch(/robots\.txt/);
  });

  it('agrees with the engine’s registry on every fix type', () => {
    for (const type of FixTypeSchema.options) {
      const entry = PACKETS[type];
      expect(noPacketReason(type), type).toBe(entry.kind === 'none' ? entry.reason : null);
    }
  });
});

describe('noPacketLine', () => {
  it('gives the engine’s reason for a type with no builder, and says where the finding is', () => {
    expect(noPacketLine('The render step keeps no rendered link.')).toBe(
      `${NO_STEPS_FOR_TYPE} The render step keeps no rendered link. ${FOUND_ABOVE}`,
    );
  });

  it('says the last check wrote no steps when the type has a builder', () => {
    expect(noPacketLine(null)).toBe(`${NOT_WRITTEN_BY_CHECK} ${FOUND_ABOVE}`);
    expect(noPacketLine(null)).toBe(
      'The check that last measured this fix wrote no steps for it. The next check that finds it writes them. What the audit found is above.',
    );
  });
});
