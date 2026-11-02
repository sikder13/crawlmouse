/**
 * Fix fingerprints. ENGINE-GAP §5 names each fix by a readable key (`orphan:{url}`); the contract
 * stores 16 hex characters (`FingerprintSchema`). A fingerprint is the first 16 hex characters of the
 * key's SHA-256, so the same key always gives the same fingerprint on every check.
 */
import { createHash } from 'node:crypto';
import type { FixType } from '@crawlmouse/types/v2';

/** The key prefix of each structure fix type (ENGINE-GAP §5). */
export const KEY_PREFIX = {
  orphan_pages: 'orphan',
  deep_pages: 'depth',
  generic_anchor_text: 'anchors',
  redirect_chain: 'redirect',
  duplicate_pagination: 'pagination',
  canonical_mismatch: 'canonical',
  hreflang_gap: 'hreflang',
} as const satisfies Partial<Record<FixType, string>>;

export type StructureFixType = keyof typeof KEY_PREFIX;

export const fingerprintKey = (type: StructureFixType, subject: string): string =>
  `${KEY_PREFIX[type]}:${subject}`;

/** The first 64 bits of the key's SHA-256, as 16 hex characters. */
export const fingerprintOf = (key: string): string =>
  createHash('sha256')
    .update(key, 'utf8')
    .digest()
    .readBigUInt64BE(0)
    .toString(16)
    .padStart(16, '0');
