import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { POSTS_BY_SLUG, allPostSlugs } from '../lib/blog/posts';
import {
  parse,
  renderIndexHtml,
  snapshotIndex,
  snapshotPost,
  type IndexSnapshot,
  type PostSnapshot,
} from './helpers/blog-render';

// OPERATING-RULES §13: no indexed URL loses its title, description, H1 or canonical. The fixture is
// what main served at `capturedFrom`, before authors, tags and the research article existed. Every
// post in it must render the same today, and /blog must too once posts added since are set aside.
//
// The fixture and the comparison share one helper, so agreement alone proves nothing (§10). The
// first block pins the fixture itself against the post metadata, an independent source: a helper
// that captured empty strings would fail there instead of comparing empty to empty.

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, '__fixtures__/blog-baseline.json'), 'utf8'),
) as { capturedFrom: string; posts: Record<string, PostSnapshot>; index: IndexSnapshot };

const BASELINE_SLUGS = Object.keys(fixture.posts);

interface ArticleNode {
  '@type'?: string;
  author?: { '@type'?: string; name?: string };
}
const articleNode = (s: PostSnapshot): ArticleNode | undefined =>
  (s.jsonLd.flat() as ArticleNode[]).find((n) => n['@type'] === 'Article');

describe('the baseline fixture is what it claims to be', () => {
  it('was captured from main at 90ea7d9 and holds the 17 posts published then', () => {
    expect(fixture.capturedFrom).toBe('90ea7d9699f0469f6c95c86bb0f3f72b00e877c3');
    expect(BASELINE_SLUGS).toHaveLength(17);
  });

  it.each(BASELINE_SLUGS)('%s: fixture fields match the post metadata', (slug) => {
    const meta = POSTS_BY_SLUG.get(slug);
    expect(meta, `${slug} is still published`).toBeDefined();
    const s = fixture.posts[slug]!;
    expect(s.metadata.title).toEqual({ absolute: meta!.title });
    expect(s.metadata.description).toBe(meta!.description);
    expect(s.metadata.alternates).toEqual({ canonical: `/blog/${slug}` });
    expect(s.h1).toBe(meta!.title);
    expect(s.h1Count).toBe(1);
    expect(s.articleHtml.length).toBeGreaterThan(1000);
    expect(articleNode(s)?.author).toEqual({ '@type': 'Organization', name: 'Crawlmouse' });
  });

  it('holds the /blog index with its canonical and every baseline post linked', () => {
    expect(fixture.index.metadata.alternates).toEqual({ canonical: '/blog' });
    const doc = parse(fixture.index.mainHtml);
    const linked = [...doc.querySelectorAll('li > a')].map((a) => a.getAttribute('href'));
    // The index is ordered newest first; this checks membership, the markup test below checks order.
    expect([...linked].sort()).toEqual(BASELINE_SLUGS.map((s) => `/blog/${s}`).sort());
  });
});

describe('every existing post renders as it did at the baseline', () => {
  it('no baseline post was removed', () => {
    const live = new Set(allPostSlugs());
    expect(BASELINE_SLUGS.filter((s) => !live.has(s))).toEqual([]);
  });

  it.each(BASELINE_SLUGS)(
    '%s: metadata, H1, article markup and JSON-LD unchanged',
    async (slug) => {
      const now = await snapshotPost(slug);
      const then = fixture.posts[slug]!;
      expect(now.metadata).toEqual(then.metadata);
      expect(now.h1).toBe(then.h1);
      expect(now.h1Count).toBe(then.h1Count);
      expect(now.articleHtml).toBe(then.articleHtml);
      expect(now.jsonLd).toEqual(then.jsonLd);
    },
  );
});

describe('/blog is unchanged apart from the cards of posts added since the baseline', () => {
  it('keeps its metadata', () => {
    expect(snapshotIndex().metadata).toEqual(fixture.index.metadata);
  });

  it('renders the baseline markup once newer cards are set aside', () => {
    const doc = parse(renderIndexHtml());
    const main = doc.querySelector('main')!;
    const baselineHrefs = new Set(BASELINE_SLUGS.map((s) => `/blog/${s}`));
    let removed = 0;
    for (const li of [...main.querySelectorAll('li')]) {
      const href = li.querySelector('a')?.getAttribute('href') ?? '';
      if (!baselineHrefs.has(href)) {
        li.remove();
        removed += 1;
      }
    }
    // Exactly the posts added since the baseline were set aside, no more.
    expect(removed).toBe(allPostSlugs().length - BASELINE_SLUGS.length);
    expect(main.outerHTML).toBe(fixture.index.mainHtml);
  });

  it('stays a static page: it reads no request data and declares no dynamic rendering', () => {
    const src = readFileSync(resolve(__dirname, '../app/blog/page.tsx'), 'utf8');
    for (const forbidden of [
      'searchParams',
      'headers(',
      'cookies(',
      'export const dynamic',
      'export const revalidate',
    ]) {
      expect(src, `app/blog/page.tsx must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });
});
