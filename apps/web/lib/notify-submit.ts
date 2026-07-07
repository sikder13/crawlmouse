import { track } from './analytics';

// SPEC 04 §2 — the email-me-when-done submit, extracted from the component (house pattern: risky
// logic lives in a unit-testable lib; components render). Fires the existing `email-captured`
// funnel event with source='wait' (M9 ruling) ONLY on an accepted request.

export type NotifySubmitResult = 'saved' | 'error';

export async function submitNotifyRequest(
  auditId: string,
  email: string,
  fetchImpl: typeof fetch = fetch,
  trackImpl: typeof track = track,
): Promise<NotifySubmitResult> {
  try {
    const res = await fetchImpl(`/api/audits/${auditId}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) return 'error';
    trackImpl('email-captured', { source: 'wait' });
    return 'saved';
  } catch {
    return 'error';
  }
}
