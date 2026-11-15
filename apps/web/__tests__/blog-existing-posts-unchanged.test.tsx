import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import BlogIndex from '../app/blog/page';
import { POSTS_BY_SLUG, allPostSlugs } from '../lib/blog/posts';
import { RULED_CHANGES } from '../lib/blog/ruled-copy';
import { getAuthor, personLd } from '../lib/blog/authors';
import { addedQuestions, addedSummary, postAbstract } from '../lib/blog/answers';
import { POST_SOURCES } from '../lib/blog/post-source';
import {
  parse,
  renderIndexHtml,
  renderPostPage,
  snapshotIndex,
  snapshotPost,
  type IndexSnapshot,
  type PostSnapshot,
} from './helpers/blog-render';
import { bodyEdits, dropUpdatedDate, reverseEdits, stripAdditions } from './helpers/blog-additions';

// OPERATING-RULES §13: no indexed URL loses its title, description, H1 or canonical. The fixture is
// what main served at `capturedFrom`, before authors, tags and the research article existed. Every
// post in it must render the same today, and /blog must too once posts added since are set aside.
//
// The fixture and the comparison share one helper, so agreement alone proves nothing (§10). The
// first block pins the fixture itself against the post metadata, an independent source: a helper
// that captured empty strings would fail there instead of comparing empty to empty.
//
// CC-40 (D4, D5, D6; owner brief of 2026-11-15) adds to these pages. The comparison is therefore
// "baseline plus listed additions only": the additions are set aside by the containers they render
// in, each D5 sentence edit listed in lib/blog/v2-edits.ts is reversed, and what is left must equal
// the baseline byte for byte (helpers/blog-additions.ts says what each step removes). Title,
// description, canonical and H1 are compared exactly; the metadata's modifiedTime and the Article's
// dateModified follow `updatedAt`, and the Article gains an `abstract`; nothing else may differ.

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

/**
 * The baseline's metadata with ruling 3's recorded changes applied (lib/blog/ruled-copy.ts): a
 * `seoTitle` replaces the <title>, Open Graph and Twitter titles; a description replaces all three
 * descriptions. Each change's `before` must be what the baseline holds, so a stale record fails.
 */
function ruled(slug: string, metadata: Record<string, unknown>): Record<string, unknown> {
  const m = JSON.parse(JSON.stringify(metadata)) as {
    title: { absolute: string };
    description: string;
    openGraph: { title: string; description: string };
    twitter: { title: string; description: string };
  };
  for (const c of RULED_CHANGES.filter((x) => x.slug === slug)) {
    if (c.field === 'seoTitle') {
      expect(m.title.absolute, `${slug} seoTitle before`).toBe(c.before);
      m.title.absolute = m.openGraph.title = m.twitter.title = c.after;
    } else {
      expect(m.description, `${slug} description before`).toBe(c.before);
      m.description = m.openGraph.description = m.twitter.description = c.after;
    }
  }
  return m;
}

describe('the baseline fixture is what it claims to be', () => {
  it('was captured from main at 90ea7d9 and holds the 17 posts published then', () => {
    expect(fixture.capturedFrom).toBe('90ea7d9699f0469f6c95c86bb0f3f72b00e877c3');
    expect(BASELINE_SLUGS).toHaveLength(17);
  });

  it.each(BASELINE_SLUGS)('%s: fixture fields match the post metadata', (slug) => {
    const meta = POSTS_BY_SLUG.get(slug);
    expect(meta, `${slug} is still published`).toBeDefined();
    const s = fixture.posts[slug]!;
    // The fixture predates ruling 3: its title is the post's H1, and its description is the ruling's
    // `before` where the ruling changed it.
    expect(s.metadata.title).toEqual({ absolute: meta!.title });
    const ruledDescription = RULED_CHANGES.find(
      (c) => c.slug === slug && c.field === 'description',
    );
    expect(s.metadata.description).toBe(ruledDescription?.before ?? meta!.description);
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

describe('every existing post renders as it did at the baseline, plus the listed additions', () => {
  it('no baseline post was removed', () => {
    const live = new Set(allPostSlugs());
    expect(BASELINE_SLUGS.filter((s) => !live.has(s))).toEqual([]);
  });

  it.each(BASELINE_SLUGS)(
    '%s: metadata, H1 and canonical unchanged but for ruling 3; modifiedTime is updatedAt',
    async (slug) => {
      const now = await snapshotPost(slug);
      const then = fixture.posts[slug]!;
      expect(withoutModifiedTime(now.metadata)).toEqual(
        withoutModifiedTime(ruled(slug, then.metadata)),
      );
      expect((now.metadata.openGraph as { modifiedTime?: string }).modifiedTime).toBe(
        POSTS_BY_SLUG.get(slug)!.updatedAt,
      );
      // updatedAt moves only for a post whose body gained D4's summary or questions (D4; rulings 2
      // and 3 move no date): otherwise it is the baseline's.
      const gained = Boolean(addedSummary(slug)) || addedQuestions(slug).length > 0;
      const baseline = (then.metadata.openGraph as { modifiedTime?: string }).modifiedTime;
      if (!gained) expect(POSTS_BY_SLUG.get(slug)!.updatedAt, `${slug} updatedAt`).toBe(baseline);
      expect(now.h1).toBe(then.h1);
      expect(now.h1Count).toBe(then.h1Count);
    },
  );

  it.each(BASELINE_SLUGS)(
    '%s: article markup is the baseline once additions are set aside and listed edits reversed',
    async (slug) => {
      const then = parse(fixture.posts[slug]!.articleHtml).querySelector('article')!;
      dropUpdatedDate(then);
      for (const e of bodyEdits(slug)) {
        expect(
          then.outerHTML.split(e.html.before).length - 1,
          `${e.file}:${e.line} in the baseline`,
        ).toBe(1);
      }
      const { doc } = await renderPostPage(slug);
      const now = doc.querySelector('article')!;
      // Exactly the additions this post is listed for. The cluster links (D6) render after the
      // article, so none belongs inside it: one found here would be a container holding body text.
      const { 'nav[aria-label="More on this topic"]': clusters, ...mine } = stripAdditions(now);
      expect(mine).toEqual({
        'p.post-summary': addedSummary(slug) ? 1 : 0,
        'section.post-questions': addedQuestions(slug).length > 0 ? 1 : 0,
        // Ruling 2: each post names an author, so its byline and role are additions too.
        '.post-author-role': POSTS_BY_SLUG.get(slug)!.author ? 1 : 0,
        'span.post-byline': POSTS_BY_SLUG.get(slug)!.author ? 1 : 0,
        'sup.post-source': Object.values(POST_SOURCES).filter((x) => x.slug === slug).length,
      });
      expect(clusters).toBe(0);
      dropUpdatedDate(now);
      expect(reverseEdits(now.outerHTML, slug)).toBe(then.outerHTML);
    },
  );

  it.each(BASELINE_SLUGS)(
    '%s: the date line shows updatedAt when it differs from publishedAt',
    async (slug) => {
      const meta = POSTS_BY_SLUG.get(slug)!;
      const { doc } = await renderPostPage(slug);
      const times = [...doc.querySelectorAll('article header time')].map((t) =>
        t.getAttribute('datetime'),
      );
      expect(times).toEqual(
        meta.updatedAt === meta.publishedAt
          ? [meta.publishedAt]
          : [meta.publishedAt, meta.updatedAt],
      );
    },
  );

  it.each(BASELINE_SLUGS)(
    '%s: JSON-LD is the baseline outside the additions, but dateModified, an added abstract, the author and ruling 3',
    async (slug) => {
      const { doc } = await renderPostPage(slug);
      stripAdditions(doc);
      const now = jsonLdBlocks(doc);
      const ruledDescription = RULED_CHANGES.find(
        (c) => c.slug === slug && c.field === 'description',
      );
      const then = (JSON.parse(JSON.stringify(fixture.posts[slug]!.jsonLd)) as unknown[]).map(
        (b) => {
          for (const n of [b].flat() as Record<string, unknown>[]) {
            if (n['@type'] === 'Article' && ruledDescription) {
              expect(n.description).toBe(ruledDescription.before);
              n.description = ruledDescription.after;
            }
            // Ruling 2: a post that now names an author has that Person in place of the Organization.
            const author = getAuthor(POSTS_BY_SLUG.get(slug)!.author ?? '');
            if (n['@type'] === 'Article' && author) {
              expect(n.author).toEqual({ '@type': 'Organization', name: 'Crawlmouse' });
              n.author = personLd(author);
            }
          }
          return b;
        },
      );
      const article = (now.flat() as Record<string, unknown>[]).find(
        (n) => n['@type'] === 'Article',
      )!;
      expect(article.dateModified).toBe(POSTS_BY_SLUG.get(slug)!.updatedAt);
      expect(article.abstract).toBe(postAbstract(slug));
      expect(now.map(withoutArticleDates)).toEqual(then.map(withoutArticleDates));
    },
  );
});

function withoutModifiedTime(m: Record<string, unknown>): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(m)) as Record<string, unknown>;
  delete (copy.openGraph as Record<string, unknown> | undefined)?.modifiedTime;
  return copy;
}

function jsonLdBlocks(doc: Document): unknown[] {
  return [...doc.querySelectorAll('script[type="application/ld+json"]')].map(
    (s) => JSON.parse(s.textContent ?? 'null') as unknown,
  );
}

/** A JSON-LD block with its Article node's dateModified and abstract removed. */
function withoutArticleDates(block: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(block)) as unknown;
  for (const n of [copy].flat() as Record<string, unknown>[]) {
    if (n && n['@type'] === 'Article') {
      delete n.dateModified;
      delete n.abstract;
    }
  }
  return copy;
}

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

  it('keeps the served date line text nodes: two hydration markers per card, as at the base', () => {
    // renderToStaticMarkup merges adjacent text, so the fixture cannot see a split text node;
    // renderToString marks each boundary with <!-- -->, as the served page does. The base wrote
    // `</time> · {p.readingMinutes} min read`: markers before and after the number.
    const doc = parse(renderToString(BlogIndex()));
    const cards = [...doc.querySelectorAll('main li')];
    expect(cards.length).toBe(allPostSlugs().length);
    for (const li of cards) {
      const dateLine = li.querySelector('time')!.parentElement!;
      expect(dateLine.innerHTML.match(/<!-- -->/g) ?? []).toHaveLength(2);
    }
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
