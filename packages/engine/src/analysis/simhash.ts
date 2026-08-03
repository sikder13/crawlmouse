import { createHash } from 'node:crypto';

/**
 * SPEC 5.1a §5.4 — 64-bit SimHash for near-duplicate collapsing, Hamming distance k=3 (Manku, Jain &
 * Das Sarma, WWW 2007 — Google's validated web-scale parameterisation).
 *
 * EVERY KNOB IS PINNED HERE, deliberately, because §5.4 requires it: "Fixed, pinned tokenizer and hash
 * — determinism depends on it, so do not rely on library defaults." That is not fussiness. The
 * duplicate decision feeds the gradeable population, which feeds the grade; a tokenizer that varied
 * with locale or a hash that varied across Node builds would put non-determinism directly into the
 * product's central claim.
 *
 * Nothing here touches `localeCompare`, `Intl`, or any collation — the same lesson `url-canonical.ts`
 * records about codepoint ordering.
 */

/** Hamming distance at or below which two documents are the same document (§5.4). */
export const SIMHASH_HAMMING_K = 3;

/**
 * Token budget per document. Bounds CPU on a hostile page (the engine crawls arbitrary HTML) while
 * keeping the result deterministic: the bound is a PREFIX, never a sample, so the same text always
 * yields the same tokens. A sampled bound would make the hash depend on a random draw.
 */
export const SIMHASH_MAX_TOKENS = 5000;

/** Words per shingle. Shingling is what makes the hash order-sensitive; a bag of words is not. */
const SHINGLE_SIZE = 3;

/**
 * Fewest tokens a document must have before a duplicate VERDICT is trustworthy. Measured, not guessed:
 * the k=3 threshold is calibrated for web-scale documents, and on short text a trivial edit blows
 * straight past it.
 *
 *   tokens |  distance after a one-word edit
 *       10 |  12-13
 *       20 |   7-12
 *       40 |   5-10
 *       80 |    1-4
 *      160 |    0-2
 *
 * Below ~100 tokens the distance is dominated by how few shingles exist rather than by how similar the
 * documents are, so a k=3 verdict there means nothing. `simhashForDedup` returns null under this floor
 * and such pages are never collapsed — the conservative direction, matching §5.3: when the signal is
 * ambiguous, keep the page. Failing to collapse a duplicate costs a little accounting; wrongly
 * collapsing two real pages deletes one from the graph and manufactures the orphan we exist to detect.
 */
export const SIMHASH_MIN_TOKENS = 100;

/**
 * The pinned tokenizer: NFKC-normalise, lowercase, split on anything that is not a letter or a number,
 * drop single-character tokens, truncate to the budget.
 *
 * NFKC matters for a reason that is easy to miss: without it, text containing a ligature or a
 * full-width form tokenises differently from the visually identical plain text, so two renderings of
 * one page would not collapse. `\p{L}\p{N}` rather than `[a-z0-9]` matters more: an ASCII-only split
 * reduces a Japanese page to ZERO tokens, and every zero-token page hashes identically — so an
 * ASCII-only tokenizer would silently declare every non-Latin page a duplicate of every other.
 */
export function tokenizeForSimhash(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 2) continue;
    out.push(raw);
    if (out.length >= SIMHASH_MAX_TOKENS) break;
  }
  return out;
}

/**
 * 64-bit feature hash: the first 8 bytes of SHA-256, big-endian.
 *
 * SHA-256 rather than a hand-rolled 64-bit mixer because `node:crypto` is already a dependency
 * (`url-canonical.ts` uses it), its output is fixed by the standard rather than by a library version,
 * and code that does not exist cannot drift. The cost is one hash per shingle, bounded by
 * SIMHASH_MAX_TOKENS.
 */
function featureHash(token: string): bigint {
  const digest = createHash('sha256').update(token).digest();
  return digest.readBigUInt64BE(0);
}

/**
 * 64-bit SimHash over the extracted main-content text.
 *
 * Per-bit majority over the shingle hashes: each shingle votes +1 for every set bit and −1 for every
 * clear bit, and the output bit is 1 where the sum is positive. Ties (sum exactly 0, reachable with an
 * even shingle count) resolve to 0 — an arbitrary but PINNED choice, and pinning it is the point.
 *
 * Empty or whitespace-only text yields the all-zero hash. That is correct and also why callers must not
 * feed this pages below the thin threshold: every empty document is a duplicate of every other, which
 * is true but useless, and acting on it would collapse unrelated thin pages.
 */
export function simhash64(text: string): string {
  const tokens = tokenizeForSimhash(text);
  const votes = new Int32Array(64);
  const shingleCount = Math.max(0, tokens.length - SHINGLE_SIZE + 1);
  for (let i = 0; i < shingleCount; i++) {
    const h = featureHash(tokens.slice(i, i + SHINGLE_SIZE).join(' '));
    for (let b = 0; b < 64; b++) {
      votes[b]! += (h >> BigInt(63 - b)) & 1n ? 1 : -1;
    }
  }
  // Shorter than one shingle: hash the whole token run so two short pages still differ from each other.
  if (shingleCount === 0 && tokens.length > 0) {
    const h = featureHash(tokens.join(' '));
    for (let b = 0; b < 64; b++) votes[b]! += (h >> BigInt(63 - b)) & 1n ? 1 : -1;
  }
  let value = 0n;
  for (let b = 0; b < 64; b++) value = (value << 1n) | (votes[b]! > 0 ? 1n : 0n);
  return value.toString(16).padStart(16, '0');
}

/**
 * The hash to use for DUPLICATE DETECTION specifically: null when the document is too short for a
 * k=3 verdict to mean anything (see SIMHASH_MIN_TOKENS). `simhash64` stays available for callers that
 * want the raw value regardless of length.
 */
export function simhashForDedup(text: string): string | null {
  if (tokenizeForSimhash(text).length < SIMHASH_MIN_TOKENS) return null;
  return simhash64(text);
}

/** Population count of the XOR — the number of differing bits between two 64-bit hex hashes. */
export function hammingDistance(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (x) {
    x &= x - 1n; // clear the lowest set bit
    count++;
  }
  return count;
}
