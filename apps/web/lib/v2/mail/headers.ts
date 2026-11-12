/**
 * The headers of an outgoing message, built from validated values only (D3). A value that could end
 * a header (CR, LF, or any other control character) is refused, never stripped: a subject that
 * reaches here with one is a bug upstream, and sending it altered would hide it. The recipient must
 * be a plain address; it is used as `to` and nowhere in the message.
 */
import { ALERTS_SENDER } from '../../auth/constants';
import type { OutgoingMail, RenderedMail } from './types';

/** The display name and address every v2 email is sent from (D10). */
export const MAIL_FROM = `Crawlmouse <${ALERTS_SENDER}>`;

/** Longest subject we send; the templates stay well under it. */
export const SUBJECT_MAX = 200;

export class HeaderRefused extends Error {
  constructor(readonly field: string) {
    super(`mail header refused: ${field}`);
    this.name = 'HeaderRefused';
  }
}

// Any C0 control (CR and LF among them), DEL, and the Unicode line and paragraph separators.
const CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/;

/**
 * A plain address, at most 254 characters: a dot-atom local part of RFC 5322's atext (letters, digits
 * and ``!#$%&'*+/=?^_`{|}~-``, no leading, trailing or doubled dot, at most 64 characters), one `@`,
 * and a hostname of letters, digits and hyphens. No quoted local part and none of the specials a parser
 * could read as a group, a route or a second address (`:`, `;`, `,`, `<`, `>`, `[`, `]`, `(`, `)`, `"`,
 * `\`, `@`, space).
 */
const ATEXT = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+";
const LOCAL = new RegExp(`^${ATEXT}(?:\\.${ATEXT})*$`);
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function isPlainAddress(value: string): boolean {
  if (value.length > 254 || CONTROL.test(value)) return false;
  const at = value.lastIndexOf('@');
  const local = value.slice(0, at);
  return at > 0 && local.length <= 64 && LOCAL.test(local) && DOMAIN.test(value.slice(at + 1));
}

/** One header value, or HeaderRefused naming `field`. */
export function headerValue(field: string, value: string, max = 2000): string {
  if (value.length === 0 || value.length > max || CONTROL.test(value))
    throw new HeaderRefused(field);
  return value;
}

export interface UnsubscribeHeaderInput {
  /** The HTTPS one-click URL (RFC 8058); it carries the signed token. */
  url: string;
}

/** List-Unsubscribe and List-Unsubscribe-Post (RFC 2369, RFC 8058). */
export function unsubscribeHeaders(u: UnsubscribeHeaderInput): Record<string, string> {
  if (!u.url.startsWith('https://')) throw new HeaderRefused('List-Unsubscribe');
  return {
    'List-Unsubscribe': `<${headerValue('List-Unsubscribe', u.url)}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/**
 * The only extra headers a message may carry: the ones `unsubscribeHeaders` builds. Anything else
 * (`From`, `Bcc`, `Reply-To`, a name of any other spelling) is refused.
 */
export const EXTRA_HEADERS: ReadonlySet<string> = new Set([
  'List-Unsubscribe',
  'List-Unsubscribe-Post',
]);

export function buildOutgoing(input: {
  to: string;
  mail: RenderedMail;
  idempotencyKey: string;
  headers?: Readonly<Record<string, string>>;
}): OutgoingMail {
  if (!isPlainAddress(input.to)) throw new HeaderRefused('to');
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    if (!EXTRA_HEADERS.has(name)) throw new HeaderRefused('header name');
    headers[name] = headerValue(name, value);
  }
  return {
    from: MAIL_FROM,
    to: input.to,
    subject: headerValue('subject', input.mail.subject, SUBJECT_MAX),
    text: input.mail.text,
    html: input.mail.html,
    headers,
    idempotencyKey: headerValue('idempotency key', input.idempotencyKey, 200),
  };
}
