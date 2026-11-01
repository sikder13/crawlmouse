/**
 * Ids the diff gives the records it creates: a UUID derived from what the record is, so the same
 * input always gives the same ids (version 8, the RFC 9562 layout for UUIDs a system defines itself).
 */
import { createHash } from 'node:crypto';

/** A UUID from the SHA-256 of `parts`, each length-prefixed so no two lists of parts collide. */
export function stableId(...parts: readonly string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(`${part.length}:${part};`);
  const hex = hash.digest('hex');
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `8${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}
