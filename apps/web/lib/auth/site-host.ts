/**
 * A first site's host, from what a person typed in the Sign-up form: the shape only, with no
 * network call, so a resolver blip cannot block a sign-up over an optional field, and safe in a
 * client bundle. The SSRF guard runs when the site is attached (`admit-site.ts`, server only). The
 * normalisation is the guard's own: `new URL` lowercases and punycodes, and a single trailing dot
 * is dropped.
 */
import { HostSchema } from '@crawlmouse/types/v2';

export function hostFromSiteInput(raw: string): string | null {
  const input = raw.trim();
  if (input === '') return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  const host = url.hostname.replace(/\.$/, '').toLowerCase();
  return HostSchema.safeParse(host).success ? host : null;
}
