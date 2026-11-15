/**
 * /guides renders its clusters as it did before CC-40 D6 moved them to `lib/blog/clusters.ts`: the
 * page's `<main>` is held to a file snapshot captured from the page before the move.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { CLUSTERS } from '@/lib/blog/clusters';
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

  // Captured before the move; updated once, deliberately, when each section gained its id.
  it('draws the same <main> as before the clusters moved', async () => {
    await expect(main()).toMatchFileSnapshot('./__snapshots__/guides-main.snap');
  });
});
