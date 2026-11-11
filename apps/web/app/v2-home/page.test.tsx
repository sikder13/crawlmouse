/**
 * The v2 home's route (CC-22b D10): a 404 when the flag is off, and with it on the Home screen
 * with the three structured-data blocks v1's home emits and no metadata of its own.
 */
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { V2_REWRITES } from '../../middleware';

vi.mock('@/components/analytics/TrackView', () => ({
  TrackView: ({ event }: { event: string }) => <i data-event={event} />,
}));
vi.mock('@/components/analytics/ReferralCapture', () => ({ ReferralCapture: () => null }));

const ldTypes = (markup: string) =>
  [...markup.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].flatMap((m) =>
    ([] as { '@type': string }[]).concat(JSON.parse(m[1]!)).map((x) => x['@type']),
  );

afterEach(() => vi.unstubAllEnvs());

describe('app/v2-home', () => {
  it('is the route the home row of the rewrite table names', () => {
    expect(V2_REWRITES.find((r) => r.from === '/')?.to).toBe('/v2-home');
  });

  it('with the flag off is a 404', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    const { default: Page } = await import('./page');
    let digest = 'returned';
    try {
      Page();
    } catch (error) {
      digest = String((error as { digest?: string }).digest);
    }
    expect(digest).toContain('404');
  }, 60_000);

  it('with the flag on is the v2 home with v1’s three structured-data blocks, and exports no metadata', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    const route = await import('./page');
    expect(Object.keys(route)).toEqual(['default']);
    const markup = renderToStaticMarkup(route.default() as ReactElement);
    expect(ldTypes(markup)).toEqual(['WebSite', 'SoftwareApplication', 'FAQPage']);
    expect(markup).toContain('data-event="home_viewed"');
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).not.toContain('href="#"');
  }, 60_000);
});
