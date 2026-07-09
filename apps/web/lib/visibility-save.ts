export interface VisibilitySaveResult {
  ok: boolean;
  error?: 'auth_required' | 'verification_required' | 'not_claimed' | 'rate_limited' | 'unavailable' | 'could_not_save' | 'network';
  listed?: boolean;
  indexable?: boolean;
}

// SPEC 04.1 §4 — injectable client wrapper for the shipped visibility route (owner opt in/out of
// listed / indexable for a CLAIMED report). The server enforces auth → verified-domain ownership →
// claimed; this only POSTs the partial patch and maps outcomes. Caller refetches the probe after (R2).
export async function saveVisibility(
  slug: string,
  patch: { listed?: boolean; indexable?: boolean },
  fetchImpl: typeof fetch,
): Promise<VisibilitySaveResult> {
  try {
    const res = await fetchImpl(`/api/reports/${encodeURIComponent(slug)}/visibility`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const d = (await res.json().catch(() => ({}))) as { listed?: boolean; indexable?: boolean };
      return { ok: true, listed: d.listed, indexable: d.indexable };
    }
    if (res.status === 401) return { ok: false, error: 'auth_required' };
    if (res.status === 403) return { ok: false, error: 'verification_required' };
    if (res.status === 409) return { ok: false, error: 'not_claimed' };
    if (res.status === 429) return { ok: false, error: 'rate_limited' };
    if (res.status === 503) return { ok: false, error: 'unavailable' };
    return { ok: false, error: 'could_not_save' };
  } catch {
    return { ok: false, error: 'network' };
  }
}
