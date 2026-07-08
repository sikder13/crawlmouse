import { EXCERPT_MAX_CHARS } from './constants.js';

/**
 * §4.4 — the "What AI Sees" excerpt. The first `EXCERPT_MAX_CHARS` of the ALREADY-density-filtered
 * main-content text (the caller passes `.text()` output — NEVER a raw-HTML slice), truncated at a word
 * boundary and trimmed. Deterministic (R1): same input → identical bytes.
 */
export function buildExcerpt(text: string): string {
  if (text.length <= EXCERPT_MAX_CHARS) return text;
  const slice = text.slice(0, EXCERPT_MAX_CHARS);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trimEnd();
}
