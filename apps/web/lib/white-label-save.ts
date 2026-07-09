import type { WhiteLabelConfig } from '@crawlmouse/types';

export type WhiteLabelSaveBody =
  | { enabled: true; brandName: string; logoPath?: string | null }
  | { enabled: false };

export interface WhiteLabelSaveResult {
  ok: boolean;
  error?: 'pro_required' | 'verification_required' | 'not_claimed' | 'unavailable' | 'could_not_save' | 'network';
  whiteLabel?: WhiteLabelConfig | null;
  listed?: boolean;
  indexable?: boolean;
}

// SPEC 04.1 §3 — injectable client wrapper for the shipped white-label route. The server enforces the
// real gate (auth → paid entitlement → verified-domain ownership → claimed report); this only POSTs and
// maps the outcomes. The caller ALWAYS refetches the probe afterwards (R2).
export async function saveWhiteLabel(
  slug: string,
  body: WhiteLabelSaveBody,
  fetchImpl: typeof fetch,
): Promise<WhiteLabelSaveResult> {
  try {
    const res = await fetchImpl(`/api/reports/${encodeURIComponent(slug)}/white-label`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        whiteLabel?: WhiteLabelConfig | null; listed?: boolean; indexable?: boolean;
      };
      return { ok: true, whiteLabel: data.whiteLabel ?? null, listed: data.listed, indexable: data.indexable };
    }
    if (res.status === 402) return { ok: false, error: 'pro_required' };
    if (res.status === 403) return { ok: false, error: 'verification_required' };
    if (res.status === 409) return { ok: false, error: 'not_claimed' };
    if (res.status === 503) return { ok: false, error: 'unavailable' };
    return { ok: false, error: 'could_not_save' };
  } catch {
    return { ok: false, error: 'network' };
  }
}
