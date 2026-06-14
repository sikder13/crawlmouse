export interface StartVerificationResult {
  ok: boolean;
  /** Where to send the user next on success — the /verify/<id> page showing the record to publish. */
  redirectTo?: string;
  error?: string;
}

/**
 * Kicks off domain-ownership verification: creates (or reuses) the caller's `domain_verifications`
 * row via `POST /api/verify/start`, then returns where to navigate — the `/verify/<id>` page that
 * shows the DNS TXT record or meta tag to publish. Pure data layer (no router) so it stays
 * unit-testable; the calling component performs the actual navigation.
 *
 * Replaces the original dead "Start verification" control, which linked straight to `/dashboard`
 * and never created a verification at all.
 */
export async function startVerification(
  domain: string,
  method: 'dns_txt' | 'meta_tag',
): Promise<StartVerificationResult> {
  let res: Response;
  try {
    res = await fetch('/api/verify/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain, method }),
    });
  } catch {
    return { ok: false, error: 'Network error' };
  }

  const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (res.ok && data.id) {
    return { ok: true, redirectTo: `/verify/${data.id}` };
  }
  return { ok: false, error: data.error ?? 'Could not start verification' };
}
