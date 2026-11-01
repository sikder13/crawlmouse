import { MAX_SKEW_MS } from './hmac.js';

/**
 * Single-use nonces. A nonce is remembered for twice the signature window, longer than any timestamp
 * that could still verify, so a captured request cannot be replayed after its nonce is forgotten.
 * Bounded: past MAX_NONCES the oldest are forgotten first.
 */

export const NONCE_TTL_MS = 2 * MAX_SKEW_MS;
export const MAX_NONCES = 100_000;

export class Nonces {
  private readonly seen = new Map<string, number>();

  constructor(private readonly now: () => number) {}

  /** True the first time a nonce is presented; false on every later presentation within the TTL. */
  claim(nonce: string): boolean {
    const t = this.now();
    for (const [k, at] of this.seen) {
      if (t - at <= NONCE_TTL_MS) break; // insertion order is time order
      this.seen.delete(k);
    }
    if (this.seen.has(nonce)) return false;
    this.seen.set(nonce, t);
    if (this.seen.size > MAX_NONCES) this.seen.delete(this.seen.keys().next().value!);
    return true;
  }
}
