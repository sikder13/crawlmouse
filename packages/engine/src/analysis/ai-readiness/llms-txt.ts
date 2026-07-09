import type { LlmsTxtStatus } from '@crawlmouse/types';

/**
 * §8 honest descriptor, rendered with the informational badge. llms.txt is NOT consumed by any AI search
 * engine as of the evidence date; it is read mainly by AI coding agents.
 */
export const LLMS_TXT_NOTE =
  "No AI search engine consumes this file as of 2026 (Google's own guidance says it isn't needed); " +
  'it is read mainly by AI coding agents.';

/**
 * §8 — parse the result of the ONE authorized llms.txt fetch (performed in `crawlForAudit` through the same
 * guarded fetcher as robots.txt). Informational, ZERO score weight. `present` = a non-empty 200; `parseable`
 * = a basic llms.txt markdown shape (an H1 title + at least one markdown link). Absence is normal, not an error.
 */
export function parseLlmsTxt(status: number, body: string): LlmsTxtStatus {
  const present = status === 200 && body.trim().length > 0;
  const hasH1 = /^#[ \t]+\S/m.test(body); // an H1 line ("# Title"), not H2+ ("## …")
  const hasLink = /\[[^\]]+\]\([^)]+\)/.test(body); // at least one [text](url) markdown link
  return { present, parseable: present && hasH1 && hasLink, note: LLMS_TXT_NOTE };
}
