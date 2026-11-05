/**
 * Against Browser Run itself. Runs only when the environment holds CLOUDFLARE_ACCOUNT_ID and
 * CLOUDFLARE_BROWSER_RENDERING_TOKEN; otherwise every case is skipped, not failed. A run costs a few
 * browser-seconds and fetches a handful of public URLs. These are the only tests that can show the
 * determinism bounds, that the static side really loads no script file, and that Browser Run reads and
 * enforces the patterns we send: offline, a replayed reply is identical every time.
 */
import { describe, expect, it } from 'vitest';
import {
  BROWSER_RUN,
  clientFromEnv,
  ENV,
  renderRequestBody,
  type BrowserRunClient,
  type RenderSide,
} from './client.js';
import { PARITY_SPREAD, REPEAT_SPREAD, spread, within } from './parity.js';
import { mainWords } from './words.js';

const client = clientFromEnv(process.env);
const live = describe.skipIf(client === null);

/** A page served whole as HTML, with no script: its two sides should agree. */
const STATIC_PAGE = 'https://example.com/';
/** A long page with scripts, for the spread between renders. */
const REPEAT_PAGE = 'https://developers.cloudflare.com/browser-run/';
/** DECISION-LOG I8: the spread is taken over five renders. */
const REPEAT_RENDERS = 5;

async function words(c: BrowserRunClient, url: string, side: RenderSide) {
  const r = await c.content(url, side);
  if (!r.ok) throw new Error(`${side} render of ${url} failed: ${r.reason}`);
  return mainWords(r.html);
}

/**
 * Renders `html` with the request a page's `side` gets, and returns the HTML Browser Run holds. With
 * `rules: false` the refusal lists are sent empty, for a control render.
 */
async function renderHtml(html: string, side: RenderSide, rules = true): Promise<string> {
  const body: Record<string, unknown> = { ...renderRequestBody(STATIC_PAGE, side), html };
  if (!rules) Object.assign(body, { rejectResourceTypes: [], rejectRequestPattern: [] });
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
  return ((await res.json()) as { result: string }).result;
}

/** A page that requests each URL and writes `name=loaded` or `name=blocked` into #out. */
function probePage(attempts: Record<string, string>): string {
  const calls = Object.entries(attempts)
    .map(([name, url]) => `attempt(${JSON.stringify(name)}, ${JSON.stringify(url)});`)
    .join('\n');
  return `<html><body><main><p id="out">probe</p></main><script>
    const out = document.getElementById('out');
    const mark = (name, outcome) => out.append(' ' + name + '=' + outcome);
    function attempt(name, url) {
      fetch(url, { mode: 'no-cors', cache: 'no-store' }).then(
        () => mark(name, 'loaded'),
        () => mark(name, 'blocked'),
      );
    }
    ${calls}
    try {
      const ws = new WebSocket('wss://ws.postman-echo.com/raw');
      ws.onopen = () => mark('websocket', 'loaded');
      ws.onerror = () => mark('websocket', 'blocked');
    } catch {
      mark('websocket', 'blocked');
    }
  </script></body></html>`;
}

const outOf = (html: string) => /<p id="out">([^<]*)/.exec(html)?.[1] ?? '';

live('Browser Run, live', () => {
  it(`renders a static page to within ${PARITY_SPREAD * 100} % of its static side`, async () => {
    const raw = await words(client!, STATIC_PAGE, 'static');
    const rendered = await words(client!, STATIC_PAGE, 'rendered');
    console.info(
      `parity ${STATIC_PAGE}: static ${raw}, rendered ${rendered}, spread ${spread(raw, rendered)}`,
    );
    expect(raw).toBeGreaterThan(0);
    expect(within(raw, rendered, PARITY_SPREAD)).toBe(true);
  }, 120_000);

  it(`renders one page ${REPEAT_RENDERS} times to within ${REPEAT_SPREAD * 100} % of itself`, async () => {
    const counts: number[] = [];
    for (let i = 0; i < REPEAT_RENDERS; i += 1) {
      counts.push(await words(client!, REPEAT_PAGE, 'rendered'));
    }
    const [lo, hi] = [Math.min(...counts), Math.max(...counts)];
    console.info(`repeat ${REPEAT_PAGE}: ${counts.join(', ')}, spread ${spread(lo, hi)}`);
    expect(lo).toBeGreaterThan(0);
    expect(within(lo, hi, REPEAT_SPREAD)).toBe(true);
  }, 300_000);

  it('loads no script file on the static side, and loads it on the rendered side', async () => {
    // The inline script runs on both sides (it is not a request) and reports whether the file loaded.
    const page = `<html><body><main><p id="out">probe</p></main>
        <script src="https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js"></script>
        <script>
          document.getElementById('out').append(
            typeof window.jQuery === 'undefined' ? ' script=blocked' : ' script=loaded',
          );
        </script></body></html>`;
    const staticOut = outOf(await renderHtml(page, 'static'));
    const renderedOut = outOf(await renderHtml(page, 'rendered'));
    console.info(`script probe: static "${staticOut}", rendered "${renderedOut}"`);
    expect(staticOut).toContain('script=blocked');
    expect(renderedOut).toContain('script=loaded');
  }, 120_000);

  it('refuses what the rules refuse, each of which loads when the rules are left out', async () => {
    const attempts = {
      control_ip: 'https://one.one.one.one/cdn-cgi/trace',
      ip_literal: 'https://1.1.1.1/cdn-cgi/trace',
      control_download: 'https://registry.npmjs.org/left-pad',
      download: 'https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz',
      host_analytics: 'https://www.googletagmanager.com/gtm.js?id=GTM-K9J7',
      host_advertising: 'https://securepubads.g.doubleclick.net/tag/js/gpt.js',
      host_consent: 'https://cdn.cookielaw.org/scripttemplates/otSDKStub.js',
      host_chat: 'https://widget.intercom.io/widget/abc123',
    };
    const refused = [
      'ip_literal',
      'download',
      'host_analytics',
      'host_advertising',
      'host_consent',
      'host_chat',
      'websocket',
    ];
    // Without the rules, each URL and the WebSocket must load: otherwise a refusal below shows nothing.
    const open = outOf(await renderHtml(probePage(attempts), 'rendered', false));
    const ruled = outOf(await renderHtml(probePage(attempts), 'rendered'));
    console.info(`policy probe, rules off: ${open}`);
    console.info(`policy probe, rules on: ${ruled}`);
    for (const name of [...Object.keys(attempts), 'websocket']) {
      expect(open).toContain(`${name}=loaded`);
    }
    for (const name of ['control_ip', 'control_download'])
      expect(ruled).toContain(`${name}=loaded`);
    for (const name of refused) expect(ruled).toContain(`${name}=blocked`);
  }, 120_000);
});
