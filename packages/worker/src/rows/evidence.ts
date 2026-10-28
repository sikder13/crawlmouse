import { toPersistableText } from '@crawlmouse/engine/worker';
import type { FetchOutcome } from '../fetch/fetcher.js';
import type { Identity } from '../identities.js';

/** The parts of a request and its response that every evidence row carries, cut to the contract's budgets. */

/** Response headers that bear on a verdict; no other header is recorded. */
export const EVIDENCE_HEADERS = [
  'server',
  'content-type',
  'location',
  'retry-after',
  'cf-mitigated',
  'x-vercel-mitigated',
  'cf-ray',
  'crawler-price',
] as const;

export const BODY_EXCERPT_BYTES = 2000;
const HEADER_VALUE_BYTES = 1024;

export interface Header {
  name: string;
  value: string;
}

/** The URL of the last request actually sent: a stopped chain's Location was not requested. */
function lastRequested(fetch: FetchOutcome): string {
  if (fetch.redirectStop !== null) return fetch.hops.at(-1)!.from;
  return fetch.finalUrl ?? fetch.url;
}

export function requestHeaders(fetch: FetchOutcome): Header[] {
  const host = new URL(lastRequested(fetch)).host;
  return [['Host', host] as const, ...fetch.identity.headers].map(([name, value]) => ({
    name,
    value: toPersistableText(value, HEADER_VALUE_BYTES),
  }));
}

export function evidenceHeaders(fetch: FetchOutcome): Header[] {
  return EVIDENCE_HEADERS.flatMap((name) => {
    const v = fetch.headers[name];
    if (v === undefined) return [];
    const value = Array.isArray(v) ? v.join(', ') : String(v);
    return [{ name, value: toPersistableText(value, HEADER_VALUE_BYTES) }];
  });
}

/** An http(s) URL, or null: a redirect can point anywhere, and the contract only holds web URLs. */
export function webUrlOrNull(url: string | null): string | null {
  return url !== null && /^https?:\/\//i.test(url) && URL.canParse(url) ? url : null;
}

export const bodyExcerpt = (fetch: FetchOutcome): string | null =>
  fetch.status === null ? null : toPersistableText(fetch.body, BODY_EXCERPT_BYTES);

export const userAgentOf = (fetch: FetchOutcome | null, identity: Identity): string =>
  (fetch?.identity ?? identity).userAgent;

/** The contract holds standard statuses (100-599); anything else (LinkedIn's 999, say) is recorded as null. */
export const standardStatus = (status: number | null): number | null =>
  status !== null && status >= 100 && status <= 599 ? status : null;

export const nonStandardStatus = (status: number): string =>
  `The server answered with the non-standard status ${status}, which is not recorded as a status.`;

/** Limitations a request adds whatever its verdict. */
export function requestLimitations(fetch: FetchOutcome | null): string[] {
  if (!fetch || fetch.status === null || standardStatus(fetch.status) !== null) return [];
  return [nonStandardStatus(fetch.status)];
}
