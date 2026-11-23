/**
 * What a result screen may say of a section the check read nothing of (V2R questions 011, 012), on
 * checks the real builder made. A section read only in part counts as read here; saying so is its
 * own PR (`build/v2r-a2-measured-partial`).
 */
import { buildCheck } from '@crawlmouse/engine/v2/pipeline';
import type { CrawlPage, LinkEdge } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { recordedBuild } from '../../../../../packages/engine/fixtures/v2/build/recorded';
import {
  crawlRow,
  edge,
  oneBatchBuild,
} from '../../../../../packages/engine/fixtures/v2/build/rows';
import { findCheck, fixture, type ViewDataset } from '../fixtures';
import { CHECKS } from '../recordings';
import { linkMapView } from './link-map';
import { resultView } from './result';
import { everySectionMeasured, noFixWords, sectionMeasured } from './section-measured';
import { accessView } from './segment/access';
import { changesView } from './segment/changes';
import { contentView } from './segment/content';
import { nojsView } from './segment/nojs';
import { signalsView } from './segment/signals';
import { structureView } from './segment/structure';
import { datasetOfBuilds } from './test-support/built-dataset';

const HOME = 'https://example.test';
const page = (path: string, status: number, response?: 'refused' | 'gone'): CrawlPage =>
  crawlRow({ url: `${HOME}${path}`, outcome: 'fetched', status, response });

function built(pages: CrawlPage[], links: LinkEdge[] = []) {
  const input = oneBatchBuild(HOME, pages, links);
  const b = buildCheck(input);
  const d = structuredClone(datasetOfBuilds(input.site, [b])) as ViewDataset;
  return { d, id: b.check.id, check: findCheck(d, b.check.id) };
}
type Built = ReturnType<typeof built>;

const clean = () => {
  const d = structuredClone(fixture('clean-site')) as ViewDataset;
  return { d, id: CHECKS.cleanFirstAudit, check: findCheck(d, CHECKS.cleanFirstAudit) };
};

/** What the screens are handed, less the one sentence scoped to what was measured. */
function everyScreen({ d, id }: Built) {
  const result = resultView(d, id, { map: null });
  return JSON.stringify([
    result.first,
    result.doors,
    result.grades,
    result.map,
    accessView(d, id),
    nojsView(d, id),
    contentView(d, id),
    signalsView(d, id),
    structureView(d, id, {}, null),
    linkMapView(d, id, { scope: 'all' }),
  ]).replaceAll('We found nothing to fix in what we measured.', '');
}

const CLEAN_CLAIM =
  /nothing to fix|nothing urgent|every page crawled has|every page is linked|no orphan pages|within three clicks|which is healthy|no page stands out/i;

describe('no screen says a section is clean when it read nothing', () => {
  it.each([
    ['every page refused', () => built([page('', 403, 'refused'), page('/a', 403, 'refused')])],
    ['every page gone', () => built([page('', 404, 'gone')])],
    ['one page served, nothing else measured', () => built([page('', 200)])],
  ])('%s, built by the engine', (_name, make) => {
    expect(everyScreen(make())).not.toMatch(CLEAN_CLAIM);
  });

  it('still says it of a section that was read (the sweep can pass only by reading)', () => {
    const c = clean();
    expect(JSON.stringify(resultView(c.d, c.id, { map: null }).doors)).toContain('nothing to fix');
  });

  it('shows no zero that reads as none found when no link was read', () => {
    const b = built([page('', 403, 'refused'), page('/a', 403, 'refused')]);
    expect(resultView(b.d, b.id, { map: null }).map.orphans).toBeNull();
    const map = linkMapView(b.d, b.id, { scope: 'all' });
    expect(map.filters).toEqual([]);
    expect(map.caption).toBe('2 pages answered, none served, so there is no link map.');
    const v = structureView(b.d, b.id, {}, null);
    expect(v.coverage).toMatchObject({ tested: 0, groups: 0 });
    expect(v.tiles.find((t) => t.label === 'Orphan pages')!.value).toBe('—');
    expect(v.tiles.find((t) => t.label === 'Average click depth')!.value).toBe('—');
    expect(v.orphans.heading).toBe('Orphan pages were not measured');
  });

  it('keeps the counts of a check that read its links', () => {
    const b = built(
      [page('', 200), page('/a', 200), page('/b', 200)],
      [edge(HOME, `${HOME}/a`), edge(HOME, `${HOME}/b`), edge(`${HOME}/a`, `${HOME}/b`)],
    );
    expect(resultView(b.d, b.id, { map: null }).map.orphans).toBe(0);
    expect(linkMapView(b.d, b.id, { scope: 'all' }).filters).toHaveLength(3);
    expect(structureView(b.d, b.id, {}, null).coverage.tested).toBe(3);
  });
});

describe('sectionMeasured: anything read counts, and a withheld score does not matter', () => {
  it('crawler access is not read with no AI crawler measured', () => {
    const b = built([page('', 403, 'refused')]);
    expect(sectionMeasured(b.check, 'crawler_access')).toBe(false);
  });

  it('crawler access is not read behind an edge that refused the control', () => {
    const { check } = clean();
    for (const c of check.crawlers.filter((x) => x.group !== 'search_engine'))
      c.verdict = 'edge_blocks_automation';
    expect(sectionMeasured(check, 'crawler_access')).toBe(false);
  });

  it('crawler access is not read with no AI crawler at all', () => {
    const { check } = clean();
    check.crawlers = check.crawlers.filter((x) => x.group === 'search_engine');
    expect(sectionMeasured(check, 'crawler_access')).toBe(false);
  });

  it('crawler access is read with five of six measured, and says nothing to fix there', () => {
    const { d, id, check } = clean();
    check.crawlers.find((x) => x.ua === 'GPTBot')!.verdict = 'not_measured';
    expect(sectionMeasured(check, 'crawler_access')).toBe(true);
    expect(resultView(d, id, { map: null }).doors[0]!.footer).toContain('nothing to fix');
  });

  it('structure is read on a small site whose score is withheld', () => {
    const b = built(
      [page('', 200), page('/a', 200), page('/b', 200)],
      [edge(HOME, `${HOME}/a`), edge(HOME, `${HOME}/b`)],
    );
    expect(b.check.technical_seo!.site_structure_score).toBeNull();
    expect(sectionMeasured(b.check, 'structure')).toBe(true);
  });

  it('structure is read on a site with real orphans and no link: that is a finding', () => {
    const b = built([page('', 200), page('/a', 200), page('/b', 200)]);
    expect(b.check.structure!.internal_links).toBe(0);
    expect(b.check.structure!.orphan_pages).toBeGreaterThan(0);
    expect(sectionMeasured(b.check, 'structure')).toBe(true);
    const v = structureView(b.d, b.id, {}, null);
    expect(v.headline.title).toMatch(/no links pointing at/);
    expect(v.tiles.find((t) => t.label === 'Orphan pages')!.value).toBe(
      String(b.check.structure!.orphan_pages),
    );
    expect(resultView(b.d, b.id, { map: null }).map.orphans).toBe(b.check.structure!.orphan_pages);
  });

  it('structure is not read with no link, and is with JS-only pages', () => {
    const b = built([page('', 200)]);
    expect(sectionMeasured(b.check, 'structure')).toBe(false);
    b.check.structure!.js_only_pages = 2;
    expect(sectionMeasured(b.check, 'structure')).toBe(true);
  });

  it('content is read on the recorded site, though the engine withholds its score', () => {
    const b = buildCheck(recordedBuild());
    expect(b.check.content!.score).toBeNull();
    expect(sectionMeasured(b.check, 'content')).toBe(true);
  });

  it('content is not read when no content check evaluated a page', () => {
    const { check } = clean();
    for (const c of check.content!.checks) {
      for (const r of c.by_template) Object.assign(r, { passing: 0, total: 0 });
    }
    expect(sectionMeasured(check, 'content')).toBe(false);
    check.content = null;
    expect(sectionMeasured(check, 'content')).toBe(false);
  });

  it('text is read with a share, and not without', () => {
    const { check } = clean();
    expect(sectionMeasured(check, 'without_js')).toBe(true);
    check.without_js = null;
    expect(sectionMeasured(check, 'without_js')).toBe(false);
  });

  it('words an empty section by whether it was read', () => {
    const { check } = clean();
    expect(noFixWords(check, 'without_js')).toBe('nothing to fix');
    check.without_js = null;
    expect(noFixWords(check, 'without_js')).toBe('not measured');
  });
});

describe('the all-clear card needs each section read', () => {
  it.each([
    [
      'content',
      (c: ReturnType<typeof clean>['check']) => (c.content = null),
      'No page’s content was checked.',
    ],
    [
      'structure',
      (c: ReturnType<typeof clean>['check']) => (c.structure!.internal_links = 0),
      'No internal link was read.',
    ],
    [
      'text',
      (c: ReturnType<typeof clean>['check']) => (c.without_js = null),
      'Text without JavaScript was not measured.',
    ],
  ])('is not given with %s unread, and the card names it', (_name, edit, sentence) => {
    const c = clean();
    expect(everySectionMeasured(c.check)).toBe(true);
    edit(c.check);
    const first = resultView(c.d, c.id, { map: null }).first;
    expect(first.kind).toBe('unmeasured');
    expect(first.kind !== 'fix' && first.body).toContain(sentence);
  });

  it('claims no more than "not everything" when no section was read', () => {
    const c = clean();
    for (const x of c.check.crawlers.filter((y) => y.group !== 'search_engine'))
      x.verdict = 'not_measured';
    c.check.without_js = null;
    c.check.content = null;
    Object.assign(c.check.structure!, { internal_links: 0, orphan_pages: 0, js_only_pages: 0 });
    const first = resultView(c.d, c.id, { map: null }).first;
    if (first.kind !== 'unmeasured') throw new Error(`got ${first.kind}`);
    // The same page still reports robots.txt and the signals, so "nothing" would be false beside them.
    expect(
      c.check.crawlers.some((x) => x.group === 'search_engine' && x.verdict !== 'not_measured'),
    ).toBe(true);
    expect(first.title).toBe('Not everything was measured');
    expect(first.body).not.toContain('in what we measured');
  });

  it('behind an edge, says no AI crawler could be tested, not that no crawler was', () => {
    const c = clean();
    for (const x of c.check.crawlers.filter((y) => y.group !== 'search_engine'))
      x.verdict = 'edge_blocks_automation';
    const first = resultView(c.d, c.id, { map: null }).first;
    expect(first.kind !== 'fix' && first.body).toContain('No AI crawler could be tested.');
  });
});

describe('"nothing changed" needs both checks to have read each section', () => {
  function recheck(edit: (previous: ViewDataset['checks'][number]) => void = () => {}) {
    const d = structuredClone(fixture('bad-site')) as ViewDataset;
    const c = d.checks.find((x) => x.previous_check_id !== null && x.structure)!;
    d.changes = d.changes.filter((x) => x.check_id !== c.id);
    edit(findCheck(d, c.previous_check_id!));
    return { door: resultView(d, c.id, { map: null }).doors.at(-1)!, view: changesView(d, c.id) };
  }

  it('says so when both did', () => {
    const { door, view } = recheck();
    expect(door.pill.label).toBe('no changes');
    expect(door.body).toBe('Nothing changed since the check before this one.');
    expect(view.state === 'changes' && view.headline.title).toMatch(/^Nothing changed at the /);
  });

  it('says only what both measured when the earlier one read less', () => {
    const { door, view } = recheck((p) => {
      p.without_js = null;
    });
    expect(door.pill.label).toBe('no measured change');
    expect(door.body).toBe('No change in what both checks measured.');
    expect(view.state === 'changes' && view.headline.title).toMatch(/^No change in what both/);
  });
});
