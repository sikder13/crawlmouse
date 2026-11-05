/**
 * Against Browser Run itself. Runs only when the environment holds CLOUDFLARE_ACCOUNT_ID and
 * CLOUDFLARE_BROWSER_RENDERING_TOKEN, or when RENDER_LIVE=1 and the owner's file outside the repo,
 * ~/.config/crawlmouse/render.env, holds them; otherwise every case is skipped, not failed. The
 * console lines print word counts and probe output, not the credentials:
 * `grep -n console.info src/v2/render/live.test.ts`. A run costs a few browser-seconds and fetches a
 * handful of public URLs. These are the only tests that can show the determinism bounds, that the
 * static side refuses script files and runs no inline script, and that Browser Run reads and enforces
 * the patterns we send: offline, a replayed reply is identical every time. The probes send the page
 * as `html`; production sends `url`.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
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

/** The owner's credentials file, read only here and only with RENDER_LIVE=1. */
const LIVE_ENV_FILE = join(homedir(), '.config', 'crawlmouse', 'render.env');

/** The two credentials, from the environment, or else from LIVE_ENV_FILE when RENDER_LIVE=1. */
function liveEnv(): Record<string, string | undefined> {
  const fromEnv = { [ENV.account]: process.env[ENV.account], [ENV.token]: process.env[ENV.token] };
  if ((fromEnv[ENV.account] && fromEnv[ENV.token]) || process.env.RENDER_LIVE !== '1')
    return fromEnv;
  let text: string;
  try {
    text = readFileSync(LIVE_ENV_FILE, 'utf8');
  } catch {
    return fromEnv;
  }
  const read: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || (m[1] !== ENV.account && m[1] !== ENV.token)) continue;
    read[m[1]] = m[2]!.replace(/^(['"])(.*)\1$/, '$2');
  }
  // The file fills only what the environment lacks, and a blank line in it fills nothing.
  return {
    [ENV.account]: fromEnv[ENV.account] || read[ENV.account] || undefined,
    [ENV.token]: fromEnv[ENV.token] || read[ENV.token] || undefined,
  };
}

const env = liveEnv();
const client = clientFromEnv(env);
const live = describe.skipIf(client === null);

const INLINE_SCRIPT_PAGE = readFileSync(
  new URL('../../../fixtures/v2/render/inline-script.html', import.meta.url),
  'utf8',
);
/** What the fixture's inline script writes, assembled the way the script assembles it. */
const INLINE_MARKER = ['inline', 'scriptran'].join('');

/**
 * A page served whole as HTML, with no script: its two sides should agree. (example.com was the first
 * choice; since it began loading /s.js, which writes the same paragraph in other languages, its two
 * sides differ by design.)
 */
const STATIC_PAGE = 'https://info.cern.ch/hypertext/WWW/TheProject.html';
/** A long page with scripts, for the spread between renders. */
const REPEAT_PAGE = 'https://developers.cloudflare.com/browser-run/';
/** DECISION-LOG I8: the spread is taken over five renders. */
const REPEAT_RENDERS = 5;

/**
 * A 429 is waited out here as the render step does: its Retry-After in seconds, or else
 * LIVE_RETRY_WAIT_MS, up to LIVE_TRIES tries. The account's request rate is not ours to set, and these
 * tests are about what a render returns, not how fast.
 */
const LIVE_TRIES = 8;
const LIVE_RETRY_WAIT_MS = 10_000;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const waits: number[] = [];

async function words(c: BrowserRunClient, url: string, side: RenderSide) {
  for (let attempt = 1; ; attempt += 1) {
    const r = await c.content(url, side);
    if (r.ok) return mainWords(r.html);
    if (r.reason !== 'rate_limited' || attempt >= LIVE_TRIES) {
      throw new Error(`${side} render of ${url} failed: ${r.reason}`);
    }
    const ms = r.retryAfterMs ?? LIVE_RETRY_WAIT_MS;
    waits.push(ms);
    await pause(ms);
  }
}

/**
 * Renders `html` with the request a page's `side` gets, and returns the HTML Browser Run holds. With
 * `rules: false` the refusal lists are sent empty, for a control render.
 */
async function renderHtml(
  html: string,
  side: RenderSide,
  rules = true,
  javaScriptOn = false,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const body: Record<string, unknown> = { ...renderRequestBody(STATIC_PAGE, side), html, ...extra };
  if (!rules) Object.assign(body, { rejectResourceTypes: [], rejectRequestPattern: [] });
  if (javaScriptOn) delete body.setJavaScriptEnabled;
  delete body.url;
  let res: Response;
  for (let attempt = 1; ; attempt += 1) {
    try {
      res = await fetch(
        BROWSER_RUN.endpoint.replace('{account_id}', encodeURIComponent(env[ENV.account]!.trim())),
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${env[ENV.token]!.trim()}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        },
      );
    } catch {
      // The error could carry the URL, which holds the account id.
      throw new Error('the request to Browser Run failed');
    }
    if (res.status !== 429 || attempt >= LIVE_TRIES) break;
    await res.body?.cancel().catch(() => {});
    const after = res.headers.get('retry-after')?.trim() ?? '';
    const ms = /^[0-9]+$/.test(after) ? Number(after) * 1000 : LIVE_RETRY_WAIT_MS;
    waits.push(ms);
    await pause(ms);
  }
  expect(res.status).toBe(200);
  expect(Number(res.headers.get(BROWSER_RUN.browser_ms_header))).toBeGreaterThan(0);
  return ((await res.json()) as { result: string }).result;
}

/**
 * A page that requests each URL and writes `name=loaded`, `name=blocked` or `name=timeout` into #out,
 * then adds #done once every attempt has reported. Its results arrive after the page has loaded, so the
 * render waits for #done (PROBE_WAIT).
 */
function probePage(attempts: Record<string, string>): string {
  const calls = Object.entries(attempts)
    .map(([name, url]) => `attempt(${JSON.stringify(name)}, ${JSON.stringify(url)});`)
    .join('\n');
  const total = Object.keys(attempts).length + 1;
  return `<html><body><main><p id="out">probe</p></main><script>
    const out = document.getElementById('out');
    const seen = new Set();
    const mark = (name, outcome) => {
      if (seen.has(name)) return;
      seen.add(name);
      out.append(' ' + name + '=' + outcome);
      if (seen.size === ${total}) document.body.append(Object.assign(document.createElement('i'), { id: 'done' }));
    };
    function attempt(name, url) {
      const stop = new AbortController();
      setTimeout(() => { stop.abort(); mark(name, 'timeout'); }, 8000);
      fetch(url, { mode: 'no-cors', cache: 'no-store', signal: stop.signal }).then(
        () => mark(name, 'loaded'),
        () => mark(name, 'blocked'),
      );
    }
    ${calls}
    try {
      const ws = new WebSocket('wss://ws.postman-echo.com/raw');
      ws.onopen = () => mark('websocket', 'loaded');
      ws.onerror = () => mark('websocket', 'blocked');
      setTimeout(() => mark('websocket', 'timeout'), 8000);
    } catch {
      mark('websocket', 'blocked');
    }
  </script></body></html>`;
}

/** Waits for the probe page's #done, past the load the render otherwise stops at. */
const PROBE_WAIT = { waitForSelector: { selector: '#done', timeout: 12_000 } };

const outOf = (html: string) => /<p id="out">([^<]*)/.exec(html)?.[1] ?? '';

live('Browser Run, live', () => {
  afterAll(() => {
    console.info(`429 waits taken: ${waits.length ? waits.join(', ') + ' ms' : 'none'}`);
  });

  it(`renders a static page to within ${PARITY_SPREAD * 100} % of its static side`, async () => {
    const raw = await words(client!, STATIC_PAGE, 'static');
    const rendered = await words(client!, STATIC_PAGE, 'rendered');
    console.info(
      `parity ${STATIC_PAGE}: static ${raw}, rendered ${rendered}, spread ${spread(raw, rendered)}`,
    );
    expect(raw).toBeGreaterThan(0);
    expect(within(raw, rendered, PARITY_SPREAD)).toBe(true);
  }, 600_000);

  it(`renders one page ${REPEAT_RENDERS} times to within ${REPEAT_SPREAD * 100} % of itself`, async () => {
    const counts: number[] = [];
    for (let i = 0; i < REPEAT_RENDERS; i += 1) {
      counts.push(await words(client!, REPEAT_PAGE, 'rendered'));
    }
    const [lo, hi] = [Math.min(...counts), Math.max(...counts)];
    console.info(`repeat ${REPEAT_PAGE}: ${counts.join(', ')}, spread ${spread(lo, hi)}`);
    expect(lo).toBeGreaterThan(0);
    expect(within(lo, hi, REPEAT_SPREAD)).toBe(true);
  }, 900_000);

  it('runs no script on the static side, inline or from a file, and runs both on the rendered side', async () => {
    // The static request turns JavaScript off and refuses script files; an inline script is not a
    // request, so only the first stops it. The marker is assembled at run time and is absent from the
    // fixture's text, so finding it means the script ran.
    expect(INLINE_SCRIPT_PAGE).not.toContain(INLINE_MARKER);
    const staticHtml = await renderHtml(INLINE_SCRIPT_PAGE, 'static');
    const renderedHtml = await renderHtml(INLINE_SCRIPT_PAGE, 'rendered');
    console.info(
      `inline-script probe: static "${outOf(staticHtml)}", rendered "${outOf(renderedHtml)}"`,
    );
    expect(staticHtml).not.toContain(INLINE_MARKER);
    expect(renderedHtml).toContain(INLINE_MARKER);
    expect(outOf(renderedHtml)).toContain('file=loaded');
  }, 600_000);

  it('refuses script files on the static side, seen with JavaScript left on so the page can report it', async () => {
    // JavaScript off hides whether the file loaded, so this render keeps the static side's resource
    // list and turns JavaScript back on: the inline script then reports the file.
    const staticOut = outOf(await renderHtml(INLINE_SCRIPT_PAGE, 'static', true, true));
    console.info(`script-file probe, static side with JavaScript on: "${staticOut}"`);
    expect(staticOut).toContain(INLINE_MARKER);
    expect(staticOut).toContain('file=blocked');
  }, 600_000);

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
    const open = outOf(await renderHtml(probePage(attempts), 'rendered', false, false, PROBE_WAIT));
    const ruled = outOf(await renderHtml(probePage(attempts), 'rendered', true, false, PROBE_WAIT));
    console.info(`policy probe, rules off: ${open}`);
    console.info(`policy probe, rules on: ${ruled}`);
    for (const name of [...Object.keys(attempts), 'websocket']) {
      expect(open).toContain(`${name}=loaded`);
    }
    for (const name of ['control_ip', 'control_download'])
      expect(ruled).toContain(`${name}=loaded`);
    for (const name of refused) expect(ruled).toContain(`${name}=blocked`);
  }, 600_000);
});
