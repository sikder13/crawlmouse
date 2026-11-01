import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect, type Response } from './pw';
import { PREVIEWS } from './pages';
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
      const rsc = await (await request.get(path, { headers: { RSC: '1' } })).text();
      expect(rsc.length, `${path}: the RSC payload was served`).toBeGreaterThan(100);
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
      const scripts: Promise<string>[] = [];
      const listen = (res: Response) => {
        if (res.request().resourceType() === 'script') scripts.push(res.text().catch(() => ''));
      };
      page.on('response', listen);
      await page.goto(route, { waitUntil: 'load' });
      await page.waitForLoadState('networkidle').catch(() => undefined);
      if (route === LARGE) {
        await expect(page.locator(`canvas[data-v2-renderer="${CANVAS_MARKER}"]`)).toHaveCount(1);
      }
      page.off('response', listen);
      const bodies = await Promise.all(scripts);
      expect(bodies.length, `${route}: scripts were loaded`).toBeGreaterThan(0);
      expect(
        bodies.some((b) => b.includes(CANVAS_MARKER)),
        `${route}: the canvas chunk ${route === LARGE ? 'must load' : 'must not load'}`,
      ).toBe(route === LARGE);
    }
  });
});
