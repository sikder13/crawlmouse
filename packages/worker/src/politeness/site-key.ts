import { getDomain } from 'tldts';

/**
 * The registrable domain (eTLD+1) a URL belongs to, by the Public Suffix List including its private
 * section, so `www.nike.com` and `nike.com` share a key while `a.github.io` and `b.github.io` do not.
 * An IP address or a single-label host has no registrable domain and is its own key.
 *
 * Politeness is keyed on this, and so is "off-site" for `redirected_away`.
 */
export function siteKeyOf(url: string | URL): string {
  const hostname = (typeof url === 'string' ? new URL(url) : url).hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  return getDomain(hostname, { allowPrivateDomains: true }) ?? hostname;
}
