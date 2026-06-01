// Cost-control constants — the 18%-of-MRR-ceiling levers, in one place to tune.
export const FREE_PAGE_CAP = 500;
export const PRO_PAGE_CAP = 2000;
export const FREE_CONCURRENCY = 1; // free crawls run sequentially
export const PRO_CONCURRENCY = 8; // Pro crawls run concurrently
export const FREE_FINDING_LIMIT = 5; // top-N findings per category shown to free users
export const AUDIT_TTL_DAYS = 30; // free-tier audits expire after N days
