/**
 * Where a message goes (D1). Production's transport is Resend's REST API; tests, CI and the local
 * proof inject their own, so nothing but `resendTransport` can reach a real inbox.
 *
 * Resend keeps an `Idempotency-Key` for 24 hours: a repeat with the same payload returns the first
 * answer without sending, and a repeat with a different payload is refused with 409
 * `invalid_idempotent_request` (resend.com/docs, "Idempotency keys", read 2026-11-12). The second is
 * what a re-minted account link looks like after a worker died between Resend's accept and our
 * `finish` (questions Q10), so it is answered as sent, with no provider id, not as a failure to retry.
 */

import type { OutgoingMail } from './types';

export type TransportResult =
  | { ok: true; providerId: string | null }
  | { ok: false; code: string; retryable: boolean };

export interface MailTransport {
  send(mail: OutgoingMail): Promise<TransportResult>;
}

const RESEND_URL = 'https://api.resend.com/emails';

/** Resend over `fetch`; null when no API key is set (the mailer then claims nothing). */
export function resendTransport(
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 20_000,
): MailTransport | null {
  if (!apiKey) return null;
  return {
    async send(mail) {
      let res: Response;
      try {
        res = await fetchImpl(RESEND_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': mail.idempotencyKey,
          },
          body: JSON.stringify({
            from: mail.from,
            to: [mail.to],
            subject: mail.subject,
            text: mail.text,
            html: mail.html,
            headers: mail.headers,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        return { ok: false, code: 'network', retryable: true };
      }
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
        return {
          ok: true,
          providerId: typeof body?.id === 'string' ? body.id.slice(0, 200) : null,
        };
      }
      const body = (await res.json().catch(() => null)) as { name?: unknown } | null;
      const name = typeof body?.name === 'string' ? body.name : '';
      if (res.status === 409 && name === 'invalid_idempotent_request') {
        return { ok: true, providerId: null };
      }
      const retryable = res.status === 409 || res.status === 429 || res.status >= 500;
      return { ok: false, code: `provider_${res.status}`, retryable };
    },
  };
}
