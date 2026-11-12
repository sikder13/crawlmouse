/**
 * Unsubscribe (D7, owner ruling Q11): what `/unsubscribe` shows and what `POST /api/unsubscribe`
 * does. The token (unsubscribe-token.ts) names one seat and one kind; nothing else is a credential, so
 * neither needs a sign-in. The page only reads the token: a GET changes nothing, since a mail
 * scanner or a link preview opens links. The change is the POST, by the page's form (the token as
 * the field `t`) or by a mail client's RFC 8058 one-click (the token in the URL, the body
 * `List-Unsubscribe=One-Click`), and it is `unsubscribe_seat`: `alerts` takes email out of the seat's
 * alert channels, `summary` turns its weekly summary off.
 */
import { linkSecret, verifyUnsubscribe, type Verified } from './unsubscribe-token';
import type { UnsubscribeKind } from './types';

type Env = Readonly<Record<string, string | undefined>>;

/** The most bytes of body the POST reads: a one-click body or the form's one field is far less. */
export const BODY_MAX = 2048;

export const UNSUBSCRIBE_COPY = {
  title: 'Unsubscribe',
  ask: {
    alerts: 'Stop alert emails to this address?',
    summary: 'Stop the weekly summary email to this address?',
  },
  button: 'Unsubscribe',
  done: {
    alerts: 'Done. Alerts are no longer emailed to this address.',
    summary: 'Done. The weekly summary is no longer emailed to this address.',
  },
  refused: {
    expired: 'This unsubscribe link has expired. Sign in and change your email settings instead.',
    invalid:
      'This unsubscribe link is not one we can read. Sign in and change your email settings instead.',
    unconfigured: 'Unsubscribing is not available right now. Please try again later.',
  },
} as const;

type Refusal = keyof typeof UNSUBSCRIBE_COPY.refused;

export type UnsubscribePageView =
  | { state: 'ask'; kind: UnsubscribeKind; text: string; token: string }
  | { state: 'done'; text: string }
  | { state: 'refused'; text: string };

const KINDS: readonly UnsubscribeKind[] = ['alerts', 'summary'];
const refusalOf = (v: Extract<Verified, { ok: false }>): Refusal =>
  v.reason === 'expired' ? 'expired' : 'invalid';

/** What the page shows, from its query. Reads the token; changes nothing. */
export function unsubscribePageView(
  query: { t?: string; done?: string; error?: string },
  env: Env,
  now: Date,
): UnsubscribePageView {
  const done = KINDS.find((k) => k === query.done);
  if (done) return { state: 'done', text: UNSUBSCRIBE_COPY.done[done] };
  const error = (Object.keys(UNSUBSCRIBE_COPY.refused) as Refusal[]).find((k) => k === query.error);
  if (error) return { state: 'refused', text: UNSUBSCRIBE_COPY.refused[error] };
  const secret = linkSecret(env);
  if (secret === null) return { state: 'refused', text: UNSUBSCRIBE_COPY.refused.unconfigured };
  const v = verifyUnsubscribe(secret, query.t ?? '', now);
  if (!v.ok) return { state: 'refused', text: UNSUBSCRIBE_COPY.refused[refusalOf(v)] };
  return { state: 'ask', kind: v.kind, text: UNSUBSCRIBE_COPY.ask[v.kind], token: query.t! };
}

/** The body as text, or null when it is longer than `max` bytes (refused unread past the bound). */
export async function readBounded(req: Request, max = BODY_MAX): Promise<string | null> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (req.body === null) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export type UnsubscribeRequest =
  | { ok: true; seatId: string; kind: UnsubscribeKind; oneClick: boolean }
  | { ok: false; status: 400 | 413 | 503; code: Refusal | 'too_large'; oneClick: boolean };

/**
 * The POST's verifier: reads the bounded body, takes the token from the URL's `t` or else the form's,
 * and verifies it. Nothing is changed here; the route acts on `ok` only.
 */
export async function verifyUnsubscribeRequest(
  req: Request,
  env: Env,
  now: Date,
): Promise<UnsubscribeRequest> {
  const body = await readBounded(req);
  // The token in the URL is the one-click link (links.ts `oneClick`); the page's form sends it in the
  // body. A one-click body may be multipart (RFC 8058), which is not read: the URL holds what is needed.
  const inUrl = new URL(req.url).searchParams.get('t');
  const form = new URLSearchParams(body ?? '');
  const oneClick = inUrl !== null || form.get('List-Unsubscribe') === 'One-Click';
  if (body === null) return { ok: false, status: 413, code: 'too_large', oneClick };
  const secret = linkSecret(env);
  if (secret === null) return { ok: false, status: 503, code: 'unconfigured', oneClick };
  const token = inUrl ?? form.get('t') ?? '';
  const v = verifyUnsubscribe(secret, token, now);
  if (!v.ok) return { ok: false, status: 400, code: refusalOf(v), oneClick };
  return { ok: true, seatId: v.seatId, kind: v.kind, oneClick };
}

/**
 * The POST's answer: a mail client's one-click gets a plain status; the page's form goes back to the
 * page, which says what happened.
 */
export function unsubscribeAnswer(r: UnsubscribeRequest, origin: string): Response {
  const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
  if (r.oneClick) {
    return new Response(r.ok ? 'Unsubscribed.' : r.code, {
      status: r.ok ? 200 : r.status,
      headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  const query = r.ok ? `done=${r.kind}` : `error=${r.code === 'too_large' ? 'invalid' : r.code}`;
  return new Response(null, {
    status: 303,
    headers: { ...headers, Location: `${origin}/unsubscribe?${query}` },
  });
}

export interface UnsubscribeDeps {
  /** `unsubscribe_seat`; true when the seat exists. */
  unsubscribe(seatId: string, kind: UnsubscribeKind): Promise<boolean>;
  /** The `unsubscribed` product event: the kind only, keyed by the seat, no address. */
  captured(seatId: string, kind: UnsubscribeKind): Promise<void>;
}

/**
 * After the verifier: a verified token makes its one change and is answered as done (a seat that no
 * longer exists is mailed nothing either); anything else is answered as refused, with nothing changed.
 */
export async function applyUnsubscribe(
  r: UnsubscribeRequest,
  deps: UnsubscribeDeps,
  origin: string,
): Promise<Response> {
  if (r.ok && (await deps.unsubscribe(r.seatId, r.kind))) await deps.captured(r.seatId, r.kind);
  return unsubscribeAnswer(r, origin);
}
