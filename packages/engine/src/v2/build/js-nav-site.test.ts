/**
 * A site whose product pages add their navigation in the browser (fixtures/v2/build/js-nav-site.ts),
 * through the pipeline's own order: sample → renderCandidates → renderCheck → buildCheck. The records
 * below are written by hand from the fixture's description, not read back from a run.
 */
import type { Fix, FixEvent } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { fixWithHistory } from '../../../fixtures/v2/diff/builders.js';
import {
  JS_NAV_REPLIES,
  jsNavBuild,
  jsNavUrl as at,
} from '../../../fixtures/v2/build/js-nav-site.js';
import { fingerprintOf } from '../detectors/fingerprint.js';
import { detectJsOnlyNavigation, type JsOnlyDetection } from '../detectors/js-only-navigation.js';
import { fakeClient, memoryDailyBudget } from '../render/fakes.js';
import { renderCheck, type RenderOutcome } from '../render/run.js';
import { assemble } from './assemble.js';
import { readBatches } from './batches.js';
import { buildCheck } from './build.js';
import { emptyRootUrls, renderCandidates, sample } from './plan.js';

async function pipeline(fixes: Fix[] = [], events: FixEvent[] = []) {
  const input = { ...jsNavBuild(), fixes, events };
  const a = assemble(input, readBatches(input.batches, input.check, input.lineage.worker_release));
  const s = sample(a);
  const plan = renderCandidates(a, [...s.stage1, ...s.stage2], fixes, new Map());
  const render = await renderCheck({
    ...plan,
    client: fakeClient(JS_NAV_REPLIES),
    admit: async () => {},
    caps: { perCheckMs: 600_000, perDayMs: 3_600_000 },
    daily: memoryDailyBudget(),
    sleep: async () => {},
  });
  return { input, assembled: a, render, built: buildCheck({ ...input, render }) };
}

/**
 * The access sample with no access batch is one page a template (sample.ts stage 1): the homepage,
 * `/guides/tent-pitching` (the homepage links to it, so it outranks the orphaned guide) and
 * `/products/camp-stove` (the two products rank alike; the lower URL first). Those three are the
 * render step's candidates, and each is rendered.
 */
const record = (
  template_key: string,
  state: JsOnlyDetection['state'],
  present: string[],
  pages: Array<[path: string, targets: string[]]>,
): JsOnlyDetection => ({
  type: 'js_only_navigation',
  fingerprint: fingerprintOf(`jsnav:${template_key}`),
  key: `jsnav:${template_key}`,
  template_key,
  state,
  reason: null,
  extent: { pages: present.length, graded: present.length, rendered: pages.length },
  affected_urls: state === 'detected' ? present.map(at) : [],
  evidence: {
    pages: pages.map(([p, targets]) => ({
      url: at(p),
      js_only_count: targets.length,
      js_only_targets: targets.map(at),
    })),
  },
});

/** Each product page's menu less what its HTML already links to: the two guides and the news page. */
const MENU_ONLY = ['/blog/latest-news', '/guides/camp-cooking', '/guides/tent-pitching'];

const EXPECTED: JsOnlyDetection[] = [
  record('/', 'not_detected', ['/'], [['/', []]]),
  record(
    '/guides/{slug}',
    'not_detected',
    ['/guides/camp-cooking', '/guides/tent-pitching'],
    [['/guides/tent-pitching', []]],
  ),
  record(
    '/products/{slug}',
    'detected',
    ['/products/camp-stove', '/products/dome-tent'],
    [['/products/camp-stove', MENU_ONLY]],
  ),
];

/** The rendered pages' links, by URL, as the build reads them from the render outcome. */
const linksOf = (render: RenderOutcome) =>
  new Map(render.pages.flatMap((p) => (p.rendered && p.links ? [[p.url, p.links] as const] : [])));

describe('a site whose product pages add their navigation in the browser', () => {
  it('renders every page, and the detector gives the records written by hand', async () => {
    const { built, render, assembled } = await pipeline();
    expect(render.pages.every((p) => p.rendered)).toBe(true);
    expect(render.pages.map((p) => p.url).sort()).toEqual(
      ['/', '/guides/tent-pitching', '/products/camp-stove'].map(at),
    );
    const pages = built.page_results;
    expect(
      detectJsOnlyNavigation(pages, linksOf(render), { emptyRoots: emptyRootUrls(assembled) }),
    ).toEqual(EXPECTED);
  });

  it('opens one fix, on the product template, with no packet', async () => {
    const { built } = await pipeline();
    const fixes = built.fixes.filter((f) => f.type === 'js_only_navigation');
    expect(fixes).toHaveLength(1);
    expect(fixes[0]).toMatchObject({
      section: 'structure',
      template_key: '/products/{slug}',
      affected_pages: 2,
      recommendation_class: 'best_practice',
      // one evidence page of the template's two (renderedConfidence)
      confidence: 'likely',
      packet: null,
      crawler_uas: [],
    });
    expect(fixes[0]!.title).toMatch(/^Put the links of .+ in the HTML$/);
    expect(built.diff_inputs.detectors).toContain('js_only_navigation');
  });

  it('keeps the links on the render outcome only: each PageResult.without_js holds exactly its four keys', async () => {
    const { built } = await pipeline();
    const rendered = built.page_results.filter((p) => p.without_js !== null);
    expect(rendered).toHaveLength(3);
    for (const p of rendered) {
      expect(Object.keys(p.without_js!).sort()).toEqual([
        'raw_words',
        'rendered_words',
        'state',
        'text_share',
      ]);
      expect(Object.keys(p)).not.toContain('links');
    }
  });

  it('builds from an outcome stored before links were kept: every JS-only record is not_rendered, and the grades are the same', async () => {
    const { input, render, built } = await pipeline();
    // The outcome as stored before links were kept: each page without its `links` key.
    const old = JSON.parse(JSON.stringify(render)) as RenderOutcome;
    for (const p of old.pages) if (p.rendered) delete p.links;
    expect(old.pages.some((p) => 'links' in p)).toBe(false);
    const stored = buildCheck({ ...input, render: old });
    const jsOnly = stored.fixes.filter((f) => f.type === 'js_only_navigation');
    expect(jsOnly).toEqual([]);
    const fingerprints = EXPECTED.map((r) => r.fingerprint);
    expect(fingerprints.every((f) => stored.diff_inputs.indeterminate.includes(f))).toBe(true);
    expect(stored.check.technical_seo).toEqual(built.check.technical_seo);
    expect(stored.check.ai_readability).toEqual(built.check.ai_readability);
    expect(stored.page_results).toEqual(built.page_results);
  });

  describe('an awaiting fix whose template the check no longer holds (CC-32 D3, for this type)', () => {
    const gone = '/gone/{slug}';
    const awaiting = (status: 'open' | 'marked_done') => {
      const input = jsNavBuild();
      const { fix, events } = fixWithHistory(1, status, { type: 'js_only_navigation' });
      const at = (f: Fix): Fix => ({
        ...f,
        site_id: input.check.site_id,
        fingerprint: fingerprintOf(`jsnav:${gone}`),
        template_key: gone,
        last_measured_check_id: 'c0000000-0000-4000-8000-0000000000aa',
        first_seen_check_id: 'c0000000-0000-4000-8000-0000000000aa',
      });
      return { fix: at(fix), events };
    };

    it('an open one is template_absent, indeterminate, and remeasured', async () => {
      const { fix, events } = awaiting('open');
      expect(events).toEqual([]);
      const { built, input } = await pipeline([fix], events);
      expect(built.diff_inputs.indeterminate).toContain(fingerprintOf(`jsnav:${gone}`));
      expect(built.fixes.find((f) => f.id === fix.id)).toMatchObject({
        status: 'open',
        last_state: 'indeterminate',
        last_measured_check_id: input.check.id,
      });
    });

    it('a marked_done one cannot be verified', async () => {
      const { fix, events } = awaiting('marked_done');
      const { built } = await pipeline([fix], events);
      expect(built.diff_inputs.indeterminate).toContain(fingerprintOf(`jsnav:${gone}`));
      expect(built.fixes.find((f) => f.id === fix.id)).toMatchObject({
        status: 'unable_to_verify',
        last_state: 'indeterminate',
      });
      expect(built.fix_events.map((e) => e.kind)).toContain('unable_to_verify');
    });
  });

  it('reads a stored entry whose links are not the current shape as no links: not evidence, and no throw', async () => {
    const { input, render, built } = await pipeline();
    // The shape round 1 of the D6 review stored, and a count that is not a whole number.
    const round1 = { static: [], rendered: [at('/guides/camp-cooking')], truncated: false };
    const fractional = {
      js_only: [at('/guides/camp-cooking')],
      js_only_count: 1.5,
      truncated: false,
    };
    const stored = JSON.parse(JSON.stringify(render)) as { pages: Array<Record<string, unknown>> };
    stored.pages = stored.pages.map((p, i) => ({ ...p, links: i % 2 === 0 ? round1 : fractional }));
    const odd = buildCheck({ ...input, render: stored as unknown as RenderOutcome });
    expect(odd.fixes.filter((f) => f.type === 'js_only_navigation')).toEqual([]);
    for (const r of EXPECTED) expect(odd.diff_inputs.indeterminate).toContain(r.fingerprint);
    expect(odd.check.technical_seo).toEqual(built.check.technical_seo);
  });
});
