// Cost-control constants — the 18%-of-MRR-ceiling levers, in one place to tune.
export const FREE_PAGE_CAP = 500;
export const PRO_PAGE_CAP = 2000;
export const FREE_CONCURRENCY = 1; // free crawls run sequentially
export const PRO_CONCURRENCY = 8; // Pro crawls run concurrently
export const FREE_FINDING_LIMIT = 5; // top-N findings per category shown to free users
export const AUDIT_TTL_DAYS = 30; // free-tier audits expire after N days

// Grading: a site is "passing" at C or above. The engine's grade boundary is
// `score >= 60 => C` (packages/engine/src/grade.ts); keep this the single source
// of truth for the UI's passing/needs-work split so it can never drift from it.
export const PASSING_SCORE = 60;
export const isPassingScore = (score: number | null | undefined): boolean =>
  score != null && score >= PASSING_SCORE;

// Rate-limit levers (abuse + cost control). These are the COARSE pre-Turnstile friction gates, not
// the real guardrails — the global ceiling (fail-closed), Turnstile, the 500-page crawl cap, and the
// TTL cleanup are the actual cost/abuse protections (all untouched). Tuned so genuine humans rarely
// hit friction: mobile carriers use CGNAT (many real users behind one IP), so the per-IP caps are
// generous; the per-domain cap allows a user to iterate on their OWN site (the freemium loop).
export const IP_AUDITS_PER_DAY_ANON = 20;
export const IP_AUDITS_PER_DAY_USER = 40; // > anon: a logged-in caller is more trusted, never stricter
export const DOMAIN_AUDITS_PER_HOUR = 5; // free/anon: lets a user re-check their own site; still caps spam
// Global backstop: a hard ceiling on total audits started per day across ALL callers. Sized well
// above expected launch volume; trips only on a platform-wide abuse spike. (18%-MRR guard.)
export const GLOBAL_AUDITS_PER_DAY = 5000;
export const MAGIC_LINK_PER_IP_PER_HOUR = 5; // sign-in emails per IP
export const MAGIC_LINK_PER_EMAIL_PER_HOUR = 3; // sign-in emails per address
export const VERIFY_CHECKS_PER_HOUR = 10; // domain-verification checks per user (outbound fetch/DNS)
export const MINT_REPORTS_PER_DAY = 20; // public reports minted per user per day
export const TAKEDOWN_PER_IP_PER_DAY = 5; // takedown submissions per IP
export const TAKEDOWN_PER_DOMAIN_PER_DAY = 3; // takedown submissions per domain
export const ADMIN_TAKEDOWN_PER_IP_PER_HOUR = 30; // defense-in-depth throttle on the admin action endpoint
export const WAITLIST_PER_IP_PER_DAY = 5; // developer-waitlist signups per IP

// SSE result stream.
export const SSE_POLL_MS = 2500;
export const SSE_MAX_DURATION_S = 300; // Vercel Fluid Compute ceiling: 300s Hobby / 800s Pro
// Self-terminate the stream this long after it opens — comfortably before SSE_MAX_DURATION_S — so a
// stuck / never-completing audit isn't truncated mid-write when Vercel kills the function at the
// ceiling. The route emits a `retry:` hint and closes; the client's EventSource reconnects and
// resumes polling cleanly. 250s leaves a 50s buffer under the 300s ceiling.
export const SSE_SELF_CLOSE_MS = 250_000;
