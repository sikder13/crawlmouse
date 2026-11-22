import { buildCheck } from '@crawlmouse/engine/v2/pipeline';
import type { CrawlPage } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { crawlRow, oneBatchBuild } from '../../../../../packages/engine/fixtures/v2/build/rows';
import { fixture, findCheck } from '../fixtures';
import { CHECKS } from '../recordings';
import { linkMapView } from './link-map';
import { resultView } from './result';
import { sectionMeasured } from './section-measured';
import { accessView } from './segment/access';
import { contentView } from './segment/content';
import { nojsView } from './segment/nojs';
import { signalsView } from './segment/signals';
import { structureView } from './segment/structure';
import { datasetOfBuilds } from './test-support/built-dataset';

const HOME = 'https://example.test';
const page = (path: string, status: number, response?: 'refused' | 'gone'): CrawlPage =>
  crawlRow({ url: `${HOME}${path}`, outcome: 'fetched', status, response });

/** A check the real builder made from these rows, as the views read it. */
function built(pages: CrawlPage[]) {
  const input = oneBatchBuild(HOME, pages);
  const b = buildCheck(input);
  return { d: datasetOfBuilds(input.site, [b]), id: b.check.id, check: b.check };
}

/** What each screen of the audit is handed, as one string. */
function everyScreen({ d, id }: ReturnType<typeof built>) {
  const result = resultView(d, id, { map: null });
  return JSON.stringify([
    result.first,
    result.doors,
    result.grades,
    accessView(d, id),
    nojsView(d, id),
    contentView(d, id),
    signalsView(d, id),
    structureView(d, id, {}, null),
    linkMapView(d, id, { scope: 'all' }),
    // The one sentence that says it, of what was measured, on a card that goes on to name the rest.
  ]).replaceAll('We found nothing to fix in what we measured.', '');
}

describe('no screen says there is nothing to fix in what was not measured', () => {
  it.each([
    ['every page refused', () => built([page('', 403, 'refused'), page('/a', 403, 'refused')])],
    ['every page gone', () => built([page('', 404, 'gone')])],
    ['one page served, with nothing else measured', () => built([page('', 200)])],
  ])('%s, built by the engine', (_name, make) => {
    expect(everyScreen(make())).not.toMatch(/nothing to fix|nothing urgent/i);
  });

  it('still says it of a section that was measured and has no fix (the sweep can pass only by reading)', () => {
    const d = fixture('clean-site');
    const v = resultView(d, CHECKS.cleanFirstAudit, { map: null });
    expect(JSON.stringify(v.doors)).toContain('nothing to fix');
  });
});

describe('sectionMeasured', () => {
  const clean = () => structuredClone(findCheck(fixture('clean-site'), CHECKS.cleanFirstAudit));

  it.each(['crawler_access', 'without_js', 'structure', 'content'] as const)(
    '%s is measured on a fully measured check',
    (section) => expect(sectionMeasured(clean(), section)).toBe(true),
  );

  it('crawler access is not, with one AI crawler unmeasured', () => {
    const c = clean();
    c.crawlers.find((x) => x.ua === 'GPTBot')!.verdict = 'not_measured';
    expect(sectionMeasured(c, 'crawler_access')).toBe(false);
  });

  it('crawler access is not, behind an edge that refused the control', () => {
    const c = clean();
    c.crawlers.find((x) => x.ua === 'GPTBot')!.verdict = 'edge_blocks_automation';
    expect(sectionMeasured(c, 'crawler_access')).toBe(false);
  });

  it('crawler access is, when only a search engine was not measured', () => {
    const c = clean();
    c.crawlers.find((x) => x.group === 'search_engine')!.verdict = 'not_measured';
    expect(sectionMeasured(c, 'crawler_access')).toBe(true);
  });

  it('text is not, with no site-wide share', () => {
    const c = clean();
    c.without_js = null;
    expect(sectionMeasured(c, 'without_js')).toBe(false);
  });

  it('structure is not, with no structure score', () => {
    const c = clean();
    c.technical_seo!.site_structure_score = null;
    expect(sectionMeasured(c, 'structure')).toBe(false);
  });

  it('content is not, as the builder stores it: a record whose score was withheld', () => {
    const c = clean();
    c.content = { ...c.content!, score: null };
    expect(sectionMeasured(c, 'content')).toBe(false);
    c.content = null;
    expect(sectionMeasured(c, 'content')).toBe(false);
  });
});
