/**
 * The account flows' rate-limit keys that hold a client address. The address is not stored as
 * written: a bucket ends in its unsalted sha256. That keeps the address out of a casual read of the
 * table, not from someone who wants it back: an IPv4 address is one of about four billion, and their
 * hashes can all be computed. Nothing in the key names the person, so the erasure does not remove such
 * a bucket; `prune_rate_limits` deletes it 25 hours after its window starts
 * (`lib/rate-limit-window.ts`).
 */
import { createHash } from 'node:crypto';

/** sha256 of the address as `getClientIp` returns it, lowercase hex. */
export function ipHash(ip: string): string {
  return createHash('sha256').update(ip, 'utf8').digest('hex');
}
