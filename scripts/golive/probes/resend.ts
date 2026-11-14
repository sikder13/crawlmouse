/**
 * D3(f): the sending domain named in docs/ops/senders.md is verified in Resend. Listing domains takes
 * `RESEND_API_KEY`, which Resend issues only with full or sending access: there is no read-only key, so
 * the key in scripts/.env.local can send mail. This probe only lists.
 */
import { fail, httpFailed, noToken, pass, type Probe } from './types';

/** The domain both senders use (docs/ops/senders.md §1; resend.test.ts reads it from the file). */
export const SENDING_DOMAIN = 'crawlmouse.com';

export const resendProbe: Probe = async (deps) => {
  const key = deps.env.RESEND_API_KEY;
  if (!key) return noToken('RESEND_API_KEY');
  const res = await deps.fetch('https://api.resend.com/domains', {
    headers: { authorization: `Bearer ${key}` },
  });
  if (!res.ok) return httpFailed('Resend domains', res.status);
  const body = (await res.json()) as { data?: Array<{ name?: unknown; status?: unknown }> };
  const domain = (body.data ?? []).find((d) => d.name === SENDING_DOMAIN);
  if (!domain) return fail(`${SENDING_DOMAIN} is not a Resend domain`);
  return domain.status === 'verified'
    ? pass(`${SENDING_DOMAIN} is verified`)
    : fail(`${SENDING_DOMAIN} is not verified`);
};
