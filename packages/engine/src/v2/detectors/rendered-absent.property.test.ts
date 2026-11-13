/**
 * CC-32 D3, over generated checks: every client-rendered fix still waiting on rendering
 * (AWAITING_FIX_STATUSES) gets a record from the detector, whatever pages the check holds, and the
 * diff gives its fingerprint an outcome, so the fix is measured on this check (its
 * `last_measured_check_id` moves to it). Whether it then closes is the lifecycle's rule, not this one.
 *
 * Generated: up to four templates, each with graded, empty-root and other thin pages or none, each
 * page rendered as a shell, as readable or not at all; and a fix on some of the templates and on
 * templates the check holds no page of, at any status. Events are dated on the previous check, before
 * this one finished (diff.ts reads a later event as the owner acting after the measurement).
 */
import { FixStatusSchema, type Fix, type FixEvent } from '@crawlmouse/types/v2';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkId, draft, fixWithHistory, side } from '../../../fixtures/v2/diff/builders.js';
import { AWAITING_FIX_STATUSES, awaitingShellTemplates } from '../build/plan.js';
import { diffCheck } from '../diff/diff.js';
import type { DetectorOutcome } from '../diff/types.js';
import { fingerprintOf } from './fingerprint.js';
import { detectRendered, SHELL_KEY_PREFIX, type RenderedInputPage } from './rendered.js';

const TEMPLATES = ['/a/{slug}', '/b/{slug}', '/c/{slug}', '/d/{slug}', '/gone/{slug}'];

const pageArb = fc.record({
  template: fc.constantFrom(...TEMPLATES.slice(0, 4)),
  role: fc.constantFrom('graded', 'empty_root', 'other_thin'),
  render: fc.constantFrom('shell', 'readable', 'none'),
});

const fixArb = fc.uniqueArray(
  fc.record({
    template: fc.constantFrom(...TEMPLATES),
    status: fc.constantFrom(...FixStatusSchema.options),
  }),
  { selector: (f) => f.template, maxLength: TEMPLATES.length },
);

function pagesOf(rows: { template: string; role: string; render: string }[]) {
  const emptyRoots = new Set<string>();
  const pages = rows.map((r, i): RenderedInputPage => {
    const url = `https://a.test${r.template.replace('{slug}', String(i))}`;
    if (r.role === 'empty_root') emptyRoots.add(url);
    return {
      url,
      template_key: r.template,
      kind: r.role === 'graded' ? 'content' : 'thin',
      status_code: 200,
      is_html: true,
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

function fixesOf(rows: { template: string; status: Fix['status'] }[]) {
  const fixes: Fix[] = [];
  const events: FixEvent[] = [];
  rows.forEach((r, i) => {
    const made = fixWithHistory(i + 1, r.status, { type: 'client_rendered_template' });
    fixes.push({
      ...made.fix,
      fingerprint: fingerprintOf(`${SHELL_KEY_PREFIX}:${r.template}`),
      template_key: r.template,
      rank: made.fix.rank === null ? null : i + 1,
    });
    events.push(...made.events);
  });
  return { fixes, events };
}

describe('an awaiting client-rendered fix is always measured (property, CC-32 D3)', () => {
  it('gets a record, and the diff moves its last measurement to this check', () => {
    fc.assert(
      fc.property(fc.array(pageArb, { maxLength: 12 }), fixArb, (pageRows, fixRows) => {
        const { pages, emptyRoots } = pagesOf(pageRows);
        const { fixes, events } = fixesOf(fixRows);
        const records = detectRendered(pages, {
          emptyRoots,
          openTemplates: awaitingShellTemplates(fixes),
        });
        const awaiting = fixes.filter(
          (f) => f.type === 'client_rendered_template' && AWAITING_FIX_STATUSES.includes(f.status),
        );
        const byFingerprint = new Map(records.map((r) => [r.fingerprint, r]));
        for (const f of awaiting)
          expect(byFingerprint.has(f.fingerprint), f.template_key!).toBe(true);
        // a template with no present page is the one case the reason names
        for (const r of records) {
          expect(r.reason === 'template_absent').toBe(r.extent.pages === 0);
        }

        const outcomes = records.map((r): DetectorOutcome => {
          if (r.state === 'detected') {
            return {
              fingerprint: r.fingerprint,
              state: 'detected',
              fix: draft('client_rendered_template', {
                template_key: r.template_key,
                affected_pages: r.affected_urls.length,
              }),
            };
          }
          return r.state === 'not_detected'
            ? { fingerprint: r.fingerprint, state: 'not_detected' }
            : { fingerprint: r.fingerprint, state: 'indeterminate', gone: null };
        });
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
        const after = new Map(result.fixes.map((f) => [f.fingerprint, f]));
        for (const f of awaiting) {
          expect(after.get(f.fingerprint)?.last_measured_check_id, f.template_key!).toBe(
            checkId(2),
          );
        }
      }),
      { numRuns: 400 },
    );
  });
});
