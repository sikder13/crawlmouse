/**
 * Ids the diff gives the records it creates: a UUID derived from what the record is, so the same
 * input always gives the same ids (version 8, the RFC 9562 layout for UUIDs a system defines itself).
 */
import { createHash } from 'node:crypto';

/** A UUID from the SHA-256 of `parts`, each length-prefixed so no two lists of parts collide. */
export function stableId(...parts: readonly string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(`${part.length}:${part};`);
  const bytes = hash.digest();
  bytes[6] = (bytes[6]! & 0x0f) | 0x80; // version 8
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // the RFC 9562 variant
  const hex = (from: number, to: number) => {
    let out = '';
    for (let i = from; i < to; i++) out += bytes[i]!.toString(16).padStart(2, '0');
    return out;
  };
  return `${hex(0, 4)}-${hex(4, 6)}-${hex(6, 8)}-${hex(8, 10)}-${hex(10, 16)}`;
}
