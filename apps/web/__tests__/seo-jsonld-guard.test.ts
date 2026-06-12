import { describe, it, expect } from 'vitest';
import {
  organizationLd,
  websiteLd,
  softwareApplicationLd,
  faqLd,
  articleLd,
  breadcrumbLd,
} from '../lib/seo/jsonld';
import { HOMEPAGE_FAQ } from '../lib/seo/faq';
import { POSTS } from '../lib/blog/posts';

describe('JSON-LD builders', () => {
  it('Organization / WebSite / SoftwareApplication are valid schema.org with no fabricated fields', () => {
    for (const ld of [organizationLd(), websiteLd(), softwareApplicationLd()] as Array<Record<string, unknown>>) {
      expect(ld['@context']).toBe('https://schema.org');
      expect(typeof ld['@type']).toBe('string');
      expect(String(ld.url)).toMatch(/^https:\/\/crawlmouse\.com/);
    }
    const app = softwareApplicationLd();
    expect(app.offers.price).toBe('0'); // honest free tier
    expect('aggregateRating' in app).toBe(false); // never fabricate ratings
  });

  it('FAQPage JSON-LD matches the visible homepage FAQ exactly (Google requirement)', () => {
    const ld = faqLd(HOMEPAGE_FAQ);
    expect(ld['@type']).toBe('FAQPage');
    expect(ld.mainEntity).toHaveLength(HOMEPAGE_FAQ.length);
    ld.mainEntity.forEach((q, i) => {
      expect(q.name).toBe(HOMEPAGE_FAQ[i]!.question);
      expect(q.acceptedAnswer.text).toBe(HOMEPAGE_FAQ[i]!.answer);
    });
  });

  it('Article JSON-LD carries the post metadata', () => {
    const post = POSTS[0]!;
    const ld = articleLd(post);
    expect(ld['@type']).toBe('Article');
    expect(ld.headline).toBe(post.title);
    expect(ld.datePublished).toBe(post.publishedAt);
    expect(ld.dateModified).toBe(post.updatedAt);
    expect(String(ld.url)).toBe(`https://crawlmouse.com/blog/${post.slug}`);
  });

  it('BreadcrumbList positions are 1..n', () => {
    const ld = breadcrumbLd([
      { name: 'Home', path: '/' },
      { name: 'Blog', path: '/blog' },
    ]);
    expect(ld.itemListElement.map((i) => i.position)).toEqual([1, 2]);
  });
});
