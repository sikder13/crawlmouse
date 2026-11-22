/**
 * Where the journeys run, and whether a step that writes may run there.
 *
 * A step that writes (a check, an account, a mail) runs only when every one of these holds; otherwise
 * it is skipped with the reason, so a run against the wrong place cannot change data:
 *   1. the base URL's host is not a production host (PRODUCTION_HOSTS);
 *   2. the host is one the run declares writable in JOURNEY_WRITE_HOSTS (comma-separated, exact host
 *      names); there is no default, so an undeclared host is read-only;
 *   3. JOURNEY_ALLOW_WRITES is exactly "1".
 * A preview that still uses production's database must not be declared writable: that is the
 * operator's declaration to make, and staging's runbook (QA questions/001) says which hosts qualify.
 */
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

export function isProductionHost(host: string): boolean {
  return PRODUCTION_HOSTS.includes(host.toLowerCase());
}

/** null when writes may run; otherwise the reason they may not. */
export function writeRefusal(env: Env): string | null {
  const host = baseUrlOf(env).hostname.toLowerCase();
  if (isProductionHost(host)) return `${host} is production: steps that write never run there`;
  const declared = (env.JOURNEY_WRITE_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (declared.some(isProductionHost)) return 'JOURNEY_WRITE_HOSTS names a production host';
  if (!declared.includes(host)) return `${host} is not declared in JOURNEY_WRITE_HOSTS`;
  if (env.JOURNEY_ALLOW_WRITES !== '1') return 'JOURNEY_ALLOW_WRITES is not "1"';
  return null;
}
