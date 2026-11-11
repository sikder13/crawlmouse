/**
 * The account flows' rate-limit keys that hold a client address. The address is never stored as
 * written: a bucket ends in its sha256, so the rate-limit table holds no address. The erasure does not
 * remove such a bucket (nothing ties the hash to a person); `prune_rate_limits` deletes it 25 hours
 * after its window starts (`lib/rate-limit-window.ts`).
 */
import { createHash } from 'node:crypto';

/** sha256 of the address as `getClientIp` returns it, lowercase hex. */
export function ipHash(ip: string): string {
  return createHash('sha256').update(ip, 'utf8').digest('hex');
}
