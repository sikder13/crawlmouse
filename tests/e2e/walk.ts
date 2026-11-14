import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Page } from './pw';

/**
 * What every journey uses: the stand-in's controls, a signed-in context, and a screenshot of each
 * step into the notes folder ($WALK_SHOTS), named `<journey>-<nn>-<step>.png`.
 */
export const STANDIN = process.env.STANDIN_URL ?? 'http://127.0.0.1:54438';
const SHOTS = process.env.WALK_SHOTS ?? '';
export const INBOX_DOMAIN = 'walk.example';
export const qa = (key: string) => `qa+${key}@${INBOX_DOMAIN}`;
/** CC-33's migration is the seed's precondition (scripts/qa, questions Q1). */
export const SEEDED = process.env.WALK_SEEDED === 'true';
export const NEEDS_SEED = 'the QA set is seeded once CC-33 (accounts.internal) is on the tree';

export async function control<T = unknown>(name: string, body: object = {}): Promise<T> {
  const r = await fetch(`${STANDIN}/__harness/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`control ${name}: ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

export const sql = <T = Record<string, unknown>>(query: string, params: unknown[] = []) =>
  control<T[]>('sql', { sql: query, params });

export async function events(
  name: string,
): Promise<{ name: string; data: Record<string, unknown> }[]> {
  const r = await fetch(`${STANDIN}/__harness/events?name=${encodeURIComponent(name)}`);
  return (await r.json()) as { name: string; data: Record<string, unknown> }[];
}

export async function signIn(context: BrowserContext, email: string): Promise<void> {
  const c = await control<{ name: string; value: string }>('session', { email });
  const base = new URL(process.env.WALK_BASE ?? 'http://localhost:3238');
  await context.addCookies([{ name: c.name, value: c.value, domain: base.hostname, path: '/' }]);
}

let step = 0;
export async function shot(page: Page, journey: string, name: string): Promise<void> {
  step += 1;
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({
    path: join(SHOTS, `${journey}-${String(step).padStart(2, '0')}-${name}.png`),
    fullPage: true,
  });
}

/**
 * Stripe's pages stay unvisited. A form POST the app answers with a 303 to Stripe (Checkout, the
 * billing portal) is answered here without following the redirect — Playwright's routes do not see
 * a request a redirect makes — and its `Location` is recorded; a navigation to a stripe.com host (a
 * JSON answer the page follows with `location.assign`) is fulfilled here. Returns where the app sent
 * the browser, newest last.
 */
export async function holdStripe(page: Page): Promise<string[]> {
  const sent: string[] = [];
  const page_ = (where: string) =>
    `<!doctype html><title>Stripe (walk)</title><h1>Stripe, not visited</h1><p>${where}</p>`;
  for (const path of ['**/api/billing/checkout', '**/api/billing/portal']) {
    await page.route(path, async (route) => {
      const response = await route.fetch({ maxRedirects: 0 });
      const location = response.headers()['location'];
      if (
        response.status() === 303 &&
        location &&
        /^https:\/\/[a-z.]*stripe\.com\//.test(location)
      ) {
        sent.push(location);
        await route.fulfill({ status: 200, contentType: 'text/html', body: page_(location) });
      } else {
        await route.fulfill({ response });
      }
    });
  }
  await page.route(/^https:\/\/([a-z-]+\.)*stripe\.com\//, async (route) => {
    sent.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: page_(route.request().url()),
    });
  });
  return sent;
}
