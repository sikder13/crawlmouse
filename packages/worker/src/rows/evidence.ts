import { bounded, CAPS } from './bounded.js';
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

export const BODY_EXCERPT_BYTES = CAPS.bodyExcerpt.bytes;

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
    name: bounded(name, CAPS.headerName),
    value: bounded(value, CAPS.headerValue),
  }));
}

export function evidenceHeaders(fetch: FetchOutcome): Header[] {
  return EVIDENCE_HEADERS.flatMap((name) => {
    const v = fetch.headers[name];
    if (v === undefined) return [];
    const value = Array.isArray(v) ? v.join(', ') : String(v);
    return [{ name: bounded(name, CAPS.headerName), value: bounded(value, CAPS.headerValue) }];
  });
}

/** An absolute http(s) URL. */
export const isWebUrl = (url: string): boolean => /^https?:\/\//i.test(url) && URL.canParse(url);

/**
 * An http(s) URL as a row stores it, or null: a redirect can point anywhere, the contract holds only
 * web URLs, and a URL over CAPS.url is not stored.
 */
export function storedUrl(url: string | null): string | null {
  return url !== null && isWebUrl(url) ? bounded(url, CAPS.url) : null;
}

export const bodyExcerpt = (fetch: FetchOutcome): string | null =>
  fetch.status === null ? null : bounded(fetch.body, CAPS.bodyExcerpt);

export const userAgentOf = (fetch: FetchOutcome | null, identity: Identity): string =>
  bounded((fetch?.identity ?? identity).userAgent, CAPS.identity);

/** A row's limitations, each cut to the contract's 500 characters. */
export const storedLimitations = (limitations: readonly string[]): string[] =>
  limitations.map((l) => bounded(l, CAPS.limitation));

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
