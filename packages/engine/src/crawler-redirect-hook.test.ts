import { describe, expect, it } from 'vitest';
import { makeRedirectHook } from './crawler.js';

/**
 * The redirect hook's SSRF re-check, called directly. Crawl tests run with
 * `allowPrivateIpsForTesting`, which turns the re-check off, so none of them fails when it is removed
 * (QA F-242). These do. Every target is an IP literal, so no DNS is asked.
 */
const hook = (revalidateSsrf: boolean) => makeRedirectHook(undefined, revalidateSsrf);
/** What got passes the hook: options whose url is the redirect URL it will request. */
const options = (url: string) => ({ url: new URL(url) });

describe('the redirect hook re-checks the target against the SSRF guard', () => {
  it.each([
    'http://127.0.0.1/x',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[fd00::1]/',
  ])('refuses a redirect to %s', async (target) => {
    await expect(hook(true)(options(target))).rejects.toThrow();
  });

  it('lets a redirect to a public address through, so the refusals above are not refusing everything', async () => {
    await expect(hook(true)(options('http://93.184.216.34/page'))).resolves.toBeUndefined();
  });

  it('checks the URL got will request, whatever the raw Location header says', async () => {
    // got has already resolved the header into options.url; a hook that re-read the header would
    // check the public address and let the private one through.
    const response = { headers: { location: 'http://93.184.216.34/' } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect((hook(true) as any)(options('http://10.0.0.5/'), response)).rejects.toThrow();
  });

  it('skips the re-check only when the crawl is told to, as loopback fixtures are', async () => {
    await expect(hook(false)(options('http://127.0.0.1/x'))).resolves.toBeUndefined();
  });
});
