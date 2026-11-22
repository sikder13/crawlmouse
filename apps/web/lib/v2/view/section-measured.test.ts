import { buildCheck } from '@crawlmouse/engine/v2/pipeline';
import type { CrawlPage, LinkEdge } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { recordedBuild } from '../../../../../packages/engine/fixtures/v2/build/recorded';
import {
  crawlRow,
  edge,
  oneBatchBuild,
} from '../../../../../packages/engine/fixtures/v2/build/rows';
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
function built(pages: CrawlPage[], links: LinkEdge[] = []) {
  const input = oneBatchBuild(HOME, pages, links);
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

/** Each way a screen says a section is clean; a check that read no link has earned none of them. */
const CLEAN_CLAIM =
  /nothing to fix|nothing urgent|every page crawled has|every page is linked|no orphan|within three clicks|which is healthy|no page stands out/i;

describe('no screen says there is nothing to fix in what was not measured', () => {
  it.each([
    ['every page refused', () => built([page('', 403, 'refused'), page('/a', 403, 'refused')])],
    ['every page gone', () => built([page('', 404, 'gone')])],
    ['one page served, with nothing else measured', () => built([page('', 200)])],
  ])('%s, built by the engine', (_name, make) => {
    expect(everyScreen(make())).not.toMatch(CLEAN_CLAIM);
  });

  it('still says it of a section that was measured and has no fix (the sweep can pass only by reading)', () => {
    const d = fixture('clean-site');
    const v = resultView(d, CHECKS.cleanFirstAudit, { map: null });
    expect(JSON.stringify(v.doors)).toContain('nothing to fix');
  });
});

describe('what was read decides it, not whether a score was given', () => {
  it('a small site whose links were read is measured, though its structure score is withheld', () => {
    const b = built(
      [page('', 200), page('/a', 200), page('/b', 200)],
      [edge(HOME, `${HOME}/a`), edge(HOME, `${HOME}/b`), edge(`${HOME}/a`, `${HOME}/b`)],
    );
    expect(b.check.technical_seo!.site_structure_score).toBeNull();
    expect(sectionMeasured(b.check, 'structure')).toBe(true);
    const door = resultView(b.d, b.id, { map: null }).doors.find(
      (x) => x.title === 'Site structure',
    )!;
    expect(door.pill.label).not.toBe('not measured');
    expect(door.footer).not.toContain('not measured');
  });

  it('content that was read is measured, though the engine withholds its score', () => {
    const b = buildCheck(recordedBuild());
    expect(b.check.content!.score).toBeNull();
    expect(sectionMeasured(b.check, 'content')).toBe(true);
  });

  it('says of a check with no link read that no link was read', () => {
    const b = built([page('', 200)]);
    const v = structureView(b.d, b.id, {}, null);
    expect(v.headline.title).toBe('No internal link was read, so the structure was not measured.');
    expect(v.headline.pill.label).toBe('not measured');
    expect(v.orphans.heading).toBe('Orphan pages were not measured');
    expect(v.tiles.find((t) => t.label === 'Orphan pages')!.value).toBe('—');
    expect(v.tiles.find((t) => t.label === 'Average click depth')!.value).toBe('—');
  });

  it('counts no AI crawler as not measured', () => {
    const c = structuredClone(findCheck(fixture('clean-site'), CHECKS.cleanFirstAudit));
    c.crawlers = c.crawlers.filter((x) => x.group === 'search_engine');
    expect(sectionMeasured(c, 'crawler_access')).toBe(false);
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

  it('structure is not, with no internal link read', () => {
    const c = clean();
    c.structure!.internal_links = 0;
    expect(sectionMeasured(c, 'structure')).toBe(false);
  });

  it('content is not, when no content check evaluated a page', () => {
    const c = clean();
    for (const check of c.content!.checks) {
      for (const row of check.by_template) Object.assign(row, { passing: 0, total: 0 });
    }
    expect(sectionMeasured(c, 'content')).toBe(false);
    c.content = null;
    expect(sectionMeasured(c, 'content')).toBe(false);
  });
});
