/**
 * The JS-only navigation fix (effects.ts `linkedInHtml`): each evidence page links in its HTML to its
 * JS-only targets that the crawl holds as pages, and to nothing else; the links count toward orphans,
 * depth and hubs and not toward anchor diversity; and a check where no such fix opens has every other
 * fix's effect unchanged.
 */
import { describe, expect, it } from 'vitest';
import { every } from '../../../fixtures/v2/access/builders.js';
import { blogSite } from '../../../fixtures/v2/grade/sites.js';
import { u } from '../../../fixtures/v2/detectors/builders.js';
import { fingerprintOf } from '../detectors/fingerprint.js';
import type { JsOnlyDetection } from '../detectors/js-only-navigation.js';
import { applyFix, effectsOf } from './effects.js';
import { aiFrom, gradeCheck, type Grades } from './index.js';
import { detectorOutcomes, NOTHING_WRITTEN } from './outcomes.js';
import { round } from './numbers.js';
import { technicalSeo } from './technical-seo.js';

const QUOTABLE_SCORED = { checks: { author_and_date: { passing: 1, decided: 1, unread: 0 } } };

/** Two guides no page links to, and a homepage and three posts linked both ways. */
const GUIDES = [
  { path: '/guides/a', template: '/guides/{slug}', links: ['/'] },
  { path: '/guides/b', template: '/guides/{slug}', links: ['/'] },
];

function graded(staticLinks: string[] = []) {
  const { input, access } = blogSite(3, 0, {}, GUIDES);
  const edges = [
    ...input.edges,
    ...staticLinks.map((to) => ({
      check_id: input.pages[0]!.check_id,
      from_url: u('/blog/post-0'),
      to_url: u(to),
      anchor_text: '',
      is_generic_anchor: false,
      js_only: false,
    })),
  ];
  const g = gradeCheck({ ...input, edges });
  const inputs = { ...g.inputs, ai: { ...g.inputs.ai, quotable: QUOTABLE_SCORED } };
  const grades: Grades = { ...g, inputs, ai_readability: aiFrom(inputs.ai) };
  return { input: { ...input, edges }, access, grades };
}

const KEY = 'jsnav:/blog/{slug}';
const record = (
  state: JsOnlyDetection['state'],
  targets: string[],
  reason: JsOnlyDetection['reason'] = null,
): JsOnlyDetection => ({
  type: 'js_only_navigation',
  fingerprint: fingerprintOf(KEY),
  key: KEY,
  template_key: '/blog/{slug}',
  state,
  reason,
  extent: { pages: 3, graded: 3, rendered: 1 },
  affected_urls:
    state === 'detected' ? ['/blog/post-0', '/blog/post-1', '/blog/post-2'].map(u) : [],
  evidence: {
    pages: [{ url: u('/blog/post-0'), js_only_count: targets.length, js_only_targets: targets }],
  },
});

describe('the JS-only navigation fix', () => {
  it('links the evidence page to its targets the crawl holds, and to no URL it never fetched', () => {
    const { grades } = graded();
    const fix = record('detected', [u('/guides/a'), u('/guides/b'), u('/never-crawled')]);
    const after = applyFix(grades.inputs, { family: 'rendered', record: fix });
    const added = after.seo.edges.slice(grades.inputs.seo.edges.length);
    expect(added.map((e) => [e.from_url, e.to_url])).toEqual([
      [u('/blog/post-0'), u('/guides/a')],
      [u('/blog/post-0'), u('/guides/b')],
    ]);
    expect(after.seo.added_links).toEqual([
      `${u('/blog/post-0')}\u0000${u('/guides/a')}`,
      `${u('/blog/post-0')}\u0000${u('/guides/b')}`,
    ]);
    expect(after.seo.pages).toBe(grades.inputs.seo.pages);
    expect(after.ai).toBe(grades.inputs.ai);
  });

  it('moves Technical SEO as far as the same links served in the HTML would, anchors aside', () => {
    const { grades } = graded();
    const fix = record('detected', [u('/guides/a'), u('/guides/b')]);
    const { byFix } = effectsOf(grades.inputs, [{ family: 'rendered', record: fix }]);
    // Independently: the site whose HTML carries the links, those links marked as added so anchor
    // diversity reads the same links as before.
    const served = graded(['/guides/a', '/guides/b']).grades.inputs.seo;
    const truth = technicalSeo({
      ...served,
      added_links: ['/guides/a', '/guides/b'].map((t) => `${u('/blog/post-0')}\u0000${u(t)}`),
    }).score!;
    const before = technicalSeo(grades.inputs.seo).score!;
    expect(truth).toBeGreaterThan(before);
    expect(byFix.get(fix.fingerprint)!.effect.technical_seo).toBe(round(truth - before));
    expect(byFix.get(fix.fingerprint)!.effect.ai_readability).toBe(0);
  });

  it('leaves every other fix’s effect, rank and the overview as they were when no JS-only fix opens', () => {
    // Two unanswered openings, a crawler blocked by a user-agent rule, two orphaned guides.
    const { input, access } = blogSite(4, 2, { GPTBot: every(2, 'blocked_by_ua_rule') }, GUIDES);
    const g = gradeCheck(input);
    const inputs = { ...g.inputs, ai: { ...g.inputs.ai, quotable: QUOTABLE_SCORED } };
    const grades: Grades = { ...g, inputs, ai_readability: aiFrom(inputs.ai) };
    const without = detectorOutcomes(grades, access, input.structure, [], NOTHING_WRITTEN);
    const unopened = [
      record('not_detected', []),
      {
        ...record('indeterminate', [], 'pages_disagree'),
        key: 'jsnav:/',
        fingerprint: fingerprintOf('jsnav:/'),
      },
      {
        ...record('indeterminate', [], 'not_rendered'),
        key: 'jsnav:/guides/{slug}',
        fingerprint: fingerprintOf('jsnav:/guides/{slug}'),
      },
    ];
    const withRecords = detectorOutcomes(
      grades,
      access,
      input.structure,
      unopened,
      NOTHING_WRITTEN,
    );
    expect(withRecords.overview).toEqual(without.overview);
    const fixes = (o: typeof without) => o.outcomes.filter((x) => x.state === 'detected');
    expect(fixes(without).length).toBeGreaterThan(1);
    expect(fixes(withRecords)).toEqual(fixes(without));
  });
});
