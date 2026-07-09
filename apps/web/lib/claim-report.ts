export interface ClaimResult {
  ok: boolean;
  error?: 'auth_required' | 'verification_required' | 'could_not_claim' | 'network';
}

// SPEC 04.1 §2 — claim a public report from the owner island (finish-claim step). The authoritative gate
// is the server route (auth → verified-domain ownership); this injectable wrapper just POSTs and maps the
// outcomes so ClaimControl can react (fire `report_claimed` + refetch on ok; route/sign-in on 401). The
// caller ALWAYS refetches the probe afterwards (R2), so a stale success/gate mismatch self-corrects.
export async function claimReport(slug: string, fetchImpl: typeof fetch): Promise<ClaimResult> {
  try {
    const res = await fetchImpl(`/api/reports/${encodeURIComponent(slug)}/claim`, { method: 'POST' });
    if (res.ok) return { ok: true };
    if (res.status === 401) return { ok: false, error: 'auth_required' };
    if (res.status === 403) return { ok: false, error: 'verification_required' };
    return { ok: false, error: 'could_not_claim' };
  } catch {
    return { ok: false, error: 'network' };
  }
}
