/**
 * Whether a URL's host is a plain DNS name, an IPv4 address or an IPv6 literal, as the WHATWG URL
 * parser leaves it: the hostname lower-cased and an internationalised name in its punycode form.
 *
 * Why it is needed: the parser keeps characters such as `{ } * ? ! + , ( )` in a hostname
 * (`new URL('http://{a,b}{c,d}.example.com/').origin` keeps the braces), and crawlee's
 * `enqueueLinks({ strategy: 'same-hostname' })` builds a minimatch glob from the page's origin. A
 * crawled site that can put brace groups into a hostname can make that glob take exponential work
 * (GHSA-g3hv-75wg-m249 in minimatch 9.0.9). A real web host is letters, digits, hyphens and dots, so
 * this refuses everything else rather than escaping it.
 *
 * Rejected by this rule and measured as absent from production on 2026-11-24: an underscore, which
 * some DNS names carry but no audited site had (0 of 187 audits, 0 of 21 sites).
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
  constructor(url: string) {
    super(`Refused a URL whose host is not letters, digits, hyphens and dots: ${url}`);
    this.name = 'HostnameRefusedError';
  }
}

export function assertPlainHost(url: string): void {
  if (!hasPlainHost(url)) throw new HostnameRefusedError(url);
}
