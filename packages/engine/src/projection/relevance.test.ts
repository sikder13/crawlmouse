import { describe, it, expect } from 'vitest';
import { buildGraph } from '../graph.js';
import { hashUrl } from '../url-canonical.js';
import { buildCorpus } from './relevance.js';
import type { CrawledPage, CrawledLink } from '../crawler.js';

const HOME = 'https://ex.com';
function page(url: string, title?: string): CrawledPage {
  return { url, urlHash: hashUrl(url), title, statusCode: 200 };
}
function link(fromUrl: string, toUrl: string, anchorText: string): CrawledLink {
  return { fromUrl, toUrl, anchorText, isGenericAnchor: false };
}

describe('buildCorpus / relevance (§3 deterministic TF-IDF, no LLM, D3)', () => {
  const pages = [
    page(HOME, 'Home'),
    page(`${HOME}/seo-guide`, 'Internal Linking SEO Guide'),
    page(`${HOME}/seo-tips`, 'SEO Tips and Best Practices'),
    page(`${HOME}/cake`, 'Chocolate Cake Recipe'),
  ];
  const links = [
    link(HOME, `${HOME}/seo-guide`, 'internal linking seo guide'),
    link(HOME, `${HOME}/seo-tips`, 'seo tips'),
    link(HOME, `${HOME}/cake`, 'chocolate cake recipe'),
  ];
  const corpus = () => buildCorpus(buildGraph(pages, links));

  it('scores topically-related pages higher than unrelated ones', () => {
    const c = corpus();
    const related = c.relevance(`${HOME}/seo-guide`, `${HOME}/seo-tips`);
    const unrelated = c.relevance(`${HOME}/seo-guide`, `${HOME}/cake`);
    expect(related).toBeGreaterThan(unrelated);
    expect(unrelated).toBe(0); // no shared content tokens at all
  });

  it('returns a cosine score within [0,1] and is symmetric', () => {
    const c = corpus();
    const ab = c.relevance(`${HOME}/seo-guide`, `${HOME}/seo-tips`);
    const ba = c.relevance(`${HOME}/seo-tips`, `${HOME}/seo-guide`);
    expect(ab).toBeGreaterThanOrEqual(0);
    expect(ab).toBeLessThanOrEqual(1);
    expect(ab).toBe(ba);
  });

  it('is deterministic: identical graphs produce an identical (rounded) score', () => {
    expect(corpus().relevance(`${HOME}/seo-guide`, `${HOME}/seo-tips`)).toBe(
      corpus().relevance(`${HOME}/seo-guide`, `${HOME}/seo-tips`),
    );
  });

  it('drops stopwords so a common word shared by some pages cannot create false relevance', () => {
    // "the" is shared by /a and /b but not /c, so without stopword removal it would have idf>0 and
    // manufacture relevance. With removal, /a and /b share nothing.
    const p = [page(`${HOME}/a`, 'the cat'), page(`${HOME}/b`, 'the dog'), page(`${HOME}/c`, 'fish tank')];
    expect(buildCorpus(buildGraph(p, [])).relevance(`${HOME}/a`, `${HOME}/b`)).toBe(0);
  });

  it('falls back to URL-slug tokens when a title is thin/absent', () => {
    const p = [
      page(`${HOME}/internal-linking-basics`), // no title → slug tokens carry the topic
      page(`${HOME}/guide`, 'Internal Linking Basics Explained'),
      page(`${HOME}/unrelated`, 'Weather Forecast Today'),
    ];
    const c = buildCorpus(buildGraph(p, []));
    expect(c.relevance(`${HOME}/internal-linking-basics`, `${HOME}/guide`)).toBeGreaterThan(
      c.relevance(`${HOME}/internal-linking-basics`, `${HOME}/unrelated`),
    );
  });

  it('surfaces the shared high-signal topics for the action-packet "why", deterministically', () => {
    const c = corpus();
    const topics = c.sharedTopics(`${HOME}/seo-guide`, `${HOME}/seo-tips`, 3);
    expect(topics).toContain('seo');
    expect(topics.length).toBeLessThanOrEqual(3);
    expect(c.sharedTopics(`${HOME}/seo-guide`, `${HOME}/seo-tips`, 3)).toEqual(topics);
  });

  it('honors the extraTextFor seam (headings later): text present ONLY via the seam drives relevance', () => {
    const p = [page(`${HOME}/x`, 'Apple'), page(`${HOME}/y`, 'Banana'), page(`${HOME}/z`, 'Cherry')];
    const g = buildGraph(p, []);
    expect(buildCorpus(g).relevance(`${HOME}/x`, `${HOME}/y`)).toBe(0); // distinct titles, no overlap
    const seamed = buildCorpus(g, {
      extraTextFor: (u) => (u.endsWith('/x') || u.endsWith('/y') ? ['internal linking strategy'] : []),
    });
    expect(seamed.relevance(`${HOME}/x`, `${HOME}/y`)).toBeGreaterThan(0);
  });
});
