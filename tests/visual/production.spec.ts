import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect, type Response } from './pw';
import { PREVIEWS, openPreview } from './pages';
import { CANVAS_MARKER } from '../../apps/web/components/v2/screens/map/canvas-marker';

/**
 * Checks that need the production build (`next build && next start`, VISUAL_SERVER=start), where
 * what is shipped to the browser is what a reader would get:
 *
 * - The Pro wall: a locked fix's packet is in neither the HTML nor the serialized props. The
 *   response body holds both (the flight data rides in the HTML), and the RSC payload is fetched
 *   on its own as well. A control finds the open fix's packet in its own page, so the check cannot
 *   pass by finding nothing.
 * - The canvas renderer's chunk loads on the 2,000-node explorer and on no other preview: every
 *   script each preview loads is searched for the marker only that chunk holds (canvas-marker.ts).
 */

const LOCKED = '/v2-preview/screens/fix/locked';
const OPEN = '/v2-preview/screens/fix';
const LARGE = '/v2-preview/screens/map/large';

interface Packet {
  context: string[];
  change: string[];
  keep: string[];
  verify: { command: string; expect: string };
}
const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../apps/web/lib/fixtures/v2/bad-site.json', import.meta.url)),
    'utf8',
  ),
) as { fixes: { title: string; packet: Packet | null }[] };

/** The packet's lines of the fix whose title the page heads with, as React escapes them in HTML. */
function packetOf(title: string): string[] {
  const fix = FIXTURE.fixes.find((f) => `${f.title}.` === title || f.title === title);
  if (!fix?.packet) throw new Error(`No fix with a packet is titled "${title}"`);
  const p = fix.packet;
  return [...p.context, ...p.change, ...p.keep, p.verify.command, p.verify.expect];
}

const escaped = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The line's longest run of plain characters, which reads the same however it is escaped. */
const plainRun = (line: string) =>
  (line.match(/[A-Za-z0-9 ,.;:()-]{24,}/g) ?? []).sort((a, b) => b.length - a.length)[0];

/** Whether `body` holds `line` in any form a page or its props would carry it in. */
const holds = (body: string, line: string) =>
  [line, escaped(line), JSON.stringify(line).slice(1, -1), plainRun(line)]
    .filter((form): form is string => Boolean(form))
    .some((form) => body.includes(form));

test.describe('on the production build', () => {
  test('a locked fix’s packet is in neither its HTML nor its props, while an open one’s is', async ({
    page,
    request,
  }) => {
    for (const [path, locked] of [
      [OPEN, false],
      [LOCKED, true],
    ] as const) {
      await page.goto(path);
      const title = (await page.locator('h1').textContent())!.trim();
      const lines = packetOf(title);
      const html = await (await request.get(path)).text();
      const flight = await request.get(path, { headers: { RSC: '1' } });
      expect(
        flight.headers()['content-type'] ?? '',
        `${path}: the RSC payload was served`,
      ).toContain('text/x-component');
      const rsc = await flight.text();
      for (const line of lines) {
        expect(holds(html, line), `${path} HTML: ${line}`).toBe(!locked);
        if (locked) expect(holds(rsc, line), `${path} RSC payload: ${line}`).toBe(false);
      }
    }
  });

  test('the canvas chunk loads on the 2,000-node explorer and on no other preview', async ({
    page,
  }) => {
    test.setTimeout(600_000);
    const routes = [...new Set(PREVIEWS.map((p) => p.path.split('?')[0]!))];
    expect(routes).toContain(LARGE);
    for (const route of routes) {
      // A script whose body cannot be read is a failure, not "no marker".
      const scripts: Promise<string | null>[] = [];
      const listen = (res: Response) => {
        if (res.request().resourceType() === 'script') scripts.push(res.text().catch(() => null));
      };
      page.on('response', listen);
      await page.goto(route, { waitUntil: 'load' });
      await page.waitForLoadState('networkidle').catch(() => undefined);
      if (route === LARGE) {
        await expect(page.locator(`canvas[data-v2-renderer="${CANVAS_MARKER}"]`)).toHaveCount(1);
      }
      page.off('response', listen);
      const read = await Promise.all(scripts);
      expect(read.length, `${route}: scripts were loaded`).toBeGreaterThan(0);
      expect(read.filter((b) => !b).length, `${route}: scripts whose body could not be read`).toBe(
        0,
      );
      const bodies = read as string[];
      expect(
        bodies.some((b) => b.includes(CANVAS_MARKER)),
        `${route}: the canvas chunk ${route === LARGE ? 'must load' : 'must not load'}`,
      ).toBe(route === LARGE);
    }
  });
});

/**
 * The account frame as built. Under `next dev` the stylesheets load in the order each page imports
 * them; the production build orders them its own way, and there PageShell's `.shell` (a column)
 * once came after AccountShell's `.frame` (a row) at equal weight and won: the rail became a band
 * across the top of every account screen, and a record table that should scroll inside its region
 * widened the page instead. So the frame is checked here, on the build, for each account preview
 * in the registry.
 */
const ACCOUNT_SCREEN =
  /\/screens\/(dashboard|site|alerts|reports|settings|trial-end|changes-log)(\/|\?|$)/;
/**
 * A sign-in the viewer cannot place on one account (none, or several with no default) has no
 * account to show a rail for, so its screen has none and is left out of the frame check by name.
 * Its brand header is checked with every other page in a11y.spec.ts.
 */
const NO_ACCOUNT = new Set([
  '/v2-preview/screens/dashboard/no-account',
  '/v2-preview/screens/dashboard/ambiguous',
]);
const ACCOUNT_PREVIEWS = PREVIEWS.filter(
  (p) => ACCOUNT_SCREEN.test(p.path) && !NO_ACCOUNT.has(p.path),
);

test.describe('the account frame on the production build', () => {
  test('finds the account previews it checks', () => {
    expect(ACCOUNT_PREVIEWS.length).toBeGreaterThan(0);
  });

  for (const p of ACCOUNT_PREVIEWS) {
    test(`${p.path}: at 1280px the rail is the left column, beside the page`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await openPreview(page, p.path);
      const box = await page.evaluate(() => {
        const rail = document.querySelector<HTMLElement>('[data-v2-account-shell] > header');
        const main = document.querySelector('#account-main');
        if (!rail || !main) return null;
        const r = rail.getBoundingClientRect();
        const m = main.getBoundingClientRect();
        // The rail's flex basis is 200px and its min-width is auto, as on Final-Dashboard: content
        // wider than the basis widens it (the locked HTML's own rail draws at 239px). Its widest
        // child at min-content, plus the rail's padding, is that floor.
        const pad =
          parseFloat(getComputedStyle(rail).paddingLeft) +
          parseFloat(getComputedStyle(rail).paddingRight);
        const floor = Math.max(
          ...[...rail.children].map((c) => {
            const el = c as HTMLElement;
            const was = el.style.width;
            el.style.width = 'min-content';
            const w = el.getBoundingClientRect().width;
            el.style.width = was;
            return w;
          }),
        );
        return {
          railX: r.left,
          railWidth: r.width,
          expected: Math.max(200, floor + pad),
          mainX: m.left,
          mainTop: m.top,
          railTop: r.top,
        };
      });
      expect(box, 'the account shell renders a rail and a main').not.toBeNull();
      expect(box!.railX).toBe(0);
      expect(Math.abs(box!.railWidth - box!.expected)).toBeLessThanOrEqual(1);
      expect(Math.abs(box!.mainX - box!.railWidth)).toBeLessThanOrEqual(1);
      expect(box!.mainTop).toBe(box!.railTop);
    });

    // On a phone the rail wraps onto its own line above the page. It is as tall as what it holds,
    // and the page starts under it: a rail line stretched to share the frame's 100vh left a blank
    // band under the rail on a short page (CC-26b).
    test(`${p.path}: at 390px the rail is as tall as its content, and the page starts under it`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openPreview(page, p.path);
      const box = await page.evaluate(() => {
        const rail = document.querySelector<HTMLElement>('[data-v2-account-shell] > header');
        const main = document.querySelector('#account-main');
        if (!rail || !main || rail.lastElementChild === null) return null;
        const r = rail.getBoundingClientRect();
        const last = rail.lastElementChild.getBoundingClientRect();
        return {
          railBottom: r.bottom,
          contentBottom: last.bottom + parseFloat(getComputedStyle(rail).paddingBottom),
          mainTop: main.getBoundingClientRect().top,
        };
      });
      expect(box, 'the account shell renders a rail and a main').not.toBeNull();
      expect(Math.abs(box!.railBottom - box!.contentBottom)).toBeLessThanOrEqual(1);
      expect(Math.abs(box!.mainTop - box!.railBottom)).toBeLessThanOrEqual(1);
    });

    test(`${p.path}: at 390px the page does not scroll sideways`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openPreview(page, p.path);
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(width).toBeLessThanOrEqual(390);
    });
  }
});
