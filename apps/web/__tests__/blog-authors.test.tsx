import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AUTHORS, authorPath, getAuthor, personLd, publishedAuthors } from '../lib/blog/authors';
import { POSTS, postsByAuthor, type BlogPostMeta } from '../lib/blog/posts';
import { ArticleLayout } from '../components/blog/ArticleLayout';
import { parse, renderPostPage } from './helpers/blog-render';

// Authors (C-01): exactly two people, a byline on a post that names one, and a Person node inside
// the post's existing Article JSON-LD. A post that names no author renders as it always has; the
// byte-level proof of that is blog-existing-posts-unchanged.test.tsx, and this file adds the
// direct assertions so the failure message names the cause.

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, '__fixtures__/blog-baseline.json'), 'utf8'),
) as {
  posts: Record<string, unknown>;
};
const BASELINE_SLUGS = Object.keys(fixture.posts);
const NEW_POST = 'ai-crawler-access-test-2026';

describe('the author map', () => {
  it('holds exactly the two named people, with the given roles and LinkedIn URLs', () => {
    expect(AUTHORS).toEqual({
      'udaay-sikder': {
        slug: 'udaay-sikder',
        name: 'Udaay Sikder',
        role: 'Co-founder, Nahl Technologies',
        linkedin: 'https://www.linkedin.com/in/udaaysikder/',
      },
      'samia-zaman': {
        slug: 'samia-zaman',
        name: 'Samia Zaman',
        role: 'Growth, Nahl Technologies',
        linkedin: 'https://www.linkedin.com/in/samiazaman/',
      },
    });
  });

  it('resolves only its own keys, never an inherited property', () => {
    expect(getAuthor('udaay-sikder')?.name).toBe('Udaay Sikder');
    for (const k of [
      '__proto__',
      'constructor',
      'toString',
      'hasOwnProperty',
      '',
      'UDAAY-SIKDER',
    ]) {
      expect(getAuthor(k), k).toBeNull();
    }
  });

  it('every post that names an author names one in the map', () => {
    for (const p of POSTS) {
      if (p.author !== undefined) expect(getAuthor(p.author), p.slug).not.toBeNull();
    }
  });

  it('no post published before this change has an author yet (the owner assigns them separately)', () => {
    const assigned = POSTS.filter((p) => BASELINE_SLUGS.includes(p.slug) && p.author !== undefined);
    expect(assigned.map((p) => p.slug)).toEqual([]);
  });

  it('builds a Person node with the author page URL and the LinkedIn URL as sameAs', () => {
    expect(personLd(AUTHORS['udaay-sikder'])).toEqual({
      '@type': 'Person',
      name: 'Udaay Sikder',
      url: 'https://crawlmouse.com/authors/udaay-sikder',
      sameAs: ['https://www.linkedin.com/in/udaaysikder/'],
      jobTitle: 'Co-founder, Nahl Technologies',
    });
    expect(authorPath('samia-zaman')).toBe('/authors/samia-zaman');
  });

  it('lists an author as published only once a post names them', () => {
    expect(publishedAuthors().map((a) => a.slug)).toEqual(['udaay-sikder']);
    const withSamia: BlogPostMeta[] = [
      ...POSTS,
      { ...POSTS[0]!, slug: 'x', author: 'samia-zaman' },
    ];
    expect(publishedAuthors(withSamia).map((a) => a.slug)).toEqual(['udaay-sikder', 'samia-zaman']);
    expect(publishedAuthors([]).map((a) => a.slug)).toEqual([]);
  });

  it('postsByAuthor returns the named author’s posts, newest first', () => {
    expect(postsByAuthor('udaay-sikder').map((p) => p.slug)).toEqual([NEW_POST]);
    expect(postsByAuthor('samia-zaman')).toEqual([]);
  });
});

describe('the research post carries a byline and a Person in its Article JSON-LD', () => {
  it('shows "By Udaay Sikder", linked to the author page, beside the date', async () => {
    const { doc } = await renderPostPage(NEW_POST);
    const header = doc.querySelector('article header')!;
    const link = header.querySelector('a[href="/authors/udaay-sikder"]');
    expect(link?.textContent).toBe('Udaay Sikder');
    expect(link?.getAttribute('rel')).toBe('author');
    expect(header.textContent).toContain('By Udaay Sikder');
    expect(header.querySelector('time')?.getAttribute('dateTime')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('puts the author as a Person inside the existing Article node, and adds no other block', async () => {
    const { doc } = await renderPostPage(NEW_POST);
    const blocks = [...doc.querySelectorAll('script[type="application/ld+json"]')].map(
      (s) => JSON.parse(s.textContent!) as unknown,
    );
    const nodes = blocks.flat() as Array<Record<string, unknown>>;
    const articles = nodes.filter((n) => n['@type'] === 'Article');
    expect(articles).toHaveLength(1);
    expect(nodes.filter((n) => n['@type'] === 'BlogPosting')).toHaveLength(0);
    expect(articles[0]!.author).toEqual(personLd(AUTHORS['udaay-sikder']));
    expect(articles[0]!.publisher).toMatchObject({ '@type': 'Organization', name: 'Crawlmouse' });
  });
});

describe('posts with no author are untouched', () => {
  it.each(BASELINE_SLUGS)('%s: no byline link and an Organization author', async (slug) => {
    const { doc } = await renderPostPage(slug);
    expect(doc.querySelector('article a[href^="/authors/"]')).toBeNull();
    expect(doc.querySelector('article header')?.textContent).not.toContain('By ');
    const nodes = [...doc.querySelectorAll('script[type="application/ld+json"]')].flatMap(
      (s) => JSON.parse(s.textContent!) as unknown,
    ) as Array<Record<string, unknown>>;
    expect(nodes.find((n) => n['@type'] === 'Article')?.author).toEqual({
      '@type': 'Organization',
      name: 'Crawlmouse',
    });
    expect(JSON.stringify(nodes)).not.toContain('"Person"');
  });

  it('ArticleLayout renders the same header with and without an unknown author key', () => {
    // A slug that is not in the map must not render a byline (it would link to a 404).
    const base = POSTS.find((p) => p.slug === BASELINE_SLUGS[0])!;
    const render = (meta: BlogPostMeta) =>
      renderToStaticMarkup(
        <ArticleLayout meta={meta} related={[]}>
          <p>body</p>
        </ArticleLayout>,
      );
    const unknown = { ...base, author: 'nobody' } as unknown as BlogPostMeta;
    expect(render(unknown)).toBe(render(base));
    expect(parse(render(unknown)).querySelector('a[href^="/authors/"]')).toBeNull();
  });
});
