// Shared SPEC 04.1 test fixtures (§12.2 mandate: a Bengali percent-encoded slug + sub-1 deltas).
// Consumed by the §6 render-fix tests (impact-label, url-display) and, extended in Stage 2, by the
// ownership-probe / owner-island tests. Kept in one place so the i18n + delta cases never drift.

// "এক" (Bengali) = UTF-8 E0 A6 8F · E0 A6 95 → percent-encoded lower-case as below. The Bengali
// beachhead (SPEC 04.1 §10) is why decoded, professional URLs matter.
export const BENGALI_DECODED = 'এক';
export const BENGALI_ENCODED = '%e0%a6%8f%e0%a6%95';

/** A report slug carrying a percent-encoded Bengali segment (U9 / §12.2). */
export const BENGALI_ENCODED_SLUG = `career-${BENGALI_ENCODED}`;
export const BENGALI_DECODED_SLUG = `career-${BENGALI_DECODED}`;

/** A full crawled URL with a percent-encoded Bengali path — the shape shown on the result cards. */
export const BENGALI_ENCODED_URL = `https://example.com/career-${BENGALI_ENCODED}`;
export const BENGALI_DECODED_URL = `https://example.com/career-${BENGALI_DECODED}`;

/** Marginal deltas below 1.0 — the exact case that `Math.round` collapsed to "+0 pts" (U8). */
export const SUB_ONE_DELTAS = [0.4, 0.5] as const;

// SPEC 04.2 FIX 3 — Crawlmouse is a GLOBAL tool: the percent-encoding leak affects EVERY non-ASCII URL
// path, not just Bengali (Arabic + RTL, CJK, Cyrillic, Korean, Thai, accented Latin like café→caf%c3%a9).
// safeDecodeUrlForDisplay (decodeURIComponent) handles them all language-agnostically; the risk is a
// fixture that only proves one script. This matrix DERIVES the encoded forms from the decoded word so a
// fixture can never drift from real UTF-8 encoding. Consumed by url-display.test + the cross-surface guard.
export interface NonAsciiUrlSample {
  name: string;
  word: string; // the human-readable (decoded) path segment
  encodedPath: string; // "/%..%.." — a crawled path label (activity-feed shape)
  decodedPath: string;
  encodedUrl: string; // "https://example.com/%..%.." — a crawled URL (card / packet / ActionList shape)
  decodedUrl: string;
}

export const NON_ASCII_URL_SAMPLES: NonAsciiUrlSample[] = (
  [
    { name: 'Bengali', word: 'এক' },
    { name: 'Arabic (RTL)', word: 'مرحبا' },
    { name: 'Chinese', word: '价格' },
    { name: 'Cyrillic', word: 'цена' },
    { name: 'accented-Latin (café)', word: 'café' },
  ] as const
).map((s) => ({
  name: s.name,
  word: s.word,
  encodedPath: `/${encodeURIComponent(s.word)}`,
  decodedPath: `/${s.word}`,
  encodedUrl: `https://example.com/${encodeURIComponent(s.word)}`,
  decodedUrl: `https://example.com/${s.word}`,
}));
