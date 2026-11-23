import { getDomain } from 'tldts';

/**
 * The registrable domain (eTLD+1) a URL belongs to, by the Public Suffix List including its private
 * section, so `www.nike.com` and `nike.com` share a key while `a.github.io` and `b.github.io` do not.
 * An IP address or a single-label host has no registrable domain and is its own key.
 *
 * "Off-site" for `redirected_away` is keyed on this, and so is politeness (`politenessKeyOf`), except
 * for our own lab hosts on a worker that sets LAB_HOST_POLITENESS.
 */
export function siteKeyOf(url: string | URL): string {
  const hostname = hostnameOf(url);
  return getDomain(hostname, { allowPrivateDomains: true }) ?? hostname;
}

const hostnameOf = (url: string | URL): string =>
  (typeof url === 'string' ? new URL(url) : url).hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();

/** Our own QA hosts. A constant, so the setting that uses it cannot reach another domain. */
const LAB_HOST_SUFFIX = '.lab.crawlmouse.com';

/**
 * The key the limiter and the stop rules use. It is `siteKeyOf`, except that with `perLabHost` (the
 * staging worker's LAB_HOST_POLITENESS) a host under `lab.crawlmouse.com` is a site of its own, so a
 * load test of many lab hosts does not measure one shared limiter (F-018). "Off-site" stays on
 * `siteKeyOf`, so a redirect between lab hosts reads as it always has.
 */
export function politenessKeyOf(url: string | URL, perLabHost: boolean): string {
  if (!perLabHost) return siteKeyOf(url);
  const hostname = hostnameOf(url);
  const under = hostname.endsWith(LAB_HOST_SUFFIX)
    ? hostname.slice(0, -LAB_HOST_SUFFIX.length).split('.')
    : [];
  return under.length > 0 && under.every(Boolean) ? hostname : siteKeyOf(url);
}
