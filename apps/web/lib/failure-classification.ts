// Maps a raw worker `failure_reason` (the persisted error.message) into a coarse, user-facing
// bucket so the audit-result view can show a SPECIFIC reason instead of one generic "audit failed"
// line. Classified SERVER-SIDE (the SSE route) so only the bucket — never the raw reason, which can
// carry internal text — crosses to the client. See lib/audit-stream-projection.

export type FailureCategory = 'timeout' | 'dns' | 'blocked' | 'internal';

/**
 * Pure and total: any string (or null/undefined) maps to exactly one category, defaulting to
 * 'internal'. Precedence is timeout > dns > blocked > internal; the tokens are stable substrings of
 * what the engine's safeFetch / SSRF guard / the Node socket+DNS layers actually emit:
 *  - timeout: safeFetch "Request timed out after Nms…" plus Node ETIMEDOUT/ESOCKETTIMEDOUT
 *  - dns:     the SSRF guard wraps DNS failures as "DNS resolution failed for <host>" (ssrf-guard.ts;
 *             validateUrlOrThrow runs first in runAudit, so this is the homepage's most common
 *             reachability failure), plus the raw Node getaddrinfo ENOTFOUND / EAI_AGAIN
 *  - blocked: the site actively refused or dropped us — ECONNRESET ("socket hang up") / ECONNREFUSED
 *             (firewall/WAF), an HTTP 403, or an explicit forbidden/blocked/challenge marker
 */
export function classifyFailure(reason: string | null | undefined): FailureCategory {
  const r = (reason ?? '').toLowerCase();
  if (!r) return 'internal';
  if (r.includes('timed out') || r.includes('timeout') || r.includes('etimedout') || r.includes('esockettimedout')) {
    return 'timeout';
  }
  if (
    r.includes('dns resolution failed') || // the SSRF guard's wrapped message (ssrf-guard.ts)
    r.includes('enotfound') ||
    r.includes('eai_again') ||
    r.includes('getaddrinfo')
  ) {
    return 'dns';
  }
  if (
    r.includes('econnreset') ||
    r.includes('hang up') ||
    r.includes('econnrefused') ||
    /\b403\b/.test(r) || // word-boundary so a digit-run that merely embeds 403 (an id) doesn't match
    r.includes('forbidden') ||
    r.includes('blocked') ||
    r.includes('challenge')
  ) {
    return 'blocked';
  }
  return 'internal';
}

export interface FailureCopy {
  title: string;
  body: string;
}

/**
 * User-facing copy per failure category. The `Record<FailureCategory, …>` type makes a missing
 * category a COMPILE error (so adding a category forces copy for it); a unit test pins distinctness
 * and non-emptiness at runtime too.
 */
export const FAILURE_COPY: Record<FailureCategory, FailureCopy> = {
  timeout: {
    title: 'This site took too long to respond',
    body: 'We waited but the site didn’t respond in time — usually a slow or overloaded server. Try again in a few minutes.',
  },
  dns: {
    title: 'We couldn’t reach that domain',
    body: 'That domain didn’t resolve. Double-check the URL is spelled correctly and the site is live, then try again.',
  },
  blocked: {
    title: 'The site blocked our crawler',
    body: 'The site refused our requests — often a firewall, a bot challenge, or a “403 Forbidden”. Sites behind aggressive bot protection can’t always be audited.',
  },
  internal: {
    title: 'Audit failed',
    body: 'We hit an unexpected error crawling your site. Try again, or contact support if it keeps happening.',
  },
};
