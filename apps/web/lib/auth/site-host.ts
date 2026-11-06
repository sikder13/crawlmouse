/**
 * A first site's host, from what a person typed in the Sign-up form.
 *
 * Two steps, at two moments. `hostFromSiteInput` checks the shape when the link is requested, with no
 * network call, so a resolver blip cannot block a sign-up over an optional field. `admitSiteHost`
 * runs the engine's SSRF guard (`validateUrlOrThrow`: scheme, credentials, DNS, private ranges)
 * when the site is attached at first login. The host normalisation is the guard's own: `new URL`
 * lowercases and punycodes, and a single trailing dot is dropped.
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

type Validate = (url: string) => Promise<unknown>;

const engineGuard: Validate = async (url) => {
  const { validateUrlOrThrow } = await import('@crawlmouse/engine');
  return validateUrlOrThrow(url);
};

export async function admitSiteHost(
  host: string,
  validate: Validate = engineGuard,
): Promise<boolean> {
  try {
    await validate(`https://${host}/`);
    return true;
  } catch {
    return false;
  }
}
