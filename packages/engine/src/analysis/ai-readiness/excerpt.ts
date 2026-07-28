import { EXCERPT_MAX_BYTES } from './constants.js';
import { toPersistableText, wellFormText } from '../../text-safety.js';

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
  const safe = wellFormText(text);
  // NOTE the absent early return. `if (safe.length <= EXCERPT_MAX_BYTES) return safe` compared CODE
  // UNITS against a BYTE budget, so 1999 emoji (3997 bytes) sailed past it unbounded — the wrong-unit
  // bug reappearing inside the fix for the wrong-unit bug. `toPersistableText` is already the identity
  // when the value fits, so there is nothing to shortcut.
  const cut = toPersistableText(safe, EXCERPT_MAX_BYTES);
  if (cut === safe) return safe; // fitted whole — no word-boundary trim needed
  const lastSpace = cut.lastIndexOf(' '); // a space index can never split a pair
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();
}
