import { EXCERPT_MAX_BYTES } from './constants.js';
import { toPersistableText } from '../../text-safety.js';

/**
 * §4.4 — the "What AI Sees" excerpt. The first `EXCERPT_MAX_BYTES` of the ALREADY-density-filtered
 * main-content text (the caller passes `.text()` output — NEVER a raw-HTML slice), truncated at a word
 * boundary and trimmed. Deterministic (R1): same input → identical bytes.
 *
 * The cut goes through `toPersistableText` because this value is persisted into the `pages.ai_signals`
 * jsonb column: a raw `.slice()` at a code-unit boundary can split a surrogate pair, and Postgres
 * rejects an unpaired surrogate — which fails the pages insert and therefore the WHOLE audit. Reachable
 * innocently on emoji-dense pages and on scripts without spaces (the `lastSpace <= 0` branch returns the
 * raw cut). Byte-identical to the previous implementation for text that is well-formed and has no pair
 * straddling the boundary — i.e. for every existing fixture.
 */
export function buildExcerpt(text: string): string {
  const cut = toPersistableText(text, EXCERPT_MAX_BYTES);
  // TRUNCATION is the only trigger for the word-boundary trim. Comparing `cut === text` conflated
  // "was truncated" with "was rewritten", so a single stripped control or repaired surrogate anywhere
  // in the page made the trim fire at FULL length and eat the trailing word — on the FREE homepage
  // view, the conversion surface. Compare BYTES instead: the value was truncated iff it no longer
  // carries the whole input's persistable byte length.
  // Every code point is at most 4 UTF-8 bytes, so if four extra bytes of budget admit nothing more,
  // the input was exhausted and nothing was truncated. (A length comparison against the budget would
  // be wrong: a cut can stop at 1998 bytes when the next code point needs three.)
  const truncated = cut !== toPersistableText(text, EXCERPT_MAX_BYTES + 4);
  if (!truncated) return cut;
  const lastSpace = cut.lastIndexOf(' '); // a space index can never split a pair
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();
}
