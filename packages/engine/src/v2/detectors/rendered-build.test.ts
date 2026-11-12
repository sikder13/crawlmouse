/**
 * The client-rendered template fix through the check builder, in the detector's three states, on the
 * recorded built-site check with its render outcome edited (fixtures/v2/build/rendered-states.ts).
 */
import { describe, expect, it } from 'vitest';
import { FixSchema } from '@crawlmouse/types/v2';
import {
  PRODUCTS,
  recordedWith,
  SHELL_RAW_WORDS,
} from '../../../fixtures/v2/build/rendered-states.js';
import { recordedBuild } from '../../../fixtures/v2/build/recorded.js';
import { buildCheck } from '../build/build.js';
import { DETECTORS_RUN } from '../build/diff.js';
import type { BuildInput, BuiltCheck } from '../build/types.js';
import { effectsOf } from '../grade/effects.js';
import { round } from '../grade/numbers.js';
import { readableScore } from '../grade/readable.js';
import { isGraded } from '../grade/technical-seo.js';
import { fingerprintOf } from './fingerprint.js';
import { detectRendered } from './rendered.js';

const FINGERPRINT = fingerprintOf(`shell:${PRODUCTS}`);
const shellFix = (b: BuiltCheck) => b.fixes.filter((f) => f.type === 'client_rendered_template');
const recordOf = (b: BuiltCheck) =>
  detectRendered(b.page_results).find((r) => r.template_key === PRODUCTS)!;

/** The next check of the site after `first`, on `input`'s rows. */
function nextCheck(first: BuiltCheck, input: BuildInput): BuiltCheck {
  const id = 'b0000000-0000-4000-8000-0000000000c2';
  const renamed = <T>(v: T): T => JSON.parse(JSON.stringify(v).replaceAll(first.check.id, id)) as T;
  return buildCheck({
    ...input,
    check: {
      ...input.check,
      id,
      previous_check_id: first.check.id,
      trigger: 'fix_recheck',
      queued_at: '2026-11-06T10:00:00Z',
      started_at: '2026-11-06T10:00:02Z',
      finished_at: '2026-11-06T10:11:00Z',
    },
    previous: { check: first.check, ...first.diff_inputs },
    fixes: first.fixes,
    events: first.fix_events,
    batches: renamed(input.batches),
    render: renamed(input.render),
  });
}

describe('the detector runs on every built check', () => {
  it('is listed among the detectors the diff reads, and js_only_navigation is not', () => {
    expect(DETECTORS_RUN).toContain('client_rendered_template');
    expect(DETECTORS_RUN).not.toContain('js_only_navigation');
    expect(buildCheck(recordedBuild()).diff_inputs.detectors).toContain('client_rendered_template');
  });
});

describe('detected: every rendered page of the template is an empty shell', () => {
  const built = buildCheck(recordedWith('shell'));
  const [fix] = shellFix(built);

  it('opens one fix for the template, with its packet and its template key', () => {
    expect(shellFix(built)).toHaveLength(1);
    const graded = built.page_results.filter((p) => isGraded(p) && p.template_key === PRODUCTS);
    const rendered = graded.filter((p) => p.without_js !== null);
    expect(rendered.length).toBeGreaterThanOrEqual(2);
    expect(rendered.length).toBeLessThan(graded.length);
    expect(fix).toMatchObject({
      fingerprint: FINGERPRINT,
      status: 'open',
      section: 'without_js',
      title: 'Serve the text of product pages without JavaScript',
      template_key: PRODUCTS,
      affected_pages: graded.length,
      crawler_uas: [],
      confidence: 'confirmed',
      recommendation_class: 'documented_requirement',
    });
    expect(FixSchema.safeParse(fix).success).toBe(true);
    expect(fix!.packet!.frameworks).toEqual(['generic', 'nextjs', 'shopify_hydrogen']);
    expect(fix!.packet!.context[0]).toBe(
      `The template \`${PRODUCTS}\` serves its main content by JavaScript. The audit rendered ${rendered.length} of its ${graded.length} graded pages in a browser, and without JavaScript each of them is an empty shell.`,
    );
    expect(fix!.packet!.context[1]).toBe(
      `\`${rendered.map((p) => p.url).sort()[0]}\`: ${SHELL_RAW_WORDS} words in the HTML response, 170 once rendered.`,
    );
  });

  it('has an effect on AI readability: Readable, recomputed with the template read in full', () => {
    // AI readability is withheld on this check (no content check counts in Quotable yet, SPEC 17),
    // so the stored effect waits on the grade's reasons; with Quotable scored it is the Readable
    // recompute.
    expect(built.grades.ai_readability.withheld).toBe(true);
    expect(fix!.effect.ai_readability).toBe(null);
    expect(fix!.effect.ai_readability_pending_on).toEqual(
      built.grades.ai_readability.withheld_reasons,
    );
    const inputs = {
      ...built.grades.inputs,
      ai: {
        ...built.grades.inputs.ai,
        quotable: { checks: { author_and_date: { passing: 1, decided: 1, unread: 0 } } },
      },
    };
    const { byFix } = effectsOf(inputs, [{ family: 'rendered', record: recordOf(built) }]);
    const before = readableScore(inputs.ai.readable).score!;
    const after = readableScore(
      inputs.ai.readable.map((p) => (p.template_key === PRODUCTS ? { ...p, text_share: 1 } : p)),
    ).score!;
    expect(after).toBeGreaterThan(before);
    expect(byFix.get(FINGERPRINT)!.effect.ai_readability).toBe(round(after - before));
  });

  it('is rendered on two pages by the next check’s render plan, which reads its template key', () => {
    expect(fix!.template_key).toBe(PRODUCTS);
  });
});

describe('not detected: a rendered page of the template, and no shell among them', () => {
  it('opens no fix on a first check', () => {
    const built = buildCheck(recordedBuild());
    expect(recordOf(built).state).toBe('not_detected');
    expect(detectRendered(built.page_results).filter((r) => r.state === 'detected')).toEqual([]);
    expect(shellFix(built)).toEqual([]);
    expect(built.diff_inputs.indeterminate).not.toContain(FINGERPRINT);
  });

  it('resolves the fix an earlier check opened', () => {
    const first = buildCheck(recordedWith('shell'));
    const next = nextCheck(first, recordedBuild());
    const [before] = shellFix(first);
    const after = next.fixes.find((f) => f.id === before!.id)!;
    expect(after).toMatchObject({ status: 'verified_resolved', last_state: 'not_detected' });
    expect(next.fix_events).toContainEqual(
      expect.objectContaining({ fix_id: before!.id, kind: 'verified' }),
    );
  });
});

describe('indeterminate: the template was not rendered, or its rendered pages disagree', () => {
  it('opens no fix for a template with no rendered page, and reports it as not decided', () => {
    const built = buildCheck(recordedWith('not_rendered'));
    expect(recordOf(built)).toMatchObject({ state: 'indeterminate', reason: 'not_rendered' });
    expect(shellFix(built)).toEqual([]);
    expect(built.diff_inputs.indeterminate).toContain(FINGERPRINT);
  });

  it('opens no fix when one rendered page is a shell and the others are not', () => {
    const built = buildCheck(recordedWith('one_shell'));
    expect(recordOf(built)).toMatchObject({ state: 'indeterminate', reason: 'pages_disagree' });
    expect(shellFix(built)).toEqual([]);
    expect(built.diff_inputs.indeterminate).toContain(FINGERPRINT);
  });

  it('leaves an open fix open when the next check did not render the template', () => {
    const first = buildCheck(recordedWith('shell'));
    const next = nextCheck(first, recordedWith('not_rendered'));
    const [before] = shellFix(first);
    const after = next.fixes.find((f) => f.id === before!.id);
    expect(after).toMatchObject({ status: 'open', last_state: 'indeterminate' });
    expect(next.fix_events).toEqual([]);
  });
});
