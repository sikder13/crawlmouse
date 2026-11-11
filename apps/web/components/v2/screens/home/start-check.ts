/**
 * The one client call that starts a check from Home (CC-22b D2, D10): `POST /api/checks` with a
 * JSON body, and the route's answers as the form reads them.
 *
 * `requestId` names the check: the route derives the check's id from it and the host, so a repeat
 * of the same body starts no second check. The form mints one per submit and sends it again only
 * for that submit's own second attempt, after the person check.
 */

export interface StartRequest {
  url: string;
  requestId: string;
  turnstileToken?: string;
}

/** Each refusal the route answers with, by its `code`; `failed` is any other answer, or none. */
export const START_REFUSALS = [
  'invalid_request',
  'invalid_url',
  'captcha_required',
  'captcha_failed',
  'domain_limit',
  'paused',
  'unavailable',
  'capacity',
] as const;
export type StartRefusal = (typeof START_REFUSALS)[number] | 'failed';

export type StartOutcome = { ok: true; checkId: string } | { ok: false; code: StartRefusal };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function startCheck(body: StartRequest): Promise<StartOutcome> {
  let res: Response;
  try {
    res = await fetch('/api/checks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, code: 'failed' };
  }
  const answer = (await res.json().catch(() => ({}))) as { checkId?: unknown; code?: unknown };
  if (res.ok) {
    // The id goes into a path, so an answer that is not a uuid is not followed.
    return typeof answer.checkId === 'string' && UUID.test(answer.checkId)
      ? { ok: true, checkId: answer.checkId }
      : { ok: false, code: 'failed' };
  }
  const code = (START_REFUSALS as readonly unknown[]).includes(answer.code)
    ? (answer.code as StartRefusal)
    : 'failed';
  return { ok: false, code };
}

/** What the form says for each refusal. `captcha_required` is said while the person check runs. */
export const START_COPY: Record<StartRefusal, string> = {
  invalid_request: 'The audit could not be started from this page. Reload it and try again.',
  invalid_url:
    "That address can't be audited. Enter a public website, like yourdomain.com, without a port.",
  captcha_required: 'One check that you are a person, then the audit starts.',
  captcha_failed: 'The check that you are a person did not pass. Try again.',
  domain_limit: 'This site has been audited several times in the last hour. Try again later.',
  paused: 'New audits are paused for the moment. Try again later.',
  unavailable: 'Audits are not running at the moment. Try again later.',
  capacity: "Today's audits are used up. Try again tomorrow.",
  failed: 'The audit could not be started. Try again.',
};

/** The address as the route takes it: what was typed, with https:// when it names no scheme. */
export const urlOf = (typed: string): string => {
  const raw = typed.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
};
