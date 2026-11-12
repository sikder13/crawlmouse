/**
 * What the engine writes for one fix besides its label and effect: the packet (registry.ts), the
 * effort (effort.ts) and the before and after rows (before-after.ts). The check builder hands this to
 * `detectorOutcomes`, whose `draft` calls it once per detected fix.
 */
import type { FixRecord } from '../grade/effects.js';
import type { WriteFix } from '../grade/outcomes.js';
import { beforeAfterOf } from './before-after.js';
import { effortOf } from './effort.js';
import { writePacket } from './registry.js';
import type { PacketFacts } from './types.js';

export const writtenFrom =
  (facts: PacketFacts): WriteFix =>
  (fix) => ({
    packet: packetOrNone(fix, facts),
    effort: effortOf(fix),
    before_after: beforeAfterOf(fix, facts),
  });

/**
 * A builder that throws on a record leaves its fix without a packet; the check is still built. A
 * packet is written from crawled data, and one page's markup must not cost the site its audit.
 */
function packetOrNone(fix: FixRecord, facts: PacketFacts): ReturnType<typeof writePacket> {
  try {
    return writePacket(fix.record.type, fix.record, facts);
  } catch {
    return null;
  }
}
