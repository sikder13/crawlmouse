/**
 * The host a public start names, from the address a visitor typed. It is spelled as a named first
 * site's host is spelled (`hostFromSiteInput`: lower case, punycode, one trailing dot dropped, `www.`
 * kept), so a public site and a named site of one host hold the same `sites.host`. A port other than
 * the scheme's default is refused, because the crawl starts at `https://{host}/`
 * (`homepageOf`, lib/v2/pipeline/request.ts). Shape only: the SSRF guard runs after this.
 */
import { hostFromSiteInput } from '../../../../lib/auth/site-host';

export function publicHost(input: string): string | null {
  const host = hostFromSiteInput(input);
  if (host === null) return null;
  // `hostFromSiteInput` accepted the input, so it is an http(s) URL or has no scheme.
  const typed = input.trim();
  const url = new URL(/^https?:/i.test(typed) ? typed : `https://${typed}`);
  return url.port === '' ? host : null;
}
