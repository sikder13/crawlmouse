/**
 * The support link (CC-33 D5): a `mailto:` to the support address with a fixed subject and a body
 * whose first lines carry the ids the page has. Each value is kept only when it has the shape of its
 * field (an id, the path, a fix type, a Sentry event id); anything else is dropped, never escaped and
 * kept, so no value can carry a line break, an address or a header into the email. The property test
 * beside this file holds that for any string in any field.
 */
import { FixTypeSchema } from '@crawlmouse/types/v2';
import { SUPPORT_COPY, SUPPORT_EMAIL } from '../copy/support';

export type SupportTopic = keyof typeof SUPPORT_COPY.mail.subject;

export interface SupportRequest {
  topic: SupportTopic;
  /** The page's path, as the browser shows it. */
  path: string;
  accountId?: string | null;
  siteId?: string | null;
  checkId?: string | null;
  fixId?: string | null;
  fixType?: string | null;
  /** The Sentry event id of the error the page showed. */
  eventId?: string | null;
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_ID = /^[0-9a-f]{32}$/i;
const PATH = /^\/[A-Za-z0-9/_.-]{0,200}$/;
const FIX_TYPES: ReadonlySet<string> = new Set(FixTypeSchema.options);

const isFixType = (v: string) => FIX_TYPES.has(v);

/** The body's id lines, in order: each field's label and the test its value must pass. */
const FIELDS: readonly [keyof SupportRequest, string, (v: string) => boolean][] = [
  ['path', 'Page', (v) => PATH.test(v)],
  ['accountId', 'Account', (v) => ID.test(v)],
  ['siteId', 'Site', (v) => ID.test(v)],
  ['checkId', 'Check', (v) => ID.test(v)],
  ['fixId', 'Fix', (v) => ID.test(v)],
  ['fixType', 'Fix type', isFixType],
  ['eventId', 'Reference', (v) => EVENT_ID.test(v)],
];

export function supportMailto(input: SupportRequest): string {
  const topic: SupportTopic = Object.hasOwn(SUPPORT_COPY.mail.subject, input.topic)
    ? input.topic
    : 'general';
  const lines = FIELDS.flatMap(([key, label, accepts]) => {
    const value = input[key];
    return typeof value === 'string' && accepts(value) ? [`${label}: ${value}`] : [];
  });
  const body = [...lines, '', SUPPORT_COPY.mail.prompt[topic], ''].join('\r\n');
  const subject = SUPPORT_COPY.mail.subject[topic];
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

const SITE_PAGE =
  /^\/sites\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

/** The ids a path names: a site page's site id. */
export function idsInPath(path: string | null): { siteId?: string } {
  const site = path === null ? null : SITE_PAGE.exec(path);
  return site ? { siteId: site[1]! } : {};
}
