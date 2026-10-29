import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { POSTS, postsWithTag } from '../lib/blog/posts';
import { renderPostPage } from './helpers/blog-render';

// Owner ruling before merging C-01: every post that existed before it keeps exactly the internal
// links it had, in the same order, on the whole page (header, breadcrumbs, body, the call to action,
// "Keep reading" and footer). A research-tagged post never takes the "Keep reading" slots, which
// show the two newest posts. The fixture is every internal href (starting with "/") on each post
// page as main served it at `capturedFrom`, captured in a worktree of that commit with
// __tests__/helpers/blog-render.tsx.

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, '__fixtures__/blog-baseline-links.json'), 'utf8'),
) as { capturedFrom: string; posts: Record<string, string[]> };
const SLUGS = Object.keys(fixture.posts);

async function internalLinks(slug: string): Promise<string[]> {
  const { doc } = await renderPostPage(slug);
  return [...doc.querySelectorAll('a[href]')]
    .map((a) => a.getAttribute('href')!)
    .filter((h) => h.startsWith('/'));
}

/** How many links point at each target, summed over the given pages. */
function inbound(pages: Record<string, string[]>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const links of Object.values(pages)) for (const h of links) out[h] = (out[h] ?? 0) + 1;
  return out;
}

describe('the links fixture is what it claims to be', () => {
  it('was captured from main at 90ea7d9 and holds the 17 posts published then', () => {
    expect(fixture.capturedFrom).toBe('90ea7d9699f0469f6c95c86bb0f3f72b00e877c3');
    expect(SLUGS).toHaveLength(17);
  });

  it.each(SLUGS)('%s: holds the page chrome and two "Keep reading" posts', (slug) => {
    const links = fixture.posts[slug]!;
    expect(links).toContain('/');
    expect(links).toContain('/blog');
    const known = new Set(POSTS.map((p) => `/blog/${p.slug}`));
    const postLinks = links.filter((h) => known.has(h) && h !== `/blog/${slug}`);
    expect(postLinks.length).toBeGreaterThanOrEqual(2);
  });
});

describe('every existing post keeps exactly its internal links', () => {
  it.each(SLUGS)('%s: same internal links, same order', async (slug) => {
    expect(await internalLinks(slug)).toEqual(fixture.posts[slug]);
  });

  it('the inbound link count of every target, over the 17 pages, is unchanged', async () => {
    const now: Record<string, string[]> = {};
    for (const slug of SLUGS) now[slug] = await internalLinks(slug);
    expect(inbound(now)).toEqual(inbound(fixture.posts));
  });

  it('no existing post links to a research-tagged post', async () => {
    const research = postsWithTag('research').map((p) => `/blog/${p.slug}`);
    expect(research.length).toBeGreaterThan(0);
    for (const slug of SLUGS) {
      const links = await internalLinks(slug);
      expect(
        links.filter((h) => research.includes(h)),
        slug,
      ).toEqual([]);
    }
  });
});
