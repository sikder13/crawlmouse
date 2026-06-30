/**
 * Pure submit + response-interpretation for the homepage audit form. Extracted from the component so
 * the flow (incl. the captcha → retry-with-token path that powers the auto-resubmit) is unit-testable
 * in the node env (no DOM). `fetcher` is injectable for tests; production passes the global `fetch`.
 */
export type SubmitOutcome =
  | { kind: 'navigate'; auditId: string; domain: string }
  | { kind: 'captcha' }
  | { kind: 'error'; message: string }
  | { kind: 'invalid-url' };

export async function submitAuditRequest(
  rawUrl: string,
  token: string | null,
  fetcher: typeof fetch = fetch,
): Promise<SubmitOutcome> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
  } catch {
    return { kind: 'invalid-url' };
  }
  try {
    const res = await fetcher('/api/audits/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: parsed.toString(), turnstileToken: token ?? undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // captcha_required surfaces the Turnstile widget (the human-verification path), NOT an error.
      if (data?.error === 'captcha_required') return { kind: 'captcha' };
      return { kind: 'error', message: data?.error ?? 'Something went wrong' };
    }
    return { kind: 'navigate', auditId: data.auditId, domain: parsed.hostname };
  } catch {
    return { kind: 'error', message: 'Network error. Please try again.' };
  }
}

/**
 * Whether a freshly-arrived Turnstile token should auto-continue the submit, so "verify" flows
 * straight into the audit with no manual second click. True only when: a token actually arrived, the
 * form armed auto-submit after a `captcha_required`, and no submit is already in flight. The in-flight
 * guard prevents a double-submit / re-entrancy loop; the caller disarms before resubmitting so a later
 * token (e.g. a widget reset after an unrelated error) cannot loop.
 */
export function shouldAutoResubmit(token: string | null, armed: boolean, submitting: boolean): boolean {
  return token != null && armed && !submitting;
}
