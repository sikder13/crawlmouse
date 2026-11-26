import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { INITIAL_STATE, reduce } from '../../../../lib/v2/progress';
import { liveNotices } from '../../../../lib/v2/view/crawl';
import { LiveCrawl } from './LiveCrawl';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));

describe('LiveCrawl on the server', () => {
  it('renders the screen before any event, with no window and no stream', () => {
    expect(typeof window).toBe('undefined');
    const html = renderToStaticMarkup(
      <LiveCrawl checkId="0b0e7a52-5f0b-4b53-9c0e-0d4a3a1f2c11" host="shop.example" />,
    );
    expect(html).toContain('shop.example');
    expect(html).toContain('Starting');
    expect(html).toContain('Cancel this audit');
    expect(html).not.toContain('data-v2-verdicts');
  });

  it('lists the crawlers it is given, each not tested yet', () => {
    const html = renderToStaticMarkup(
      <LiveCrawl
        checkId="0b0e7a52-5f0b-4b53-9c0e-0d4a3a1f2c11"
        host="shop.example"
        crawlers={[{ ua: 'GPTBot', scored: true }]}
      />,
    );
    expect(html).toContain('data-v2-verdicts');
    expect(html).toContain('GPTBot');
    expect(html).toContain('not tested yet');
  });
});

describe('liveNotices', () => {
  const fine = { reachable: true, cancelFailed: false };
  const counted = (pages: number) =>
    reduce(INITIAL_STATE, { type: 'counts', at_ms: 1, pages_crawled: pages, links_found: 0 });

  it('says nothing while the map shows each page counted', () => {
    expect(liveNotices(INITIAL_STATE, fine)).toEqual([]);
  });

  it('counts what the map leaves out from the state, in the singular and the plural', () => {
    expect(liveNotices(counted(1), fine)).toEqual([
      'The map shows 0 of the 1 page fetched so far.',
    ]);
    expect(liveNotices(counted(1200), fine)).toEqual([
      'The map shows 0 of the 1,200 pages fetched so far.',
    ]);
  });

  // c/027 B: the sentence counts what the map draws, not every page the screen holds.
  const fetched = (paths: readonly string[], linked: (path: string) => string | null) => {
    const url = (p: string) => `https://shop.example${p}`;
    let state = INITIAL_STATE;
    for (const p of paths) {
      const from = linked(p);
      if (from !== null) {
        state = reduce(state, {
          type: 'page_linked',
          at_ms: 1,
          url: url(p),
          from: url(from),
          via: 'link',
        });
      }
      state = reduce(state, {
        type: 'page_fetched',
        at_ms: 1,
        url: url(p),
        identity: 'Crawlmouse',
        purpose: 'crawl',
        status: 200,
        ms: 10,
        links: 1,
      });
    }
    return reduce(state, {
      type: 'counts',
      at_ms: 1,
      pages_crawled: paths.length,
      links_found: paths.length,
    });
  };

  it('counts only the pages a link reaches, which are the ones the map draws', () => {
    // The home page and two pages no link has reached yet: held, not drawn.
    const state = fetched(['/', '/a', '/b'], () => null);
    expect(state.nodes).toHaveLength(3);
    expect(liveNotices(state, fine)).toEqual(['The map shows 1 of the 3 pages fetched so far.']);
  });

  it('counts at most the 500 pages the map draws', () => {
    const paths = ['/', ...Array.from({ length: 649 }, (_, i) => `/p${i}`)];
    const all = fetched(paths, (p) => (p === '/' ? null : '/'));
    expect(liveNotices(all, fine)).toEqual(['The map shows 500 of the 650 pages fetched so far.']);
    const few = fetched(paths.slice(0, 40), (p) => (p === '/' ? null : '/'));
    expect(liveNotices(few, fine)).toEqual([]);
  });

  it('says the stream is out of reach only while the check has not ended', () => {
    const lost = { reachable: false, cancelFailed: false };
    expect(liveNotices(INITIAL_STATE, lost)).toHaveLength(1);
    const ended = reduce(INITIAL_STATE, { type: 'ended', at_ms: 1, status: 'failed' });
    expect(liveNotices(ended, lost)).toEqual([]);
  });
});
