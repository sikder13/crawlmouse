/**
 * `/` under V2_CHECKS_PUBLIC (CC-22b D1, D10): the flag is read when the module is evaluated; off,
 * the page is v1's; on, it is the v2 home with the structured data its content supports. In both
 * the module exports nothing but the page, so the head is the root layout's.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/analytics/TrackView', () => ({
  TrackView: ({ event }: { event: string }) => <i data-event={event} />,
}));
// The v1 form reads the router, which only a running app provides.
vi.mock('next/navigation', async (original) => ({
  ...(await original<typeof import('next/navigation')>()),
  useRouter: () => ({ push() {}, refresh() {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/analytics/ReferralCapture', () => ({ ReferralCapture: () => null }));

async function home(flag: string | undefined) {
  vi.resetModules();
  if (flag === undefined) vi.stubEnv('V2_CHECKS_PUBLIC', '');
  else vi.stubEnv('V2_CHECKS_PUBLIC', flag);
  const page = await import('./page');
  return { page, markup: renderToStaticMarkup((await page.default()) as ReactElement) };
}
const ldTypes = (markup: string) =>
  [...markup.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].flatMap((m) =>
    ([] as { '@type': string }[]).concat(JSON.parse(m[1]!)).map((x) => x['@type']),
  );

afterEach(() => vi.unstubAllEnvs());

describe('/', () => {
  it('with the flag off is the v1 home: its heading, its form, its three structured-data blocks', async () => {
    const { page, markup } = await home(undefined);
    expect(Object.keys(page)).toEqual(['default']);
    expect(markup).toContain('Grade your site’s internal linking');
    expect(markup).toContain('data-event="landing-view"');
    expect(markup).not.toContain('home_viewed');
    expect(markup).not.toContain('data-v2-');
    expect(ldTypes(markup)).toEqual(['WebSite', 'SoftwareApplication', 'FAQPage']);
  }, 60_000);

  it.each(['0', 'true', 'yes'])(
    'a flag value of %s is off',
    async (value) => {
      expect((await home(value)).markup).toContain('data-event="landing-view"');
    },
    60_000,
  );

  it('with the flag on is the v2 home, whose forms start an audit', async () => {
    const { page, markup } = await home('1');
    expect(Object.keys(page)).toEqual(['default']);
    expect(markup).toContain('data-event="home_viewed"');
    expect(markup).not.toContain('landing-view');
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup.match(/Start the audit/g)!.length).toBeGreaterThanOrEqual(2);
    expect(markup.match(/data-v2-primary=""/g)).toHaveLength(1);
    // The FAQ block is dropped: the v2 home shows no questions and answers to mark up.
    expect(ldTypes(markup)).toEqual(['WebSite', 'SoftwareApplication']);
    expect(markup).not.toContain('Frequently asked questions');
    expect(markup).not.toContain('href="#"');
  }, 60_000);

  it('imports no v2 module statically, so the v1 home links no v2 stylesheet', () => {
    const source = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
    const imports = [...source.matchAll(/^import\s[^;]*?from\s+'([^']+)';/gms)].map((m) => m[1]!);
    expect(imports.length).toBeGreaterThan(5);
    expect(imports.filter((m) => /components\/v2|styles\/v2|lib\/v2/.test(m))).toEqual([]);
    expect(source).toContain("await import('@/components/v2/screens/home/LiveHome')");
  });
});
