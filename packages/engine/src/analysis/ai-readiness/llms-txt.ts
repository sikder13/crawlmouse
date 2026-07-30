import type { LlmsTxtStatus } from '@crawlmouse/types';

/**
 * §8 honest descriptor, rendered with the informational badge. llms.txt is NOT consumed by any AI search
 * engine as of the evidence date; it is read mainly by AI coding agents.
 */
export const LLMS_TXT_NOTE =
  "No AI search engine consumes this file as of 2026 (Google's own guidance says it isn't needed); " +
  'it is read mainly by AI coding agents.';

/** Max bytes to fetch for /llms.txt. A real llms.txt is tiny; the safeFetch 10MB default is absurd here
 *  and is a ReDoS/CPU amplifier on a hostile body — bound the fetch (defense layer 1). */
export const LLMS_TXT_MAX_BYTES = 256 * 1024;

/**
 * SPEC 05 §8 — hard timeout for the ONE llms.txt fetch. Deliberately far below safeFetch's 10s default:
 * this request runs in the crawl PRELUDE, which shares the ~40s of headroom left by the 240s crawl budget
 * under the 300s maxDuration. An informational, ZERO-WEIGHT file must never cost a quarter of that
 * headroom because a single host tarpits the connection.
 *
 * NOTE on what this bounds: safeFetch passes this to Node as a per-socket INACTIVITY timeout, re-applied
 * per redirect hop — it is not a single wall-clock deadline. A slow-drip host or a redirect chain can
 * still exceed it. Strictly better than the 10s default and consistent with robots/sitemap, not a hard cap.
 */
export const LLMS_TXT_FETCH_TIMEOUT_MS = 3000;
/** Max bytes of the body actually SCANNED by the shape regexes (defense layer 2). */
export const LLMS_TXT_SCAN_CAP = 16 * 1024;

/**
 * §8 — parse the result of the ONE authorized llms.txt fetch (performed in `crawlForAudit` through the same
 * guarded fetcher as robots.txt). Informational, ZERO score weight. `present` = a non-empty 200; `parseable`
 * = a basic llms.txt markdown shape (an H1 title + at least one markdown link). Absence is normal, not an error.
 *
 * SECURITY: the body is attacker-controlled (the audited site serves /llms.txt). The scan is bounded and the
 * link regex uses BOUNDED quantifiers so it cannot backtrack quadratically on a crafted body (e.g. 1MB of
 * `[`) — the same hardening as the `<noscript>` scan (constants.ts NOTICE_SCAN_CAP).
 */
export function parseLlmsTxt(status: number, body: string): LlmsTxtStatus {
  const scan = body.length > LLMS_TXT_SCAN_CAP ? body.slice(0, LLMS_TXT_SCAN_CAP) : body;
  const present = status === 200 && scan.trim().length > 0;
  const hasH1 = /^#[ \t]+\S/m.test(scan); // an H1 line ("# Title"), not H2+ ("## …") — linear
  // Bounded quantifiers ([^\]\n]{1,200}, [^)\s]{1,2000}) keep this LINEAR — no catastrophic backtracking.
  const hasLink = /\[[^\]\n]{1,200}\]\([^)\s]{1,2000}\)/.test(scan);
  return { present, parseable: present && hasH1 && hasLink, note: LLMS_TXT_NOTE };
}
