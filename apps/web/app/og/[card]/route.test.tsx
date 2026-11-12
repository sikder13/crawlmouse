/**
 * The v2 public pages' social card (SEO R2-N6), through its route: each card draws its page's title
 * and nothing else from the page, on the v2 tokens; it answers 404 while its page's flag is off, and
 * for any key that is not a card, a prototype key included. The PNG is satori's, so the element handed
 * to ImageResponse is what is asserted on, as the report card's test does.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/og', () => ({
  ImageResponse: class {
    status = 200;
    constructor(
      public element: ReactElement,
      public options: unknown,
    ) {}
  },
}));

// The card module as it is, with its response function watched: the route's own gate answers before it.
vi.mock('@/lib/v2/social-card', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/v2/social-card')>();
  return { ...real, socialCardResponse: vi.fn(real.socialCardResponse) };
});

const { GET } = await import('./route');
const { CARD_TOKENS, SOCIAL_CARDS, socialCardPath, socialCardResponse } =
  await import('@/lib/v2/social-card');
const { AGENCIES_COPY } = await import('@/lib/v2/copy/agencies');
const { CHECK_COPY } = await import('@/lib/v2/copy/check-pages');
const { DEVELOPERS_COPY } = await import('@/lib/v2/copy/developers');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(socialCardResponse).mockClear();
});

const get = (card: string) =>
  GET(new Request(`https://crawlmouse.com/og/${card}`), {
    params: Promise.resolve({ card }),
  }) as Promise<Response & { element?: ReactElement; options?: unknown }>;

const ALL_ON = () => {
  vi.stubEnv('V2_BILLING', '1');
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
};

describe('GET /og/<card>', () => {
  // Each card's title, independently of the registry: the page's own title source.
  const TITLES: [string, string, string][] = [
    ['pricing', 'Pricing', 'V2_BILLING'],
    ['developers', DEVELOPERS_COPY.title, 'V2_BILLING'],
    ['agencies', AGENCIES_COPY.title, 'V2_BILLING'],
    ['check-gptbot', CHECK_COPY.gptbot.title, 'V2_CHECKS_PUBLIC'],
    ['check-javascript', CHECK_COPY.javascript.title, 'V2_CHECKS_PUBLIC'],
    ['check-robots-ai', CHECK_COPY['robots-ai'].title, 'V2_CHECKS_PUBLIC'],
  ];

  it('has a card for each of those pages and no other', () => {
    expect(Object.keys(SOCIAL_CARDS).sort()).toEqual(TITLES.map(([k]) => k).sort());
  });

  it.each(TITLES)('%s: the page’s title, on the v2 tokens, 1200×630', async (card, title) => {
    ALL_ON();
    const res = await get(card);
    expect(res.status).toBe(200);
    expect(res.options).toEqual({
      width: 1200,
      height: 630,
      headers: { 'CDN-Cache-Control': 'public, max-age=86400' },
    });
    const markup = renderToStaticMarkup(res.element!).replace(/&#x27;/g, "'");
    expect(markup).toContain(`>${title}<`);
    expect(markup).toContain(`crawlmouse.com${SOCIAL_CARDS[card]!.path}`);
    expect(markup).not.toMatch(/internal.linking/i);
    for (const value of Object.values(CARD_TOKENS)) expect(markup).toContain(value);
  });

  it.each(TITLES)('%s: a 404 while its page’s flag is off', async (card, _title, flag) => {
    ALL_ON();
    vi.stubEnv(flag, '');
    const res = await get(card);
    expect(res.status).toBe(404);
    // Nothing tells the CDN to keep the 404, so the card is served once its flag is back on.
    expect(res.headers.get('cdn-cache-control')).toBeNull();
  });

  it('Next’s ImageResponse sends the CDN header beside its own Cache-Control', async () => {
    ALL_ON();
    const res = await get('pricing');
    const { ImageResponse } = await vi.importActual<typeof import('next/og')>('next/og');
    const real = new ImageResponse(
      res.element!,
      res.options as ConstructorParameters<typeof ImageResponse>[1],
    );
    await real.body?.cancel();
    expect(real.headers.get('cdn-cache-control')).toBe('public, max-age=86400');
    expect(real.headers.get('cache-control')).toBe(
      'public, immutable, no-transform, max-age=31536000',
    );
    expect(real.headers.get('content-type')).toBe('image/png');
  });

  it('with both flags off, a 404 for every card without asking the card table', async () => {
    vi.stubEnv('V2_BILLING', '');
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    for (const card of [...Object.keys(SOCIAL_CARDS), 'home']) {
      expect((await get(card)).status).toBe(404);
    }
    expect(socialCardResponse).not.toHaveBeenCalled();
    vi.stubEnv('V2_BILLING', '1');
    await get('pricing');
    expect(socialCardResponse).toHaveBeenCalledWith('pricing');
  });

  it.each(['', 'home', 'v2-pricing', 'check-other', '__proto__', 'constructor', 'toString'])(
    '%j: not a card, a 404',
    async (card) => {
      ALL_ON();
      expect((await get(card)).status).toBe(404);
      if (card !== '') expect(() => socialCardPath(card)).toThrow();
    },
  );

  it('draws with the values tokens.css declares for those tokens', () => {
    const css = readFileSync(join(__dirname, '../../../styles/v2/tokens.css'), 'utf8');
    const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
    for (const [name, value] of Object.entries(CARD_TOKENS)) {
      const declared = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6});`).exec(root)?.[1];
      expect(declared?.toLowerCase(), name).toBe(value);
    }
  });

  it('is served neither under a rewrite target nor under v1’s /pricing or /developers', () => {
    for (const card of Object.keys(SOCIAL_CARDS)) {
      const path = socialCardPath(card);
      expect(path).toMatch(/^\/og\//);
      expect(path).not.toMatch(/^\/(?:v2-|pricing\b|developers\b)/);
    }
  });
});
