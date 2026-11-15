import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { pageFacts } from './page-facts';
import {
  headFromFacts,
  headFromMetadata,
  pageViolations,
  siteViolations,
  type PageHead,
  type RuleContext,
} from './page-rules';

const ORIGIN = 'https://crawlmouse.com';
const body = (html: string, path = '/blog/x') =>
  pageFacts(
    new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`).window.document,
    {
      url: `${ORIGIN}${path}`,
      status: 200,
      origins: [ORIGIN],
    },
  );

const DESC = 'A description long enough to sit inside the seventy to one hundred sixty band.';
const crumb = `<script type="application/ld+json">${JSON.stringify({
  '@type': 'BreadcrumbList',
  itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: `${ORIGIN}/` }],
})}</script>`;
const article = (extra: Record<string, unknown> = {}) =>
  `<script type="application/ld+json">${JSON.stringify({
    '@type': 'Article',
    headline: 'h',
    author: { '@type': 'Person', name: 'p' },
    datePublished: '2026-01-01',
    dateModified: '2026-01-02',
    image: `${ORIGIN}/i.png`,
    publisher: { '@type': 'Organization', name: 'o' },
    ...extra,
  })}</script>`;

/** A post that passes every rule; each case below breaks exactly one thing. */
const GOOD_BODY = `<main><h1>One</h1><h2>Two</h2><h3>Three</h3><a href="/blog">blog</a><img src="/a.png" alt="A"></main>${crumb}${article()}`;
const head = (over: Partial<PageHead> = {}): PageHead => ({
  title: 'A short title',
  descriptions: [DESC],
  canonicals: [`${ORIGIN}/blog/x`],
  robots: ['index, follow'],
  ...over,
});
const ctx = (over: Partial<RuleContext> = {}): RuleContext => ({
  origin: ORIGIN,
  live: new Set(['/blog', '/blog/x', '/guides']),
  earnsImpressions: () => false,
  canonicalTargets: {},
  ...over,
});
const rules = (h: PageHead, html: string, c: RuleContext = ctx(), path = '/blog/x') =>
  pageViolations({ path, head: h, body: body(html, path) }, c);
const failed = (r: ReturnType<typeof rules>) => r.violations.map((v) => v.rule);

describe('pageViolations', () => {
  it('passes a page that meets every rule', () => {
    expect(rules(head(), GOOD_BODY)).toEqual({ violations: [], reported: [] });
  });

  it('h1-count: fails on no H1 and on two', () => {
    expect(failed(rules(head(), GOOD_BODY.replace('<h1>One</h1>', '')))).toContain('h1-count');
    expect(
      failed(rules(head(), GOOD_BODY.replace('<h1>One</h1>', '<h1>a</h1><h1>b</h1>'))),
    ).toEqual(['h1-count']);
  });

  it('heading-skip: fails when a level is skipped', () => {
    expect(failed(rules(head(), GOOD_BODY.replace('<h3>Three</h3>', '<h4>Four</h4>')))).toEqual([
      'heading-skip',
    ]);
  });

  it('canonical-not-self: fails on another URL, on none and on two; passes a documented target', () => {
    expect(failed(rules(head({ canonicals: [`${ORIGIN}/blog/y`] }), GOOD_BODY))).toEqual([
      'canonical-not-self',
    ]);
    expect(failed(rules(head({ canonicals: [] }), GOOD_BODY))).toEqual(['canonical-not-self']);
    expect(
      failed(rules(head({ canonicals: [`${ORIGIN}/blog/x`, `${ORIGIN}/blog/x`] }), GOOD_BODY)),
    ).toEqual(['canonical-not-self']);
    expect(
      rules(
        head({ canonicals: [`${ORIGIN}/blog/y`] }),
        GOOD_BODY,
        ctx({ canonicalTargets: { '/blog/x': '/blog/y' } }),
      ).violations,
    ).toEqual([]);
  });

  it('canonical-not-self: the home is self with or without its trailing slash', () => {
    const home = (c: string) =>
      rules(
        head({ canonicals: [c] }),
        GOOD_BODY.replace(crumb, '').replace(article(), ''),
        ctx(),
        '/',
      );
    expect(home(ORIGIN).violations).toEqual([]);
    expect(home(`${ORIGIN}/`).violations).toEqual([]);
  });

  it('description: fails on none, on two, and outside 70–160 characters', () => {
    expect(failed(rules(head({ descriptions: [] }), GOOD_BODY))).toEqual(['description-missing']);
    expect(failed(rules(head({ descriptions: [DESC, DESC] }), GOOD_BODY))).toEqual([
      'description-multiple',
    ]);
    expect(failed(rules(head({ descriptions: ['x'.repeat(69)] }), GOOD_BODY))).toEqual([
      'description-length',
    ]);
    expect(failed(rules(head({ descriptions: ['x'.repeat(161)] }), GOOD_BODY))).toEqual([
      'description-length',
    ]);
    expect(rules(head({ descriptions: ['x'.repeat(70)] }), GOOD_BODY).violations).toEqual([]);
    expect(rules(head({ descriptions: ['x'.repeat(160)] }), GOOD_BODY).violations).toEqual([]);
  });

  it('title-length: fails over 60 characters, and only reports it on a page that earns impressions', () => {
    const long = head({ title: 'x'.repeat(61) });
    expect(failed(rules(long, GOOD_BODY))).toEqual(['title-length']);
    expect(rules(head({ title: 'x'.repeat(60) }), GOOD_BODY).violations).toEqual([]);
    const earning = rules(long, GOOD_BODY, ctx({ earnsImpressions: (p) => p === '/blog/x' }));
    expect(earning.violations).toEqual([]);
    expect(earning.reported.map((v) => v.rule)).toEqual(['title-length']);
  });

  it('title-missing: fails on a page with no title', () => {
    expect(failed(rules(head({ title: null }), GOOD_BODY))).toEqual(['title-missing']);
  });

  it('image-alt: fails on an <img> without alt; alt="" is decorative and passes', () => {
    expect(failed(rules(head(), GOOD_BODY.replace(' alt="A"', '')))).toEqual(['image-alt']);
    expect(rules(head(), GOOD_BODY.replace(' alt="A"', ' alt=""')).violations).toEqual([]);
  });

  it('noindex: fails on noindex or none in robots', () => {
    expect(failed(rules(head({ robots: ['noindex, follow'] }), GOOD_BODY))).toEqual(['noindex']);
    expect(failed(rules(head({ robots: ['none'] }), GOOD_BODY))).toEqual(['noindex']);
  });

  it('article-date-modified: fails on an Article without dateModified, once', () => {
    expect(
      failed(rules(head(), GOOD_BODY.replace(article(), article({ dateModified: undefined })))),
    ).toEqual(['article-date-modified']);
  });

  it('breadcrumb-missing: fails on a post, guides, research, author or help page without one', () => {
    for (const path of ['/blog/x', '/guides', '/blog/research', '/authors/a', '/help', '/help/q']) {
      const r = rules(
        head({ canonicals: [`${ORIGIN}${path}`] }),
        GOOD_BODY.replace(crumb, ''),
        ctx({ live: new Set(['/blog']) }),
        path,
      );
      expect(failed(r), path).toEqual(['breadcrumb-missing']);
    }
    const other = rules(
      head({ canonicals: [`${ORIGIN}/pricing`] }),
      GOOD_BODY.replace(crumb, ''),
      ctx(),
      '/pricing',
    );
    expect(other.violations).toEqual([]);
  });

  it('faq-not-visible: fails on a FAQPage question the page does not show', () => {
    const faq = (q: string) =>
      `<script type="application/ld+json">${JSON.stringify({
        '@type': 'FAQPage',
        mainEntity: [
          { '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: 'a' } },
        ],
      })}</script>`;
    expect(failed(rules(head(), `${GOOD_BODY}${faq('Is it hidden?')}`))).toEqual([
      'faq-not-visible',
    ]);
    expect(
      rules(
        head(),
        `${GOOD_BODY.replace('<h2>Two</h2>', '<h2>Is it shown?</h2>')}${faq('Is it shown?')}`,
      ).violations,
    ).toEqual([]);
  });

  it('jsonld-schema: fails on a block that is not JSON and on a node missing a required property', () => {
    expect(
      failed(rules(head(), `${GOOD_BODY}<script type="application/ld+json">{nope</script>`)),
    ).toEqual(['jsonld-schema']);
    expect(failed(rules(head(), GOOD_BODY.replace(article(), article({ headline: '' }))))).toEqual([
      'jsonld-schema',
    ]);
  });

  it('link-not-live: fails on an internal link outside the build’s live set, once per target', () => {
    const r = rules(
      head(),
      GOOD_BODY.replace(
        '</main>',
        '<a href="/check/gptbot">c</a><a href="/check/gptbot#x">c</a></main>',
      ),
    );
    expect(r.violations).toEqual([
      { path: '/blog/x', rule: 'link-not-live', detail: '/check/gptbot' },
    ]);
    expect(
      rules(head(), GOOD_BODY.replace('</main>', '<a href="https://example.com/x">out</a></main>'))
        .violations,
    ).toEqual([]);
  });
});

describe('siteViolations', () => {
  it('description-duplicate: fails on each page whose description another page has', () => {
    const pages = [
      { path: '/a', head: head({ descriptions: [DESC] }) },
      { path: '/b', head: head({ descriptions: [DESC] }) },
      { path: '/c', head: head({ descriptions: [`${DESC} c`] }) },
    ];
    expect(siteViolations(pages)).toEqual([
      { path: '/a', rule: 'description-duplicate', detail: 'also on /b' },
      { path: '/b', rule: 'description-duplicate', detail: 'also on /a' },
    ]);
  });
});

describe('headFromFacts', () => {
  it('reads the head a served page carries', () => {
    const doc = new JSDOM(
      `<html><head><title>T</title><meta name="description" content="D"><link rel="canonical" href="${ORIGIN}/x"><meta name="robots" content="noindex"></head><body></body></html>`,
    ).window.document;
    expect(
      headFromFacts(pageFacts(doc, { url: `${ORIGIN}/x`, status: 200, origins: [ORIGIN] })),
    ).toEqual({
      title: 'T',
      descriptions: ['D'],
      canonicals: [`${ORIGIN}/x`],
      robots: ['noindex'],
    });
  });
});

describe('headFromMetadata', () => {
  const layout = {
    title: { default: 'Root title', template: '%s · Crawlmouse' },
    description: 'Root description',
    alternates: { canonical: '/' },
    robots: { index: true, follow: true },
  };
  it('applies the layout template to a string title, not to an absolute one', () => {
    expect(headFromMetadata({ title: 'Pricing' }, layout, ORIGIN).title).toBe(
      'Pricing · Crawlmouse',
    );
    expect(headFromMetadata({ title: { absolute: 'Own' } }, layout, ORIGIN).title).toBe('Own');
  });
  it('takes each field the page does not set from the layout', () => {
    expect(headFromMetadata({}, layout, ORIGIN)).toEqual({
      title: 'Root title',
      descriptions: ['Root description'],
      canonicals: [`${ORIGIN}/`],
      robots: ['index, follow'],
    });
  });
  it('resolves the canonical against the origin and spells robots as the tag would', () => {
    const h = headFromMetadata(
      { alternates: { canonical: '/blog/x' }, robots: { index: false, follow: true } },
      layout,
      ORIGIN,
    );
    expect(h.canonicals).toEqual([`${ORIGIN}/blog/x`]);
    expect(h.robots).toEqual(['noindex, follow']);
    expect(headFromMetadata({ robots: 'noindex' }, layout, ORIGIN).robots).toEqual(['noindex']);
  });
});
