/**
 * The audit views on measured checks (CC-22b D4, plan-review 15): checks built by the engine's
 * builder, from generated crawls and from variants of the recorded site, each as a first audit and
 * as a re-check, render each view (`everyView`) without a throw.
 *
 * The checks are built in memory (`datasetOfBuilds`), not persisted: a PGlite round trip per case
 * is too slow for a property. `app/audit/[id]/_lib/real-data.test.tsx` holds `datasetOfBuilds`
 * against the database's read-back for the recorded site and its re-check.
 *
 * No check built here has a graded AI readability (the recorded site's is withheld, and a generated
 * site has no render), so that branch is run on the contract fixtures instead, with each template
 * labelled by its key as the engine labels one.
 *
 * After the runs the test asserts the shapes it met, so a generator that stops producing one of
 * them fails here instead of passing on less.
 */
import { buildCheck, type BuildInput, type BuiltCheck } from '@crawlmouse/engine/v2/pipeline';
import type { BatchResult } from '@crawlmouse/types/v2';
import fc from 'fast-check';
import { coverageText, type Coverage } from '../../../components/v2/CoverageLine';
import { describe, expect, it } from 'vitest';
import { recordedBuild } from '../../../../../packages/engine/fixtures/v2/build/recorded';
import { fixture } from '../fixtures';
import { secondInput } from '../pipeline/test-support/public-checks';
import { CHECKS } from '../recordings';
import { FREE_FIXES } from './free-fixes';
import { partialNotice } from './result';
import { datasetOfBuilds } from './test-support/built-dataset';
import { everyView } from './test-support/every-view';
import { inputOf, recheckInputOf, siteShape } from './test-support/generated-check';

/** What the runs met, by a name the last test reads. */
const met = new Map<string, number>();
const note = (name: string, when = true) => {
  if (when) met.set(name, (met.get(name) ?? 0) + 1);
};

/** Every `{ tested, total, groups }` in a value: the props of a screen's coverage line. */
function coveragesIn(value: unknown): Coverage[] {
  if (Array.isArray(value)) return value.flatMap(coveragesIn);
  if (!value || typeof value !== 'object') return [];
  const o = value as Record<string, unknown>;
  const own =
    typeof o.tested === 'number' && typeof o.total === 'number' && typeof o.groups === 'number'
      ? [o as unknown as Coverage]
      : [];
  return [...own, ...Object.values(o).flatMap(coveragesIn)];
}

function render(input: BuildInput, builds: readonly BuiltCheck[]) {
  const d = datasetOfBuilds(input.site, builds);
  const check = builds.at(-1)!.check;
  const views = everyView(d, check.id);
  const live = views.result.fixes?.total ?? 0;
  // Each coverage line a screen draws: `coverageText` refuses counts that cannot be true together.
  for (const c of coveragesIn(views)) coverageText(c);
  note(check.status);
  note('zero pages', d.page_results.length === 0);
  note('text without JavaScript not measured', check.without_js === null);
  note('text without JavaScript measured', check.without_js !== null);
  note('AI readability withheld', check.ai_readability!.withheld);
  note('AI readability graded', !check.ai_readability!.withheld);
  note('Technical SEO not graded', check.technical_seo!.grade === null);
  note('Technical SEO graded', check.technical_seo!.grade !== null);
  note('no fix', live === 0);
  note('fewer fixes than Free opens', live > 0 && live < FREE_FIXES);
  note('exactly the fixes Free opens', live === FREE_FIXES);
  note('more fixes than Free opens', live > FREE_FIXES);
  note('a re-check', check.previous_check_id !== null);
  note('a re-check with changes', d.changes.length > 0 && check.previous_check_id !== null);
  note(
    'a resolved fix',
    views.fixes.some((f) => f.kind === 'resolved'),
  );
  note(
    'a locked fix',
    views.fixes.some((f) => f.kind === 'locked'),
  );
  note(
    'a crawler not measured',
    check.crawlers.some((c) => c.verdict === 'not_measured'),
  );
  note(
    'a crawler kept out',
    check.crawlers.some((c) => c.verdict === 'challenged_ua'),
  );
  note('no drawable page', views.mapAll.nodes.length === 0);
  return { d, check, views };
}

describe('each view renders a generated measured check', () => {
  it('a generated site, as a first audit and as its re-check', () => {
    fc.assert(
      fc.property(siteShape, siteShape, (a, b) => {
        note('homepage ' + a.home);
        note('crawl stopped on its budget', a.capped);
        const input = inputOf(a);
        const first = buildCheck(input);
        const { check, d, views } = render(input, [first]);
        // Held to the check's own rows, not to another rendering of them.
        expect(views.result.map.pages).toBe(d.page_results.length);
        expect(views.resultUndrawn.map.nodes).toBeNull();
        expect(views.resultPro.fixes?.pro ?? 0).toBe(0);
        expect((views.result.fixes?.open ?? 0) <= FREE_FIXES).toBe(true);
        expect(partialNotice(d, check.id) === null).toBe(check.status === 'finished');
        const second = buildCheck(recheckInputOf(b, first));
        const again = render(input, [first, second]);
        expect(again.views.changes.state).toBe('changes');
        expect(again.views.changes.rows).toHaveLength(again.d.changes.length);
      }),
      { numRuns: 120, seed: 20261110 },
    );
  });

  /** The recorded site with its render and access batches kept or dropped, and `untitled` empty titles. */
  function recordedVariant(render_: boolean, access: boolean, untitled: number): BuildInput {
    const input = recordedBuild();
    let left = untitled;
    const batches = (input.batches as BatchResult[]).flatMap((b): BatchResult[] => {
      if (b.kind !== 'crawl') return access ? [b] : [];
      return [
        {
          ...b,
          pages: b.pages.map((p) =>
            p.title && p.url.includes('/products/') && left-- > 0
              ? { ...p, title: { text: '', chars: 0, cut: false } }
              : p,
          ),
        },
      ];
    });
    // The render's pages are chosen from the crawler tests, so the builder takes it only with them.
    return { ...input, batches, render: render_ && access ? input.render : null };
  }

  it('the recorded site, with and without its render and crawler tests, and its re-check', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), fc.nat(6), (render_, access, untitled) => {
        const input = recordedVariant(render_, access, untitled);
        const first = buildCheck(input);
        const { views, d } = render(input, [first]);
        const live = views.result.fixes?.total ?? 0;
        expect(views.result.fixes?.open ?? 0).toBe(Math.min(live, FREE_FIXES));
        expect(views.fixes.filter((f) => f.kind === 'locked')).toHaveLength(
          // one view of each fix on Free, one on Pro: Free locks what it does not open
          Math.max(0, live - FREE_FIXES),
        );
        expect(views.mapHubs.nodes.length).toBeGreaterThan(0);
        expect(views.mapAll.nodes.length).toBeLessThanOrEqual(d.page_results.length);
        render(input, [first, buildCheck(secondInput(first))]);
      }),
      { numRuns: 24, seed: 20261110 },
    );
  });

  it.each([
    ['bad-site', CHECKS.badFirstAudit],
    ['clean-site', CHECKS.cleanFirstAudit],
    ['challenged-site', CHECKS.challengedFirstAudit],
  ] as const)('%s with its templates labelled by their keys', (name, checkId) => {
    const d = fixture(name);
    const keyed = {
      ...d,
      checks: d.checks.map((c) =>
        c.coverage
          ? {
              ...c,
              coverage: {
                ...c.coverage,
                templates: c.coverage.templates.map((t) => ({ ...t, label: t.template_key })),
              },
            }
          : c,
      ),
    };
    const views = everyView(keyed, checkId);
    note('AI readability graded', !views.result.grades[1].withheld);
    expect(views.result.doors).toHaveLength(6);
  });

  it('met each shape real data can take that no preview shows', () => {
    const wanted = [
      'finished',
      'partial',
      'zero pages',
      'text without JavaScript not measured',
      'text without JavaScript measured',
      'AI readability withheld',
      'AI readability graded',
      'Technical SEO not graded',
      'Technical SEO graded',
      'no fix',
      'fewer fixes than Free opens',
      'exactly the fixes Free opens',
      'more fixes than Free opens',
      'a re-check',
      'a re-check with changes',
      'a resolved fix',
      'a locked fix',
      'a crawler not measured',
      'a crawler kept out',
      'no drawable page',
      'homepage ok',
      'homepage error',
      'homepage not_requested',
      'homepage offhost',
      'crawl stopped on its budget',
    ];
    expect(wanted.filter((name) => !met.has(name))).toEqual([]);
  });
});
