/**
 * Where the journeys run, and whether a step that writes may run there.
 *
 * A step that writes (a check, an account, a mail) runs only when both hold; otherwise it is skipped
 * with the reason:
 *   1. the base URL's host, lower-cased and without trailing dots, is in WRITABLE_HOSTS: staging's
 *      own host, which has its own database, queue, worker and test payment keys;
 *   2. JOURNEY_ALLOW_WRITES is exactly "1".
 * It is an allowlist, so every other host is read-only, whatever it is called: production under any
 * spelling or alias (`crawlmouse.com.`, `crawlmouse-001.vercel.app`), a Vercel preview, localhost (a dev
 * server may hold a copied `.env.local`). The production and preview refusals are named first so the
 * skip says why. guard.spec.ts varies the spellings.
 */
export const WRITABLE_HOSTS: readonly string[] = ['staging.crawlmouse.com'];
export const PRODUCTION_HOSTS: readonly string[] = ['crawlmouse.com', 'www.crawlmouse.com'];

export type Env = Readonly<Record<string, string | undefined>>;

export function baseUrlOf(env: Env): URL {
  const raw = env.JOURNEY_BASE_URL?.trim();
  if (!raw) throw new Error('JOURNEY_BASE_URL is required (the deployment to test)');
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error(`JOURNEY_BASE_URL must be https (got ${url.protocol})`);
  }
  return url;
}

/** A host as DNS resolves it: case and trailing dots do not change the site. */
export function canonicalHost(host: string): string {
  return host.toLowerCase().replace(/\.+$/, '');
}

/** null when writes may run; otherwise the reason they may not. */
export function writeRefusal(env: Env): string | null {
  const host = canonicalHost(baseUrlOf(env).hostname);
  if (PRODUCTION_HOSTS.includes(host))
    return `${host} is production: steps that write never run there`;
  if (host.endsWith('.vercel.app'))
    return `${host} is a Vercel deployment: steps that write run only on staging`;
  if (!WRITABLE_HOSTS.includes(host))
    return `${host} is not staging (WRITABLE_HOSTS): steps that write never run there`;
  if (env.JOURNEY_ALLOW_WRITES !== '1') return 'JOURNEY_ALLOW_WRITES is not "1"';
  return null;
}
