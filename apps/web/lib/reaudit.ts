/**
 * Authorization decision for the manual re-audit endpoint (SPEC 02 §8). Re-audit is OWNER-SCOPED and
 * Pro-only — monitoring is the spine of Pro, so a free or non-owner caller cannot trigger one. Pure +
 * exhaustively tested so the security gate can't silently regress; the route applies it and then runs
 * the SAME rate-limit/Turnstile/abuse path as a normal audit (it is NOT an unmetered backdoor).
 *
 * Order is deliberate: auth (401) → existence/ownership (404) → entitlement (402). Auth is checked
 * first so an anonymous caller never learns whether an audit id exists; missing AND not-owned both
 * return 404 (mirrors the export route) so an authenticated non-owner can't probe which ids exist.
 */
export type ReauditAuthz = { ok: true } | { ok: false; status: 401 | 402 | 404; error: string };

export function authorizeReaudit(params: {
  userId: string | null; // null = not signed in
  auditExists: boolean;
  auditUserId: string | null | undefined; // the owner of the audit being re-audited
  isPro: boolean; // the signed-in user's entitlement (server-derived)
}): ReauditAuthz {
  if (!params.userId) return { ok: false, status: 401, error: 'Sign in to re-audit.' };
  // 404 for BOTH a missing audit and one the caller doesn't own — don't reveal which ids exist.
  if (!params.auditExists || params.auditUserId !== params.userId) return { ok: false, status: 404, error: 'Audit not found.' };
  if (!params.isPro) return { ok: false, status: 402, error: 'Re-audit & monitoring are a Pro feature.' };
  return { ok: true };
}
