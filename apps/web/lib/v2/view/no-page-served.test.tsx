/**
 * A check where pages answered and none was served (QA's gate on #110): the link map and the
 * overview say so, on real `buildCheck` output and the rendered screens.
 */
import { buildCheck } from '@crawlmouse/engine/v2/pipeline';
import type { CrawlPage } from '@crawlmouse/types/v2';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ResultScreen } from '../../../components/v2/screens/result/ResultScreen';
import { crawlRow, oneBatchBuild } from '../../../../../packages/engine/fixtures/v2/build/rows';
import { findCheck, type ViewDataset } from '../fixtures';
import { linkMapView } from './link-map';
import { resultView, type ResultView } from './result';
import { datasetOfBuilds } from './test-support/built-dataset';

vi.mock('next/navigation', () => ({
  usePathname: () => '/audit/x/overview',
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

const HOME = 'https://example.test';
const rows = (status: number, n = 3): CrawlPage[] =>
  Array.from({ length: n }, (_, i) =>
    crawlRow({
      url: i === 0 ? HOME : `${HOME}/p${i}`,
      outcome: 'fetched',
      status,
      ...(status === 403 ? { response: 'refused' as const } : {}),
    }),
  );

function built(pages: CrawlPage[]) {
  const input = oneBatchBuild(HOME, pages, []);
  const b = buildCheck(input);
  const d = structuredClone(datasetOfBuilds(input.site, [b])) as ViewDataset;
  return { d, id: b.check.id, check: findCheck(d, b.check.id) };
}
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('a check where no page was served', () => {
  const refused = () => built(rows(403));

  it.each(['hubs', 'all'] as const)('the %s link map draws nothing and says why', (scope) => {
    const c = refused();
    const map = linkMapView(c.d, c.id, { scope });
    expect(map.title).toBe('No page was served.');
    expect(map.caption).toBe('3 pages answered, none served, so there is no link map.');
    expect(map.caption).not.toContain('crawled');
    expect(map.nodes).toEqual([]);
    expect(map.filters).toEqual([]);
    expect(map.explore).toBeNull();
  });

  it('the overview does not offer to explore a map', () => {
    const c = refused();
    const view = resultView(c.d, c.id, { map: null }) as ResultView;
    expect(view.map.served).toBe(false);
    const page = text(renderToStaticMarkup(<ResultScreen data={view} />));
    expect(page).not.toContain('Explore the link map');
    expect(page).not.toContain('3 pages, 0 links');
    expect(page).toContain('No page was served, so there is no link map.');
  });
});

describe('a check that served a page', () => {
  it('keeps its link map and its door', () => {
    const c = built(rows(200, 1));
    const map = linkMapView(c.d, c.id, { scope: 'all' });
    expect(map.title).toBe('1 page, 0 links.');
    expect(map.caption).toContain('1 page crawled');
    expect(map.nodes.length).toBeGreaterThan(0);
    const view = resultView(c.d, c.id, { map: null }) as ResultView;
    expect(view.map.served).toBe(true);
    expect(text(renderToStaticMarkup(<ResultScreen data={view} />))).toContain(
      'Explore the link map',
    );
  });
});

describe('the "Readable without JavaScript" footer', () => {
  const door = (v: ResultView) => v.doors.find((x) => x.title === 'Readable without JavaScript')!;

  it('makes no promise about Pro on a section that was not measured', () => {
    const c = built(rows(200, 3));
    c.check.without_js = null;
    const view = resultView(c.d, c.id, { map: null }) as ResultView;
    expect(door(view).pill.label).toBe('not measured');
    expect(door(view).footer).toBe('not measured');
  });
});
