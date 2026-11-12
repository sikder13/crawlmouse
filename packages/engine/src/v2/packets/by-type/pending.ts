/** The entry of a fix type whose packet builder is not written yet. registry.test.ts expects none. */
import type { NoPacket } from '../types.js';

export const NOT_WRITTEN: NoPacket = {
  kind: 'none',
  reason: 'The packet builder is not written yet.',
};
