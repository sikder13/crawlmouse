/**
 * Whether a URL's host is a plain DNS name, an IPv4 address or an IPv6 literal, as the WHATWG URL
 * parser leaves it: the hostname lower-cased and an internationalised name in its punycode form.
 *
 * Why it is needed: the parser keeps characters such as `{ } * ! + , ( )` in a hostname
 * (`new URL('http://{a,b}{c,d}.example.com/').origin` keeps the braces), and crawlee's
 * `enqueueLinks({ strategy: 'same-hostname' })` builds a minimatch glob from the page's origin. A
 * crawled site that can put brace groups into a hostname can make that glob take exponential work
 * (GHSA-g3hv-75wg-m249 in minimatch 9.0.9). A real web host is letters, digits, hyphens and dots, so
 * this refuses everything else rather than escaping it.
 *
 * Rejected by this rule, though some DNS names carry it: an underscore. Production on 2026-11-24 had
 * 0 of 187 audits and 0 of 21 sites with a host outside the rule, underscores included (read-only):
 *   select count(*) filter (where substring(url from '^[a-z]+://([^/:?#]+)') ~ '[^a-z0-9.\-\[\]:]'),
 *          count(*) from public.audits;
 *   select count(*) filter (where host ~ '[^a-z0-9.\-\[\]:]'), count(*) from public.sites;
 */
const PLAIN_NAME = /^[a-z0-9.-]+$/;
const IPV6_LITERAL = /^\[[0-9a-f:.]+\]$/;

/** A hostname as the URL parser leaves it: letters, digits, hyphens and dots, or an IPv6 literal. */
export function isPlainHost(host: string): boolean {
  return PLAIN_NAME.test(host) || IPV6_LITERAL.test(host);
}

/** A URL that parses, and whose hostname is plain. */
export function hasPlainHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return isPlainHost(host);
}

/** Thrown for a crawl's start URL whose host is not plain. */
export class HostnameRefusedError extends Error {
  /**
   * The URL is kept on the error, not in its message: a failed audit is classified by words in the
   * message (apps/web/lib/failure-classification.ts), and a URL could carry any of them.
   */
  constructor(readonly url: string) {
    super('Refused a start URL whose host is not letters, digits, hyphens and dots');
    this.name = 'HostnameRefusedError';
  }
}

export function assertPlainHost(url: string): void {
  if (!hasPlainHost(url)) throw new HostnameRefusedError(url);
}
