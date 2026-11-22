/**
 * Vercel Deployment Protection. A protected preview answers a stranger with 401 and Vercel's sign-in page
 * instead of the app. The suite then needs the Protection Bypass for Automation secret,
 * VERCEL_AUTOMATION_BYPASS_SECRET, sent as `x-vercel-protection-bypass`.
 *
 * The header goes only to the deployment's own origin: a page also fetches fonts, analytics and other
 * hosts, and Playwright's extraHTTPHeaders would send the secret to every one of them.
 */
export const BYPASS_HEADER = 'x-vercel-protection-bypass';

export function bypassSecret(env: Readonly<Record<string, string | undefined>>): string | null {
  const s = env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  return s ? s : null;
}

/** The headers for requests to the deployment's own origin: the bypass, when there is a secret. */
export function originHeaders(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const s = bypassSecret(env);
  return s ? { [BYPASS_HEADER]: s } : {};
}

/**
 * null when a probe of the deployment reached the app; otherwise why the run cannot go on. A 401 or 403
 * from Vercel's own edge is Deployment Protection: without a secret the run stops with that reason, and
 * with one it means the secret was refused.
 */
export function protectionRefusal(
  status: number,
  headers: Readonly<Record<string, string>>,
  hasSecret: boolean,
): string | null {
  const vercel =
    /vercel/i.test(headers['server'] ?? '') ||
    Object.keys(headers).some((k) => k.startsWith('x-vercel'));
  if (!vercel || (status !== 401 && status !== 403)) return null;
  return hasSecret
    ? `the deployment refused the bypass secret (${status}): VERCEL_AUTOMATION_BYPASS_SECRET is wrong for this project`
    : `the deployment is behind Vercel Deployment Protection (${status}): set VERCEL_AUTOMATION_BYPASS_SECRET`;
}
