/**
 * The one client call that asks for a sign-in link: `POST /api/auth/magic-link` with a JSON body,
 * never a query string, so an address never lands in a URL. The route's answers, as the door's
 * forms read them.
 */

export interface LinkRequest {
  email: string;
  site?: string;
  tz?: string;
  claimCheckId?: string;
  turnstileToken?: string;
}

export type SendOutcome =
  | 'sent'
  | 'rate_limited'
  | 'invalid_email'
  | 'invalid_site'
  | 'verification'
  | 'failed';

/** The browser's IANA zone, or nothing: the route reads an unknown zone as UTC. */
export function browserZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export async function sendLink(body: LinkRequest): Promise<SendOutcome> {
  let res: Response;
  try {
    res = await fetch('/api/auth/magic-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return 'failed';
  }
  if (res.ok) return 'sent';
  if (res.status === 429) return 'rate_limited';
  const code = ((await res.json().catch(() => ({}))) as { code?: unknown }).code;
  if (code === 'invalid_email' || code === 'invalid_site' || code === 'verification') return code;
  return 'failed';
}

/** What the door's forms say for each refusal. */
export const SEND_COPY: Record<Exclude<SendOutcome, 'sent'>, string> = {
  rate_limited: 'Too many sign-in links for this address or network. Try again later.',
  invalid_email: 'That does not look like an email address.',
  invalid_site: 'That does not look like a website address. Try yourdomain.com.',
  verification: 'The check that you are a person did not pass. Try again.',
  failed: 'The link could not be sent. Try again.',
};

/** What a page needs to send the same link again: the request without its single-use token. */
export const PENDING_KEY = 'cm_door_pending';

export function rememberPending(body: LinkRequest): void {
  // The Turnstile token is single-use: a resend asks the widget for a new one.
  const pending: LinkRequest = { ...body, turnstileToken: undefined };
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Private mode or storage blocked: the page then shows no address and resends from the form.
  }
}

export function readPending(): LinkRequest | null {
  try {
    const v: unknown = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null');
    if (v && typeof v === 'object' && typeof (v as LinkRequest).email === 'string')
      return v as LinkRequest;
  } catch {
    // Unreadable: treat as absent.
  }
  return null;
}
