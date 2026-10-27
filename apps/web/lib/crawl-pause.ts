// Global crawl pause switch. `CRAWL_PAUSED=1` makes every audit-start route refuse new audits with a 503
// (and the Inngest audit function short-circuit — see inngest/audit.ts `applyCrawlPause`). Read per
// request, not at build. Vercel applies an env change only to NEW deployments, so flipping it means
// changing the variable and redeploying — no code change.

type Env = Readonly<Record<string, string | undefined>>;

/** True only for the value `1`; surrounding whitespace is ignored (a value pasted as "1\n"). */
export function isCrawlPaused(env: Env = process.env): boolean {
  return env.CRAWL_PAUSED?.trim() === '1';
}

/** Rendered verbatim by the audit forms (they display the response's `error` field). */
export const CRAWL_PAUSED_MESSAGE = 'New audits are paused right now. Please try again shortly.';
