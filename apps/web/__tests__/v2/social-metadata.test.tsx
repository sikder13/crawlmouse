/**
 * Each public page CC-29 adds sets its own social metadata (CC-29 review r1, SEO N5): `openGraph` with
 * its own url, title and description, and `twitter` with its own title and description. Next replaces a
 * parent's `openGraph` and `twitter` objects whole rather than merging them, so a page that sets
 * neither unfurls as the root layout's (the home's url and v1's "internal-linking grader" text), and a
 * page that sets them must also name the card and image it keeps. A v2 report takes its words from the
 * snapshot: the host and the headline. The values are read from each route's own metadata export.
 */
import type { Metadata } from 'next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicReportRow } from '@/lib/reports';
import { CHECK_COPY, CHECK_QUESTIONS } from '../../lib/v2/copy/check-pages';
import { helpArticles } from '../../lib/v2/help/articles';
import { HELP_COPY } from '../../lib/v2/help/copy';
import { PRICING_COPY } from '../../lib/v2/copy/pricing';
import { SOCIAL_CARDS, socialCardPath } from '../../lib/v2/social-card';
import { fixture } from '../../lib/v2/fixtures';
import { buildPublicSnapshot } from '../../lib/v2/reports/build-snapshot';
import { agenciesView } from '../../lib/v2/view/agencies';
import { developersView } from '../../lib/v2/view/developers';
import { FIRST_AUDIT } from '../../lib/v2/view/segment/test-helpers';

const store = vi.hoisted(() => ({ row: null as unknown }));
vi.mock('@/lib/reports', () => ({ getPublicReport: async () => store.row }));
vi.mock('server-only', () => ({}));

afterEach(() => {
  vi.unstubAllEnvs();
  store.row = null;
});

const SUFFIX = ' · Crawlmouse';

/** The page's own words, as each social object carries them, and its card when it names one. */
function expectOwn(
  meta: Metadata,
  own: { url: string; title: string; description: string; card?: string },
) {
  const og = meta.openGraph as Record<string, unknown> | undefined;
  const tw = meta.twitter as Record<string, unknown> | undefined;
  expect(og?.url).toBe(own.url);
  expect(og?.title).toBe(own.title);
  expect(og?.description).toBe(own.description);
  expect(og?.type).toBe('website');
  expect(og?.siteName).toBe('Crawlmouse');
  expect(og?.images).toBeDefined();
  expect(tw?.card).toBe('summary_large_image');
  expect(tw?.title).toBe(own.title);
  expect(tw?.description).toBe(own.description);
  // The canonical and the shared url are the same address.
  expect(meta.alternates?.canonical).toBe(own.url);
  // SEO R2-N6: a v2 page's own card, not the root's v1 card, and not an address under a rewrite
  // target, which answers 404 by its own address.
  if (own.card !== undefined) {
    const images = og?.images as { url: string }[];
    expect(images).toEqual([{ url: socialCardPath(own.card) }]);
    expect(images[0]!.url).not.toMatch(/^\/(?:opengraph-image|v2-)/);
    expect(SOCIAL_CARDS[own.card]!.path).toBe(own.url);
    // The card draws the page's title, without the site name the template adds.
    expect(own.title).toBe(SOCIAL_CARDS[own.card]!.title + SUFFIX);
  }
}

describe('social metadata of the CC-29 public pages', () => {
  it('/agencies', async () => {
    const { metadata } = await import('../../app/agencies/page');
    const v = agenciesView();
    expectOwn(metadata, {
      url: '/agencies',
      title: v.title + SUFFIX,
      description: v.description,
      card: 'agencies',
    });
  });

  it('/pricing (v2)', async () => {
    const { metadata } = await import('../../app/v2-pricing/page');
    expect(metadata.title).toBe('Pricing');
    expectOwn(metadata, {
      url: '/pricing',
      title: 'Pricing' + SUFFIX,
      description: PRICING_COPY.description(),
      card: 'pricing',
    });
  });

  it('/developers (v2)', async () => {
    const { metadata } = await import('../../app/v2-developers/page');
    const v = developersView();
    expectOwn(metadata, {
      url: '/developers',
      title: v.title + SUFFIX,
      description: v.description,
      card: 'developers',
    });
  });

  it.each(CHECK_QUESTIONS)('/check/%s', async (question) => {
    const { generateMetadata } = await import('../../app/check/[question]/page');
    const meta = await generateMetadata({ params: Promise.resolve({ question }) });
    const copy = CHECK_COPY[question];
    expectOwn(meta, {
      url: `/check/${question}`,
      title: copy.title + SUFFIX,
      description: copy.description,
      card: `check-${question}`,
    });
  });

  // CC-33 D4: the help centre's index and its twelve articles.
  it('/help', async () => {
    const { metadata } = await import('../../app/help/page');
    expectOwn(metadata, {
      url: '/help',
      title: HELP_COPY.title + SUFFIX,
      description: HELP_COPY.description,
      card: 'help',
    });
  });

  it.each(helpArticles().map((a) => [a.slug, a] as const))('/help/%s', async (slug, a) => {
    const { generateMetadata } = await import('../../app/help/[slug]/page');
    const meta = await generateMetadata({ params: Promise.resolve({ slug }) });
    expectOwn(meta, {
      url: `/help/${slug}`,
      title: a.question + SUFFIX,
      description: a.description,
      card: `help-${slug}`,
    });
  });

  it('/r/<slug> holding a v2 snapshot: the host and the headline, and the report’s own card', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    const snapshot = buildPublicSnapshot(
      fixture('bad-site'),
      FIRST_AUDIT['bad-site'],
      '2026-11-12T18:00:00.000Z',
    );
    store.row = {
      domain: 'example-outfitter.com',
      grade: null,
      score: null,
      cms_detected: null,
      orphan_count: null,
      avg_depth: null,
      takedown_requested_at: null,
      created_at: '2026-11-12T18:00:00.000Z',
      claimed_at: null,
      listed: false,
      indexable: false,
      hidden_at: null,
      white_label: null,
      report_snapshot: snapshot as unknown as PublicReportRow['report_snapshot'],
    } satisfies PublicReportRow;
    const { generateMetadata } = await import('../../app/v2-report/[slug]/page');
    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'abc123' }) });
    const title = `${snapshot.host} audit — shared by Crawlmouse`;
    expect(meta.description).toBe(snapshot.headline);
    expectOwn(meta, { url: '/r/abc123', title, description: snapshot.headline });
    expect((meta.openGraph as { images: unknown }).images).toEqual([
      { url: '/r/abc123/opengraph-image' },
    ]);
    expect(JSON.stringify(meta)).not.toMatch(/internal.linking/i);
  });
});

// SEO R2-N6: with the flags off, `/pricing` and `/developers` are v1's pages, whose metadata the v2
// cards leave as it was: no social object of their own, so the root's card.
describe('v1 Pricing and Developers keep their metadata', () => {
  it.each([
    ['/pricing', () => import('../../app/pricing/page')],
    ['/developers', () => import('../../app/developers/page')],
  ] as const)('%s', async (_path, load) => {
    const { metadata } = (await load()) as { metadata: Metadata };
    expect(metadata.openGraph).toBeUndefined();
    expect(metadata.twitter).toBeUndefined();
    expect(JSON.stringify(metadata)).not.toMatch(/\/og\//);
  });
});
