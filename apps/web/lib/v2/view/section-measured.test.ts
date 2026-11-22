/**
 * The rule behind each clean sentence on the result screens (V2R question 011): every section at each
 * of its levels, on checks the real builder made, and the claims that must not survive below `full`.
 */
import { buildCheck } from '@crawlmouse/engine/v2/pipeline';
import type { Check, CrawlPage, LinkEdge } from '@crawlmouse/types/v2';
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
import { measuredInFull, measuredLevel, noFixWords, placedPages } from './section-measured';
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

const threeLinked = () =>
  built(
    [page('', 200), page('/a', 200), page('/b', 200)],
    [edge(HOME, `${HOME}/a`), edge(HOME, `${HOME}/b`), edge(`${HOME}/a`, `${HOME}/b`)],
  );
/** The three-page site with one page the graph cannot account for. */
function onePageUnplaced() {
  const b = threeLinked();
  Object.assign(b.d.page_results.find((p) => p.url.endsWith('/b'))!, {
    depth: null,
    is_orphan: false,
    js_only: false,
  });
  return b;
}
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
  ])
    .replaceAll('We found nothing to fix in what we measured.', '')
    .replaceAll('nothing to fix in what was measured', '');
}

const CLEAN_CLAIM =
  /nothing to fix|nothing urgent|every page crawled has|every page is linked|no orphan pages|within three clicks|which is healthy|no page stands out/i;

describe('crawler access', () => {
  it('is none when no AI crawler was measured', () => {
    const b = built([page('', 403, 'refused')]);
    expect(measuredLevel(b.d, b.check, 'crawler_access')).toBe('none');
  });

  it('is none behind an edge that refused the control', () => {
    const { d, check } = clean();
    for (const c of check.crawlers.filter((x) => x.group !== 'search_engine'))
      c.verdict = 'edge_blocks_automation';
    expect(measuredLevel(d, check, 'crawler_access')).toBe('none');
  });

  it('is partial with one of six measured out (C-2), and the footer says so', () => {
    const { d, id, check } = clean();
    check.crawlers.find((x) => x.ua === 'GPTBot')!.verdict = 'not_measured';
    expect(measuredLevel(d, check, 'crawler_access')).toBe('partial');
    const door = resultView(d, id, { map: null }).doors[0]!;
    expect(door.footer).toContain('nothing to fix in what was measured');
  });

  it('is partial when a crawler was measured on under half its sampled pages', () => {
    const { d, check } = clean();
    const sampled = check.coverage!.pages_sampled;
    check.crawlers.find((x) => x.ua === 'GPTBot')!.pages_measured = Math.ceil(sampled / 2) - 1;
    expect(measuredLevel(d, check, 'crawler_access')).toBe('partial');
  });

  it('is full at exactly half, and when only a search engine is unmeasured', () => {
    const { d, check } = clean();
    const sampled = check.coverage!.pages_sampled;
    check.crawlers.find((x) => x.ua === 'GPTBot')!.pages_measured = Math.ceil(sampled / 2);
    check.crawlers.find((x) => x.group === 'search_engine')!.verdict = 'not_measured';
    expect(measuredLevel(d, check, 'crawler_access')).toBe('full');
  });

  it('does not hold a robots.txt verdict to the page count', () => {
    const { d, check } = clean();
    Object.assign(check.crawlers.find((x) => x.ua === 'GPTBot')!, {
      verdict: 'disallowed_by_robots',
      evidence_class: 'declared',
      pages_measured: 0,
    });
    expect(measuredLevel(d, check, 'crawler_access')).toBe('full');
  });

  it('is none with no AI crawler at all', () => {
    const { d, check } = clean();
    check.crawlers = check.crawlers.filter((x) => x.group === 'search_engine');
    expect(measuredLevel(d, check, 'crawler_access')).toBe('none');
  });
});

describe('structure', () => {
  it('is none with no link read', () => {
    const b = built([page('', 200)]);
    expect(measuredLevel(b.d, b.check, 'structure')).toBe('none');
  });

  it('is full on a small site whose score is withheld', () => {
    const b = threeLinked();
    expect(b.check.technical_seo!.site_structure_score).toBeNull();
    expect(measuredLevel(b.d, b.check, 'structure')).toBe('full');
  });

  it('is partial when a served page is neither reached, orphaned nor JS-only', () => {
    const b = onePageUnplaced();
    expect(placedPages(b.d, b.check)).toEqual({ placed: 2, total: 3 });
    expect(measuredLevel(b.d, b.check, 'structure')).toBe('partial');
  });

  it('counts a real orphan as placed: it is a finding, not a gap', () => {
    const b = threeLinked();
    Object.assign(b.d.page_results.find((p) => p.url.endsWith('/b'))!, {
      depth: null,
      is_orphan: true,
    });
    expect(measuredLevel(b.d, b.check, 'structure')).toBe('full');
  });

  it('counts JS-only links as read (C-3)', () => {
    const b = built([page('', 200)]);
    b.check.structure!.js_only_pages = 2;
    expect(measuredLevel(b.d, b.check, 'structure')).not.toBe('none');
  });

  it('at partial, makes no claim about every page, and gives the numbers', () => {
    const b = onePageUnplaced();
    expect(everyScreen(b)).not.toMatch(
      /every page crawled has|every page is linked|no orphan pages|within three clicks|which is healthy/i,
    );
    const v = structureView(b.d, b.id, {}, null);
    expect(v.headline.title).toBe('2 of 3 pages could be placed through the links we read.');
    expect(v.orphans.heading).toBe('No orphan among the pages placed');
  });

  it('at none, shows no count that reads as none found (C-1)', () => {
    const b = built([page('', 403, 'refused'), page('/a', 403, 'refused')]);
    expect(resultView(b.d, b.id, { map: null }).map.orphans).toBeNull();
    const map = linkMapView(b.d, b.id, { scope: 'all' });
    expect(map.filters).toEqual([]);
    expect(map.caption).toBe('2 pages crawled; no internal link between them was read.');
    const v = structureView(b.d, b.id, {}, null);
    expect(v.coverage.tested).toBe(0);
    expect(v.tiles.find((t) => t.label === 'Orphan pages')!.value).toBe('—');
    expect(v.tiles.find((t) => t.label === 'Average click depth')!.value).toBe('—');
    expect(v.orphans.heading).toBe('Orphan pages were not measured');
  });
});

describe('content', () => {
  it('is none when no content check evaluated a page', () => {
    const { d, check } = clean();
    for (const c of check.content!.checks) {
      for (const r of c.by_template) Object.assign(r, { passing: 0, total: 0 });
    }
    expect(measuredLevel(d, check, 'content')).toBe('none');
    check.content = null;
    expect(measuredLevel(d, check, 'content')).toBe('none');
  });

  it('is partial when a template had no page evaluated', () => {
    const { d, check } = clean();
    const key = check.coverage!.templates[0]!.template_key;
    for (const c of check.content!.checks) {
      for (const r of c.by_template.filter((x) => x.template_key === key)) r.total = 0;
    }
    expect(measuredLevel(d, check, 'content')).toBe('partial');
  });

  it('is read on the recorded site, though the engine withholds its score (its guides are not)', () => {
    const input = recordedBuild();
    const b = buildCheck(input);
    const d = datasetOfBuilds(input.site, [b]);
    expect(b.check.content!.score).toBeNull();
    expect(measuredLevel(d, b.check, 'content')).toBe('partial');
  });
});

describe('text without JavaScript', () => {
  it('is none with no share and full with one', () => {
    const { d, check } = clean();
    expect(measuredLevel(d, check, 'without_js')).toBe('full');
    check.without_js = null;
    expect(measuredLevel(d, check, 'without_js')).toBe('none');
  });

  it('does not say every template ships its text on a low share', () => {
    const { d, id, check } = clean();
    check.without_js = { site_text_share: 0.4 };
    expect(nojsView(d, id).headline.title).toBe(
      '40% of the text is in the HTML before JavaScript runs.',
    );
  });
});

describe('the words for an empty section', () => {
  it.each([
    ['full', 'nothing to fix'],
    ['partial', 'nothing to fix in what was measured'],
    ['none', 'not measured'],
  ] as const)('%s', (level, words) => expect(noFixWords(level)).toBe(words));
});

describe('the clean claims, on checks the real builder made', () => {
  it.each([
    ['every page refused', () => built([page('', 403, 'refused'), page('/a', 403, 'refused')])],
    ['every page gone', () => built([page('', 404, 'gone')])],
    ['one page served, nothing else measured', () => built([page('', 200)])],
  ])('%s: no screen says a section is clean', (_name, make) => {
    expect(everyScreen(make())).not.toMatch(CLEAN_CLAIM);
  });

  it('the all-clear needs all four sections in full', () => {
    const c = clean();
    expect(measuredInFull(c.d, c.check)).toBe(true);
    expect(resultView(c.d, c.id, { map: null }).first.kind).toBe('all-clear');
    const noContent = clean();
    noContent.check.content = null;
    const first = resultView(noContent.d, noContent.id, { map: null }).first;
    expect(first.kind).toBe('unmeasured');
    expect(first.kind !== 'fix' && first.body).toContain('No page’s content was checked.');
  });

  it('still says it of a section measured in full (the sweep can pass only by reading)', () => {
    const c = clean();
    expect(JSON.stringify(resultView(c.d, c.id, { map: null }).doors)).toContain('nothing to fix');
  });
});

describe('"nothing changed" needs both checks measured in full', () => {
  /** The bad site's re-check with no change rows, and `edit` applied to the check before it. */
  function recheck(edit: (previous: Check) => void = () => {}) {
    const d = structuredClone(fixture('bad-site')) as ViewDataset;
    const c = d.checks.find((x) => x.previous_check_id !== null && x.structure)!;
    d.changes = d.changes.filter((x) => x.check_id !== c.id);
    edit(findCheck(d, c.previous_check_id!));
    const door = resultView(d, c.id, { map: null }).doors.at(-1)!;
    return { door, page: changesView(d, c.id) };
  }

  it('says so when both were', () => {
    const { door, page: v } = recheck();
    expect(door.pill.label).toBe('no changes');
    expect(door.body).toBe('Nothing changed since the check before this one.');
    expect(v.state === 'changes' && v.headline.title).toMatch(/^Nothing changed at the /);
  });

  it('says only what both measured when the earlier one measured less', () => {
    const { door, page: v } = recheck((p) => {
      p.without_js = null;
    });
    expect(door.pill.label).toBe('no measured change');
    expect(door.body).toBe('No change in what both checks measured.');
    expect(v.state === 'changes' && v.headline.title).toMatch(/^No change in what both checks/);
  });
});
