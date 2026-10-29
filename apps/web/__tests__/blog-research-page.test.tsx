import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ResearchIndex, { metadata } from '../app/blog/research/page';
import { TAGS, getTag } from '../lib/blog/tags';
import { POSTS, postsWithTag } from '../lib/blog/posts';
import { parse, renderIndexHtml } from './helpers/blog-render';

// The research tag (C-01, owner ruling on D2): /blog/research is a static, indexable page with a
// self canonical, listed in the sitemap, that lists research-tagged posts. /blog itself does not
// filter and reads no query string (pinned in blog-existing-posts-unchanged.test.tsx). Tag links on
// cards point at the tag's page.

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/sitemap-reports', () => ({ fetchIndexableReportSlugs: () => Promise.resolve([]) }));

const NEW_POST = 'ai-crawler-access-test-2026';

describe('tags', () => {
  it('has one tag, research, whose page is /blog/research', () => {
    expect(TAGS).toEqual({
      research: { slug: 'research', label: 'Research', path: '/blog/research' },
    });
  });

  it('resolves only its own keys', () => {
    expect(getTag('research')?.label).toBe('Research');
    for (const k of ['__proto__', 'constructor', 'toString', 'Research', ''])
      expect(getTag(k), k).toBeNull();
  });

  it('every tag on a post is a known tag', () => {
    for (const p of POSTS)
      for (const t of p.tags ?? []) expect(getTag(t), `${p.slug}: ${t}`).not.toBeNull();
  });

  it('no post slug collides with a tag page under /blog/', () => {
    const tagSegments = Object.values(TAGS).map((t) => t.path.replace('/blog/', ''));
    expect(POSTS.filter((p) => tagSegments.includes(p.slug)).map((p) => p.slug)).toEqual([]);
  });

  it('the research post is tagged research and no other post is', () => {
    expect(postsWithTag('research').map((p) => p.slug)).toEqual([NEW_POST]);
  });
});

describe('/blog/research', () => {
  it('has the title Research and a self canonical, with no robots directive', () => {
    expect(metadata.title).toBe('Research');
    expect(metadata.alternates).toEqual({ canonical: '/blog/research' });
    expect(metadata.robots).toBeUndefined();
    expect(String(metadata.description).length).toBeGreaterThan(50);
  });

  it('renders one H1, Research, and lists the research-tagged posts newest first', () => {
    const doc = parse(renderToStaticMarkup(ResearchIndex()));
    const h1s = doc.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(h1s[0]!.textContent).toBe('Research');
    const listed = [...doc.querySelectorAll('main li')].map((li) =>
      li.querySelector('a')!.getAttribute('href'),
    );
    expect(listed).toEqual(postsWithTag('research').map((p) => `/blog/${p.slug}`));
  });

  it('does not link to itself from its own cards', () => {
    const doc = parse(renderToStaticMarkup(ResearchIndex()));
    expect(doc.querySelector('main a[href="/blog/research"]')).toBeNull();
  });

  it('is a static page: it reads no request data and declares no dynamic rendering', () => {
    const src = readFileSync(resolve(__dirname, '../app/blog/research/page.tsx'), 'utf8');
    for (const forbidden of [
      'searchParams',
      'headers(',
      'cookies(',
      'export const dynamic',
      'export const revalidate',
    ]) {
      expect(src, `app/blog/research/page.tsx must not contain ${forbidden}`).not.toContain(
        forbidden,
      );
    }
    expect(ResearchIndex.length).toBe(0);
  });

  it('is in the sitemap', async () => {
    const { default: sitemap } = await import('../app/sitemap');
    expect((await sitemap()).map((e) => e.url)).toContain('https://crawlmouse.com/blog/research');
  });
});

describe('tag links on /blog cards', () => {
  it('the research post card links to /blog/research, as a plain link outside the card link', () => {
    const doc = parse(renderIndexHtml());
    const card = [...doc.querySelectorAll('main li')].find(
      (li) => li.querySelector('a')?.getAttribute('href') === `/blog/${NEW_POST}`,
    )!;
    expect(card).toBeDefined();
    const tagLink = card.querySelector('a[href="/blog/research"]');
    expect(tagLink?.textContent).toBe('Research');
  });

  it.each([
    ['/blog', () => renderIndexHtml()],
    ['/blog/research', () => renderToStaticMarkup(ResearchIndex())],
  ])('%s never nests a link inside a link', (_route, render) => {
    // Checked on the raw markup: an HTML parser (jsdom or a browser) silently un-nests an <a>
    // inside an <a>, so a DOM query cannot see it, but React's hydration would.
    let depth = 0;
    let deepest = 0;
    for (const m of render().matchAll(/<a[\s>]|<\/a>/g)) {
      depth += m[0] === '</a>' ? -1 : 1;
      deepest = Math.max(deepest, depth);
    }
    expect(depth).toBe(0);
    expect(deepest).toBe(1);
  });

  it('no link anywhere on /blog uses a tag query string', () => {
    const html = renderIndexHtml();
    expect(html).not.toContain('?tag=');
  });
});
