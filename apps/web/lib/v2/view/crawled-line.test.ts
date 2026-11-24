import type { FixtureDataset } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures';
import { auditDoc } from '../reports/generate-doc';
import { seoShortSummary, seoSummary } from '../sentences';
import { GONE_STATUSES } from '../../../../../packages/engine/src/v2/detectors/thresholds';
import { NOT_FOUND_STATUSES, resultView } from './result';

/**
 * The coverage line counts pages, not addresses (QA F-244): a site of 21 pages that links to two
 * missing ones was "All 23 pages crawled". Built from the real fixtures, with chosen rows answering
 * 404, 410 or 500, so `coverage` is the fixture's own and only the statuses vary.
 */
const CLEAN = fixture('clean-site');
const CLEAN_CHECK = 'c0000000-0000-4000-8000-000000000065';
const CHALLENGED = fixture('challenged-site');
const CHALLENGED_RECHECK = 'c0000000-0000-4000-8000-0000000000ca';

/** `d` with the first `statuses.length` of `checkId`'s served pages answering those statuses. */
function answering(d: FixtureDataset, checkId: string, statuses: number[]): FixtureDataset {
  let next = 0;
  const page_results = d.page_results.map((p) =>
    p.check_id === checkId && p.status_code === 200 && next < statuses.length
      ? { ...p, status_code: statuses[next++]! }
      : p,
  );
  // A fixture keeps a sample of a check's rows; refuse rather than change fewer than asked.
  if (next !== statuses.length) throw new Error(`only ${next} served rows to change`);
  return { ...d, page_results };
}
const lineOf = (d: FixtureDataset, checkId: string) =>
  resultView(d, checkId, { map: null }).crawledLine;

describe('the coverage line', () => {
  it('reads as before when every address answered with a page', () => {
    expect(lineOf(CLEAN, CLEAN_CHECK)).toBe('All 38 pages crawled');
    expect(lineOf(CHALLENGED, CHALLENGED_RECHECK)).toBe('96 of 140 pages crawled');
  });

  it('takes addresses that answered 404 or 410 off both counts, and names them', () => {
    expect(lineOf(answering(CLEAN, CLEAN_CHECK, [404, 404]), CLEAN_CHECK)).toBe(
      'All 36 pages crawled; 2 addresses answered not found or gone',
    );
    expect(lineOf(answering(CLEAN, CLEAN_CHECK, [410]), CLEAN_CHECK)).toBe(
      'All 37 pages crawled; 1 address answered not found or gone',
    );
  });

  it('does the same on a crawl that stopped short', () => {
    expect(lineOf(answering(CHALLENGED, CHALLENGED_RECHECK, [404]), CHALLENGED_RECHECK)).toBe(
      '95 of 139 pages crawled; 1 address answered not found or gone',
    );
  });

  it('still counts a page that answered with an error other than not found', () => {
    expect(lineOf(answering(CLEAN, CLEAN_CHECK, [500, 503]), CLEAN_CHECK)).toBe(
      'All 38 pages crawled',
    );
  });

  it('is the line the PDF prints', () => {
    const d = answering(CLEAN, CLEAN_CHECK, [404, 404]);
    expect(
      auditDoc({ dataset: d, checkId: CLEAN_CHECK }, { home: 'https://crawlmouse.com/' }).lines,
    ).toContain('All 36 pages crawled; 2 addresses answered not found or gone');
  });
});

describe('the statuses that are not pages', () => {
  it('are the engine’s own gone statuses', () => {
    expect([...NOT_FOUND_STATUSES]).toEqual([...GONE_STATUSES]);
  });
});

describe('a partial crawl claims nothing of the pages it did not crawl (inbox 059)', () => {
  const clean = CLEAN.checks.find((c) => c.id === CLEAN_CHECK)!;
  const partial = {
    ...clean,
    coverage: { ...clean.coverage!, pages_discovered: clean.coverage!.pages_crawled + 371 },
  };
  const none = () => false;

  it('says every page crawled is linked, not every page', () => {
    expect(seoSummary(clean, [], none)).toContain('every page is linked');
    expect(seoSummary(partial, [], none)).toContain('every page crawled is linked');
    expect(seoSummary(partial, [], none)).not.toContain('every page is linked');
  });

  it('says no orphan pages among those crawled', () => {
    expect(seoShortSummary(clean, [], none)).toContain('No orphan pages.');
    expect(seoShortSummary(partial, [], none)).toContain('No orphan pages among those crawled.');
  });
});
