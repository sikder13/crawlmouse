/**
 * The SSRF guard for a named first site, run when the site is attached at first login: the engine's
 * `validateUrlOrThrow` (scheme, credentials, DNS, private ranges). Server only: the engine must not
 * reach a client bundle (__tests__/crawled-text-cut-guard.test.ts).
 */

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
