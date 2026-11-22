/**
 * Where the journeys run, and whether a step that writes may run there.
 *
 * A step that writes (a check, an account, a mail) runs only when all three hold; otherwise it is
 * skipped with the reason:
 *   1. the base URL's host, lower-cased and without trailing dots, is in WRITABLE_HOSTS, the host QA's
 *      staging design names;
 *   2. JOURNEY_ALLOW_WRITES is exactly "1";
 *   3. the deployment itself shows staging's database: its Content-Security-Policy, which the build
 *      writes from NEXT_PUBLIC_SUPABASE_URL (apps/web/next.config.mjs), names STAGING_DB_HOST and not
 *      production's project (databaseRefusal). A name is not proof of what a deployment holds; this is.
 * It is an allowlist, so every other host is read-only, whatever it is called: production under any
 * spelling or alias (`crawlmouse.com.`, `crawlmouse-001.vercel.app`), a Vercel preview or branch alias
 * (the staging environment's own alias is the one listed exception), localhost (a dev
 * server may hold a copied `.env.local`). The production and preview refusals are named first so the
 * skip says why. guard.spec.ts varies the spellings.
 */
/** Vercel's alias for the `staging` custom environment, used until staging.crawlmouse.com has its DNS record. */
export const STAGING_ALIAS = 'crawlmouse-001-env-staging-nahl-technologies-projects.vercel.app';
export const WRITABLE_HOSTS: readonly string[] = ['staging.crawlmouse.com', STAGING_ALIAS];
export const PRODUCTION_HOSTS: readonly string[] = ['crawlmouse.com', 'www.crawlmouse.com'];
/** crawlmouse-staging's database host, and production's project ref (scripts/db/target.ts PRODUCTION_REF). */
export const STAGING_DB_HOST = 'qfgkrnnjuiasahspavbc.supabase.co';
export const PRODUCTION_REF = 'ezspnfeyzwsisymytssm';

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
  if (host.endsWith('.vercel.app') && !WRITABLE_HOSTS.includes(host))
    return `${host} is a Vercel deployment: steps that write run only on staging`;
  if (!WRITABLE_HOSTS.includes(host))
    return `${host} is not staging (WRITABLE_HOSTS): steps that write never run there`;
  if (env.JOURNEY_ALLOW_WRITES !== '1') return 'JOURNEY_ALLOW_WRITES is not "1"';
  return null;
}

/**
 * null when a deployment's response headers show staging's database; otherwise why not. Fails closed:
 * no policy, a policy naming production's project, or one not naming staging's database all refuse.
 */
export function databaseRefusal(headers: Readonly<Record<string, string>>): string | null {
  const csp = Object.entries(headers)
    .filter(([k]) => /^content-security-policy(-report-only)?$/i.test(k))
    .map(([, v]) => v)
    .join(' ');
  if (!csp)
    return 'the deployment sends no Content-Security-Policy, so its database cannot be told';
  if (csp.includes(PRODUCTION_REF)) return "the deployment's policy names production's database";
  // The host as a whole token: a look-alike such as `<staging host>.evil.test` does not count.
  const staging = new RegExp(`(^|[\\s/])${STAGING_DB_HOST.replace(/\./g, '\\.')}(?![\\w.-])`);
  if (!staging.test(csp)) return "the deployment's policy does not name staging's database";
  return null;
}
