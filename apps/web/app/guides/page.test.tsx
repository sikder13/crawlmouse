/**
 * /guides renders its clusters as it did before CC-40 D6 moved them to `lib/blog/clusters.ts`: the
 * page's `<main>` is held to a file snapshot captured from the page before the move.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { CLUSTERS } from '@/lib/blog/clusters';
import { RULED_CHANGES } from '@/lib/blog/ruled-copy';
import GuidesPage from './page';

vi.mock('next/navigation', async (actual) => ({
  ...(await actual<typeof import('next/navigation')>()),
  usePathname: () => '/guides',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const main = () =>
  new JSDOM(renderToStaticMarkup(GuidesPage())).window.document.querySelector('main')!.outerHTML;

describe('/guides', () => {
  it('gives each cluster section the anchor its hub link names', () => {
    const doc = new JSDOM(renderToStaticMarkup(GuidesPage())).window.document;
    expect([...doc.querySelectorAll('main section')].map((s) => s.id)).toEqual(
      CLUSTERS.map((c) => c.id),
    );
  });

  // Captured before the move; updated once, deliberately, when each section gained its id. The page
  // lists each post's description, so ruling 3's are put back to what they replaced first.
  it('draws the same <main> as before the clusters moved, but for ruling 3', async () => {
    // JSDOM's serialiser escapes only &, < and > in text.
    const escape = (t: string) =>
      t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let html = main();
    const listed = new Set(CLUSTERS.flatMap((c) => c.slugs));
    for (const { slug, before, after } of RULED_CHANGES.filter((c) => c.field === 'description')) {
      expect(html.split(escape(after)).length - 1, slug).toBe(listed.has(slug) ? 1 : 0);
      html = html.replace(escape(after), escape(before));
    }
    await expect(html).toMatchFileSnapshot('./__snapshots__/guides-main.snap');
  });
});
