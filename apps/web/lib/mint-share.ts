import type { FunnelEvent } from './analytics-events';

// SPEC 04 §6 (V11) — one-step mint at the grade reveal. Mints the audit into a PUBLIC report and returns
// its slug so the share affordance can produce the /r/ URL (reportShareUrl), never the private capability
// URL. Injectable fetch + track (house pattern, mirrors lib/notify-submit) so it is unit-testable with no
// network / no PostHog. Idempotent server-side (a second mint returns the existing slug).

type TrackFn = (event: FunnelEvent, props?: Record<string, unknown>) => void;

export type MintResult = { ok: true; slug: string } | { ok: false; error: string };

export async function mintReport(
  auditId: string,
  fetchImpl: typeof fetch = fetch,
  trackImpl?: TrackFn,
): Promise<MintResult> {
  try {
    const res = await fetchImpl('/api/reports/mint', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ auditId }),
    });
    const data = (await res.json().catch(() => ({}))) as { slug?: unknown; error?: unknown };
    if (typeof data.slug === 'string' && data.slug) {
      trackImpl?.('report_minted', { slug: data.slug });
      return { ok: true, slug: data.slug };
    }
    return { ok: false, error: typeof data.error === 'string' ? data.error : 'mint_failed' };
  } catch {
    return { ok: false, error: 'mint_failed' };
  }
}
