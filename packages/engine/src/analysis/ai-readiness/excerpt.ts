import { EXCERPT_MAX_CHARS } from './constants.js';
import { toPersistableText, wellFormText } from '../../text-safety.js';

/**
 * §4.4 — the "What AI Sees" excerpt. The first `EXCERPT_MAX_CHARS` of the ALREADY-density-filtered
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
  if (safe.length <= EXCERPT_MAX_CHARS) return safe;
  const slice = toPersistableText(safe, EXCERPT_MAX_CHARS);
  const lastSpace = slice.lastIndexOf(' '); // a space index can never split a pair
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trimEnd();
}
