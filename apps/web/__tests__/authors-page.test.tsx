import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AuthorPage, {
  dynamicParams,
  generateMetadata,
  generateStaticParams,
} from '../app/authors/[slug]/page';
import { AUTHORS, personLd } from '../lib/blog/authors';
import { postsByAuthor } from '../lib/blog/posts';
import { parse } from './helpers/blog-render';

// /authors/[slug] (C-01, D4-A): an indexable page per author who has at least one post, with
// Person JSON-LD, listed in the sitemap. An author with no posts yet has no page, so no thin page
// is published; it appears once a post names them.

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/sitemap-reports', () => ({ fetchIndexableReportSlugs: () => Promise.resolve([]) }));

const props = (slug: string) => ({ params: Promise.resolve({ slug }) });

async function render(slug: string) {
  const html = renderToStaticMarkup(await AuthorPage(props(slug)));
  return parse(html);
}

describe('/authors/[slug]', () => {
  it('builds a page only for authors with a post, and 404s every other slug', () => {
    expect(generateStaticParams()).toEqual([{ slug: 'udaay-sikder' }]);
    expect(dynamicParams).toBe(false);
  });

  it('renders the author name as the one H1, the role, and the LinkedIn profile link', async () => {
    const doc = await render('udaay-sikder');
    const h1s = doc.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(h1s[0]!.textContent).toBe('Udaay Sikder');
    expect(doc.querySelector('main')!.textContent).toContain('Co-founder, Nahl Technologies');
    const li = doc.querySelector('a[href="https://www.linkedin.com/in/udaaysikder/"]');
    expect(li).not.toBeNull();
    expect(li!.getAttribute('rel')).toContain('me');
  });

  it("lists the author's posts, linked, newest first", async () => {
    const doc = await render('udaay-sikder');
    const expected = postsByAuthor('udaay-sikder').map((p) => `/blog/${p.slug}`);
    expect(expected.length).toBeGreaterThan(0);
    const listed = [...doc.querySelectorAll('main li')].map((li) =>
      li.querySelector('a')!.getAttribute('href'),
    );
    expect(listed).toEqual(expected);
  });

  it('emits Person JSON-LD with sameAs the LinkedIn URL', async () => {
    const doc = await render('udaay-sikder');
    const nodes = [...doc.querySelectorAll('script[type="application/ld+json"]')].flatMap(
      (s) => JSON.parse(s.textContent!) as unknown,
    ) as Array<Record<string, unknown>>;
    const person = nodes.find((n) => n['@type'] === 'Person');
    expect(person).toEqual({
      '@context': 'https://schema.org',
      ...personLd(AUTHORS['udaay-sikder']),
    });
  });

  it('is indexable with a self canonical and a bare title the root template brands', async () => {
    const meta = await generateMetadata(props('udaay-sikder'));
    expect(meta.title).toBe('Udaay Sikder');
    expect(meta.alternates).toEqual({ canonical: '/authors/udaay-sikder' });
    expect(meta.robots).toBeUndefined();
    expect(typeof meta.description).toBe('string');
    expect(String(meta.description)).toContain('Udaay Sikder');
  });

  it.each(['samia-zaman', 'nobody', '__proto__', 'constructor'])('404s %s', async (slug) => {
    await expect(AuthorPage(props(slug))).rejects.toThrow();
    expect(await generateMetadata(props(slug))).toEqual({});
  });
});

describe('the sitemap lists published author pages', () => {
  it('includes /authors/udaay-sikder and leaves out an author with no posts', async () => {
    const { default: sitemap } = await import('../app/sitemap');
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain('https://crawlmouse.com/authors/udaay-sikder');
    expect(urls).not.toContain('https://crawlmouse.com/authors/samia-zaman');
  });
});
