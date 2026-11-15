import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { schemaProblems } from './schema-required';
import { V2_HOME_DESCRIPTION, V2_HOME_TITLE, V2_LLMS_DESCRIPTOR } from './site-copy';
import { POSTS } from '../blog/posts';

// CC-40 D2, flags on. The prices below are written out as the brief states them (Pro $19/$190,
// Agency $99/$990), not read from prices.ts, so a change there that the structured data followed
// silently would fail here and be looked at.
vi.mock('../fonts', () => ({
  fraunces: { variable: '' },
  geist: { variable: '' },
  geistMono: { variable: '' },
}));

const fixture = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'flags-off-v1.json'), 'utf8'),
);
const ON = { V2_ACCOUNT_DOOR: '1', V2_PIPELINE: '1', V2_CHECKS_PUBLIC: '1', V2_BILLING: '1' };

describe('the owner strings', () => {
  it('the home title is at most 60 characters and the description 120–155', () => {
    expect(V2_HOME_TITLE.length).toBeLessThanOrEqual(60);
    expect(V2_HOME_DESCRIPTION.length).toBeGreaterThanOrEqual(120);
    expect(V2_HOME_DESCRIPTION.length).toBeLessThanOrEqual(155);
  });
  it('each keeps the brand the home earns its impressions on, and none promises the v1 grade', () => {
    for (const s of [V2_HOME_TITLE, V2_HOME_DESCRIPTION, V2_LLMS_DESCRIPTOR]) {
      expect(s).toContain('Crawlmouse');
      expect(s).not.toMatch(/A–F|internal-link(ing)? grade|one complete fix/i);
    }
  });
});

describe('flags on', () => {
  beforeEach(() => {
    vi.resetModules();
    for (const [k, v] of Object.entries(ON)) vi.stubEnv(k, v);
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('SoftwareApplication lists every plan at its real price, monthly and yearly, and no rating', async () => {
    const { softwareApplicationLd } = await import('./jsonld');
    const app = softwareApplicationLd();
    expect(app.description).toBe(V2_HOME_DESCRIPTION);
    expect(Array.isArray(app.offers)).toBe(true);
    const offers = app.offers as {
      name: string;
      price: string;
      priceSpecification?: { billingDuration: string };
    }[];
    expect(
      offers.map((o) => [o.name, o.price, o.priceSpecification?.billingDuration ?? null]),
    ).toEqual([
      ['Free', '0', null],
      ['Pro, monthly', '19', 'P1M'],
      ['Pro, yearly', '190', 'P1Y'],
      ['Agency, monthly', '99', 'P1M'],
      ['Agency, yearly', '990', 'P1Y'],
    ]);
    expect('aggregateRating' in app).toBe(false);
    expect(schemaProblems(app)).toEqual([]);
  });

  it('with V2_BILLING off, Agency, which is not on sale, is not offered', async () => {
    vi.stubEnv('V2_BILLING', '');
    const { softwareApplicationLd } = await import('./jsonld');
    const offers = softwareApplicationLd().offers as { name: string }[];
    expect(offers.map((o) => o.name)).toEqual(['Free', 'Pro, monthly', 'Pro, yearly']);
  });

  it('Organization names the parent company and its city, and no street address', async () => {
    const { organizationLd } = await import('./jsonld');
    const org = organizationLd() as Record<string, unknown>;
    expect(org).toMatchObject({
      '@type': 'Organization',
      name: 'Crawlmouse',
      url: 'https://crawlmouse.com',
      parentOrganization: {
        '@type': 'Organization',
        name: 'Nahl Technologies Inc',
        url: 'https://nahltech.com',
      },
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Indianapolis',
        addressRegion: 'IN',
        addressCountry: 'US',
      },
    });
    expect(JSON.stringify(org)).not.toMatch(/streetAddress|postalCode/);
    expect(org).not.toHaveProperty('sameAs');
    expect(schemaProblems(org)).toEqual([]);
  });

  it('/llms.txt: v2 descriptor, each key page with its own description, every post, no v1 promise', async () => {
    const { GET } = await import('../../app/llms.txt/route');
    const body = await GET().text();
    expect(body).toContain(`> ${V2_LLMS_DESCRIPTOR}\n`);
    expect(body).not.toMatch(/A–F|one complete fix|CLI, GitHub Action/);
    const { CHECK_COPY } = await import('../v2/copy/check-pages');
    for (const [path, description] of [
      ['/', V2_HOME_DESCRIPTION],
      ['/check/gptbot', CHECK_COPY.gptbot.description],
      ['/check/javascript', CHECK_COPY.javascript.description],
      ['/check/robots-ai', CHECK_COPY['robots-ai'].description],
    ] as const) {
      expect(body).toContain(`](https://crawlmouse.com${path}): ${description}\n`);
    }
    for (const path of [
      '/pricing',
      '/agencies',
      '/developers',
      '/help',
      '/blog',
      '/guides',
      '/bot',
      '/ai-readiness-checker',
    ]) {
      expect(body).toContain(`](https://crawlmouse.com${path}): `);
    }
    for (const p of POSTS)
      expect(body).toContain(`](https://crawlmouse.com/blog/${p.slug}): ${p.description}\n`);
  });

  it('the root share card says v2 and is not v1 image', async () => {
    const og = await import('../../app/opengraph-image');
    expect(og.alt).toBe(V2_HOME_TITLE);
    const png = Buffer.from(await og.default().arrayBuffer());
    expect(createHash('sha256').update(png).digest('hex')).not.toBe(fixture.ogImage.pngSha256);
  });

  it('the v2 home has its own title, description, canonical and share text', async () => {
    const { metadata } = await import('../../app/v2-home/page');
    expect(metadata).toMatchObject({
      title: { absolute: V2_HOME_TITLE },
      description: V2_HOME_DESCRIPTION,
      alternates: { canonical: '/' },
      openGraph: { url: '/', title: V2_HOME_TITLE, description: V2_HOME_DESCRIPTION },
      twitter: { title: V2_HOME_TITLE, description: V2_HOME_DESCRIPTION },
    });
  });
});
