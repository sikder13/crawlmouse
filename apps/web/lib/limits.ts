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

// Rate-limit levers (abuse + cost control).
export const IP_AUDITS_PER_DAY_ANON = 3;
export const IP_AUDITS_PER_DAY_USER = 5;
export const DOMAIN_AUDITS_PER_HOUR = 1; // free/anon: one audit per domain per hour
export const MAGIC_LINK_PER_IP_PER_HOUR = 5; // sign-in emails per IP
export const MAGIC_LINK_PER_EMAIL_PER_HOUR = 3; // sign-in emails per address
export const VERIFY_CHECKS_PER_HOUR = 10; // domain-verification checks per user (outbound fetch/DNS)
export const MINT_REPORTS_PER_DAY = 20; // public reports minted per user per day
export const TAKEDOWN_PER_IP_PER_DAY = 5; // takedown submissions per IP
export const TAKEDOWN_PER_DOMAIN_PER_DAY = 3; // takedown submissions per domain
export const ADMIN_TAKEDOWN_PER_IP_PER_HOUR = 30; // defense-in-depth throttle on the admin action endpoint

// SSE result stream.
export const SSE_POLL_MS = 2500;
export const SSE_MAX_DURATION_S = 300; // Vercel Fluid Compute ceiling: 300s Hobby / 800s Pro
