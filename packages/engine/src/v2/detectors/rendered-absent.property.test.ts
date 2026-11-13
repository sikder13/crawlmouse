/**
 * CC-32 D3: every client-rendered fix still waiting on rendering gets a record from the detector,
 * whatever pages the check holds, and the diff measures it on this check (its `last_measured_check_id`
 * moves to it). The records go through the real `detectorOutcomes` and `diffCheck`. Whether a fix then
 * closes is the lifecycle's rule, not this one.
 *
 * The statuses that wait are written here as a literal, not read from the code under test. Generated:
 * pages of four templates, each graded, an empty-root page, another thin page, a page answering 404,
 * or a page not served as HTML, rendered as a shell, as readable or not at all; and fixes on those
 * templates, on a template the check holds no page of, and with no template key, at any status. Events
 * are dated on the previous check, before this one finished (diff.ts reads a later event as the owner
 * acting after the measurement).
 *
 * A fix with no template key cannot be named by template, so it gets no record and the diff leaves it
 * as it was: the property states that too. Each fix the detector opens carries its record's template
 * key, which is never null.
 */
import { FixStatusSchema, type Fix, type FixEvent, type FixStatus } from '@crawlmouse/types/v2';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkId, fixWithHistory, side } from '../../../fixtures/v2/diff/builders.js';
import { csrSite } from '../../../fixtures/v2/grade/sites.js';
import { awaitingShellTemplates } from '../build/plan.js';
import { diffCheck } from '../diff/diff.js';
import { gradeCheck } from '../grade/index.js';
import { detectorOutcomes, NOTHING_WRITTEN } from '../grade/outcomes.js';
import { fingerprintOf } from './fingerprint.js';
import { detectRendered, SHELL_KEY_PREFIX, type RenderedInputPage } from './rendered.js';

/** The statuses in which a client-rendered fix waits on rendering, as the product defines them. */
const AWAITING: readonly FixStatus[] = ['open', 'reopened', 'marked_done'];

const TEMPLATES = ['/a/{slug}', '/b/{slug}', '/c/{slug}', '/d/{slug}', '/gone/{slug}'];
const GRADES = gradeCheck(csrSite(0.31));

const pageArb = fc.record({
  template: fc.constantFrom(...TEMPLATES.slice(0, 4)),
  role: fc.constantFrom('graded', 'empty_root', 'other_thin', 'not_found', 'not_html'),
  render: fc.constantFrom('shell', 'readable', 'none'),
});

const fixArb = fc.uniqueArray(
  fc.record({
    template: fc.constantFrom<string | null>(...TEMPLATES, null),
    status: fc.constantFrom(...FixStatusSchema.options),
  }),
  { selector: (f) => f.template ?? '(none)', minLength: 1, maxLength: TEMPLATES.length + 1 },
);

type PageRow = { template: string; role: string; render: string };
type FixRow = { template: string | null; status: FixStatus };

function pagesOf(rows: readonly PageRow[]) {
  const emptyRoots = new Set<string>();
  const pages = rows.map((r, i): RenderedInputPage => {
    const url = `https://a.test${r.template.replace('{slug}', String(i))}`;
    if (r.role === 'empty_root') emptyRoots.add(url);
    const content = r.role === 'graded' || r.role === 'not_found' || r.role === 'not_html';
    return {
      url,
      template_key: r.template,
      kind: content ? 'content' : 'thin',
      status_code: r.role === 'not_found' ? 404 : 200,
      is_html: r.role !== 'not_html',
      without_js:
        r.render === 'none'
          ? null
          : r.render === 'shell'
            ? { raw_words: 0, rendered_words: 100, text_share: 0, state: 'empty_shell' }
            : { raw_words: 100, rendered_words: 100, text_share: 1, state: 'readable' },
    };
  });
  return { pages, emptyRoots };
}

function fixesOf(rows: readonly FixRow[]) {
  const fixes: Fix[] = [];
  const events: FixEvent[] = [];
  rows.forEach((r, i) => {
    const made = fixWithHistory(i + 1, r.status, { type: 'client_rendered_template' });
    fixes.push({
      ...made.fix,
      // a fix with no template key keeps the builder's fingerprint: no template names it
      fingerprint:
        r.template === null
          ? made.fix.fingerprint
          : fingerprintOf(`${SHELL_KEY_PREFIX}:${r.template}`),
      template_key: r.template,
      rank: made.fix.rank === null ? null : i + 1,
    });
    events.push(...made.events);
  });
  return { fixes, events };
}

/** The real path: the detector, the outcomes with their effects and drafts, and the diff. */
function measure(pageRows: readonly PageRow[], fixRows: readonly FixRow[]) {
  const { pages, emptyRoots } = pagesOf(pageRows);
  const { fixes, events } = fixesOf(fixRows);
  const records = detectRendered(pages, {
    emptyRoots,
    openTemplates: awaitingShellTemplates(fixes),
  });
  const { outcomes } = detectorOutcomes(GRADES, [], [], records, NOTHING_WRITTEN);
  const indeterminate = outcomes
    .filter((o) => o.state === 'indeterminate')
    .map((o) => o.fingerprint)
    .sort();
  const result = diffCheck({
    previous: side(1),
    current: side(2, undefined, { indeterminate }),
    fixes,
    events,
    outcomes,
  });
  return { fixes, records, outcomes, result };
}

describe('an awaiting client-rendered fix is always measured (CC-32 D3)', () => {
  it('a fix marked done on a template the check no longer holds: template_absent, then unable_to_verify', () => {
    const { records, result } = measure(
      [{ template: '/a/{slug}', role: 'graded', render: 'readable' }],
      [{ template: '/gone/{slug}', status: 'marked_done' }],
    );
    expect(records.find((r) => r.template_key === '/gone/{slug}')).toMatchObject({
      state: 'indeterminate',
      reason: 'template_absent',
    });
    expect(result.fixes.find((f) => f.template_key === '/gone/{slug}')).toMatchObject({
      status: 'unable_to_verify',
      last_state: 'indeterminate',
      last_measured_check_id: checkId(2),
    });
  });

  it('gets a record, and the diff moves its last measurement to this check (property)', () => {
    fc.assert(
      fc.property(
        fc.array(pageArb, { minLength: 1, maxLength: 12 }),
        fixArb,
        (pageRows, fixRows) => {
          const { fixes, records, outcomes, result } = measure(pageRows, fixRows);
          const byFingerprint = new Map(records.map((r) => [r.fingerprint, r]));
          const after = new Map(result.fixes.map((f) => [f.fingerprint, f]));
          for (const f of fixes) {
            if (AWAITING.includes(f.status) && f.template_key !== null) {
              expect(byFingerprint.has(f.fingerprint), f.template_key).toBe(true);
              expect(after.get(f.fingerprint)?.last_measured_check_id, f.template_key).toBe(
                checkId(2),
              );
            }
            if (f.template_key === null) {
              expect(byFingerprint.has(f.fingerprint)).toBe(false);
              expect(
                after.get(f.fingerprint)?.last_measured_check_id ?? f.last_measured_check_id,
              ).toBe(f.last_measured_check_id);
            }
          }
          // a template with no present page is the one case the reason names
          for (const r of records)
            expect(r.reason === 'template_absent').toBe(r.extent.pages === 0);
          // each fix the detector opens carries its record's template key
          for (const o of outcomes) {
            if (o.state !== 'detected') continue;
            expect(o.fix.template_key).toBe(byFingerprint.get(o.fingerprint)!.template_key);
            expect(o.fix.template_key).not.toBeNull();
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
