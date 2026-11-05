/**
 * Against Browser Run itself. Runs only when the environment holds CLOUDFLARE_ACCOUNT_ID and
 * CLOUDFLARE_BROWSER_RENDERING_TOKEN; otherwise every case is skipped, not failed. Each run costs a few
 * browser-seconds. These are the only tests that can show the two determinism bounds and that
 * Cloudflare enforces the request policy: offline, a replayed reply is identical every time.
 */
import { describe, expect, it } from 'vitest';
import {
  BROWSER_RUN,
  clientFromEnv,
  ENV,
  renderRequestBody,
  type BrowserRunClient,
} from './client.js';
import { PARITY_SPREAD, REPEAT_SPREAD, spread, within } from './parity.js';
import { mainWords } from './words.js';

const client = clientFromEnv(process.env);
const live = describe.skipIf(client === null);

/** A page served whole as HTML, with no script: its two sides should agree. */
const STATIC_PAGE = 'https://example.com/';
/** A long page with scripts, for the spread between two renders. */
const REPEAT_PAGE = 'https://developers.cloudflare.com/browser-run/';

async function words(c: BrowserRunClient, url: string, side: 'static' | 'rendered') {
  const r = await c.content(url, side);
  if (!r.ok) throw new Error(`${side} render of ${url} failed: ${r.reason}`);
  return mainWords(r.html);
}

live('Browser Run, live', () => {
  it(`renders a static page to within ${PARITY_SPREAD * 100} % of its static side`, async () => {
    const raw = await words(client!, STATIC_PAGE, 'static');
    const rendered = await words(client!, STATIC_PAGE, 'rendered');
    console.info(
      `parity ${STATIC_PAGE}: static ${raw}, rendered ${rendered}, spread ${spread(raw, rendered)}`,
    );
    expect(raw).toBeGreaterThan(0);
    expect(within(raw, rendered, PARITY_SPREAD)).toBe(true);
  }, 60_000);

  it(`renders one page twice to within ${REPEAT_SPREAD * 100} % of itself`, async () => {
    const first = await words(client!, REPEAT_PAGE, 'rendered');
    const second = await words(client!, REPEAT_PAGE, 'rendered');
    console.info(`repeat ${REPEAT_PAGE}: ${first} and ${second}, spread ${spread(first, second)}`);
    expect(first).toBeGreaterThan(0);
    expect(within(first, second, REPEAT_SPREAD)).toBe(true);
  }, 60_000);

  it('enforces the request policy we send, while letting an ordinary request through', async () => {
    // The probe reports each request's fate into the page; the HTML that comes back carries it.
    const probe = `<html><body><main><p id="out">probe</p></main><script>
        const out = document.getElementById('out');
        const mark = (k, v) => out.append(' ' + k + '=' + v);
        const tryFetch = (k, u) => fetch(u, { mode: 'no-cors' }).then(() => mark(k, 'loaded'), () => mark(k, 'blocked'));
        tryFetch('analytics', 'https://www.google-analytics.com/g/collect');
        tryFetch('port', 'https://example.com:8080/');
        tryFetch('control', 'https://example.com/');
        try {
          const ws = new WebSocket('wss://example.com/socket');
          ws.onopen = () => mark('ws', 'loaded');
          ws.onerror = () => mark('ws', 'blocked');
        } catch { mark('ws', 'blocked'); }
      </script></body></html>`;
    const body: Record<string, unknown> = {
      ...renderRequestBody(STATIC_PAGE, 'rendered'),
      html: probe,
    };
    delete body.url;
    const res = await fetch(
      BROWSER_RUN.endpoint.replace('{account_id}', process.env[ENV.account]!.trim()),
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${process.env[ENV.token]!.trim()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
    expect(res.status).toBe(200);
    expect(Number(res.headers.get(BROWSER_RUN.browser_ms_header))).toBeGreaterThan(0);
    const html = ((await res.json()) as { result: string }).result;
    console.info(`policy probe: ${/<p id="out">([^<]*)/.exec(html)?.[1]}`);
    expect(html).toContain('control=loaded');
    expect(html).toContain('analytics=blocked');
    expect(html).toContain('ws=blocked');
    expect(html).not.toContain('port=loaded');
  }, 60_000);
});
