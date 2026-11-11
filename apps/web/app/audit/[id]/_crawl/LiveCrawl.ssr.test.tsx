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

  it('says the stream is out of reach only while the check has not ended', () => {
    const lost = { reachable: false, cancelFailed: false };
    expect(liveNotices(INITIAL_STATE, lost)).toHaveLength(1);
    const ended = reduce(INITIAL_STATE, { type: 'ended', at_ms: 1, status: 'failed' });
    expect(liveNotices(ended, lost)).toEqual([]);
  });
});
