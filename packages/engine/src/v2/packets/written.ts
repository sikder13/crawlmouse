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

/** Told when a builder throws on a record: the fix type, the fix's fingerprint and the error. */
export type BuilderFault = (fault: {
  type: FixRecord['record']['type'];
  fingerprint: string;
  error: unknown;
}) => void;

/**
 * `onFault` hears of a builder that threw. The fix then carries no packet and the check is still
 * built: a packet is written from crawled data, and one page's markup must not cost the site its
 * audit. Without a listener the fault is dropped.
 */
export const writtenFrom =
  (facts: PacketFacts, onFault: BuilderFault = () => {}): WriteFix =>
  (fix) => ({
    packet: packetOrNone(fix, facts, onFault),
    effort: effortOf(fix),
    before_after: beforeAfterOf(fix, facts),
  });

function packetOrNone(
  fix: FixRecord,
  facts: PacketFacts,
  onFault: BuilderFault,
): ReturnType<typeof writePacket> {
  try {
    return writePacket(fix.record.type, fix.record, facts);
  } catch (error) {
    onFault({ type: fix.record.type, fingerprint: fix.record.fingerprint, error });
    return null;
  }
}
