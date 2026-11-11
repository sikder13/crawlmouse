/**
 * A public start (CC-22b D2): what POST /api/checks does once its body has parsed. In order:
 *
 * 1. The host, by sign-up's rule (`publicHost`), then the SSRF guard on `https://{host}/`. A refusal
 *    answers one fixed body; the guard's own message names the address a host resolved to.
 * 2. The rows the request's derived ids name. A check that exists is answered as it is, in any
 *    state and whoever keeps it: no bucket is counted and the pipeline is not called.
 * 3. The day's ceiling, then the caller's address (with Turnstile once it is over its limit), then
 *    the domain: v1's order, so a refused request does not count against a later bucket.
 * 4. The site no account keeps, then `requestCheck` with the derived check id as its fresh id.
 *
 * The check id is derived from the request id and the host (`publicCheckId`), so whoever holds a
 * request id holds the capability to read its check: neither id is logged here.
 */
import { normalizeDomain } from '../../../../lib/domain';
import { publicCheckId, publicSiteId } from '../../../../lib/v2/pipeline/public';
import { requestCheck, type RequestDeps } from '../../../../lib/v2/pipeline/request';
import { publicHost } from './host';
import type { StartStore } from './start-store';

export interface StartLimits {
  /** The day's ceiling on starts across callers; false when it is reached or was not counted. */
  global(): Promise<boolean>;
  ip(ip: string, signedIn: boolean): Promise<{ allowed: boolean; resetAt: Date }>;
  /** `domain` is the host without a leading `www.` (`normalizeDomain`). */
  domain(domain: string): Promise<boolean>;
}

export interface StartDeps {
  /** The SSRF guard: whether `https://{host}/` may be fetched (`admitSiteHost`). */
  admit(host: string): Promise<boolean>;
  store: StartStore;
  limits: StartLimits;
  /** Whether the caller has a session. */
  signedIn(): Promise<boolean>;
  verifyTurnstile(token: string, ip: string): Promise<boolean>;
  pipeline: Omit<RequestDeps, 'newId'>;
}

export interface StartInput {
  url: string;
  /** A uuid the caller made for this submit. */
  requestId: string;
  turnstileToken?: string;
  /** The caller's address, or `unknown`. */
  ip: string;
}

export interface StartRefusal {
  ok: false;
  status: 400 | 409 | 429 | 503;
  body: { code: string; error: string; resetAt?: string };
}

export type StartOutcome =
  | {
      ok: true;
      checkId: string;
      /** False when the check was there before this call. */ created: boolean;
    }
  | StartRefusal;

const refuse = (
  status: StartRefusal['status'],
  code: string,
  error: string,
  more: { resetAt?: string } = {},
): StartRefusal => ({ ok: false, status, body: { code, error, ...more } });

const INVALID_URL = refuse(400, 'invalid_url', 'Enter the address of a public website.');

export async function startPublicCheck(deps: StartDeps, input: StartInput): Promise<StartOutcome> {
  const host = publicHost(input.url);
  if (host === null || !(await deps.admit(host))) return INVALID_URL;

  const requestId = input.requestId.toLowerCase();
  const siteId = publicSiteId(requestId, host);
  const checkId = publicCheckId(requestId, host);
  const derived = await deps.store.derived(siteId, checkId);
  if (derived.checkExists) return { ok: true, checkId, created: false };
  if (derived.siteKept) {
    return refuse(409, 'request_spent', 'This request was already used. Start a new audit.');
  }

  if (!(await deps.limits.global())) {
    return refuse(503, 'capacity', 'We’re at capacity right now. Please try again tomorrow.');
  }

  if (input.ip !== 'unknown') {
    const bucket = await deps.limits.ip(input.ip, await deps.signedIn());
    if (!bucket.allowed) {
      if (input.turnstileToken === undefined) {
        return refuse(
          429,
          'captcha_required',
          'Confirm you are not a robot to start another audit.',
          {
            resetAt: bucket.resetAt.toISOString(),
          },
        );
      }
      if (!(await deps.verifyTurnstile(input.turnstileToken, input.ip))) {
        return refuse(429, 'captcha_failed', 'That check did not pass. Please try again.');
      }
    }
  }

  if (!(await deps.limits.domain(normalizeDomain(host)))) {
    return refuse(
      429,
      'domain_limit',
      'Another audit for this domain ran in the last hour. Try again soon.',
    );
  }

  await deps.store.insertUnkeptSite(siteId, host);
  const { created } = await requestCheck(
    { ...deps.pipeline, newId: () => checkId },
    { siteId, trigger: 'first_audit' },
  );
  return { ok: true, checkId, created };
}

/**
 * A failure's message for the log, with the request id and the check id it derives written out of
 * it: either one is the capability to read the check.
 */
export function scrubbed(cause: unknown, input: Pick<StartInput, 'url' | 'requestId'>): string {
  const requestId = input.requestId.toLowerCase();
  const host = publicHost(input.url);
  const secrets = [requestId, ...(host === null ? [] : [publicCheckId(requestId, host)])];
  const message = cause instanceof Error ? cause.message : String(cause);
  return secrets.reduce(
    (text, secret) => text.replace(new RegExp(secret, 'gi'), '[redacted]'),
    message,
  );
}
