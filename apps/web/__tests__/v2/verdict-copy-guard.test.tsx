import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { VerdictSchema, type Check, type Verdict } from '@crawlmouse/types/v2';
import { AccessScreen } from '../../components/v2/screens/segment/AccessScreen';
import { VERDICTS } from '../../components/v2/verdicts';
import { PILL_STATES } from '../../components/v2/pill-states';
import { PREVIEWS } from '../../app/(v2-preview)/v2-preview/_preview/registry';
import { findCheck, fixture } from '../../lib/v2/fixtures';
import { CHECKS } from '../../lib/v2/recordings';
import { accessView } from '../../lib/v2/view/segment/access';
import type { SegmentKey } from '../../lib/v2/view/segment/frame';
import { SEGMENT_VARIANTS, changesHistoryElement, segmentElement } from './_lib/screens';

/**
 * FACTS I2: the word "blocked" is said only of `disallowed_by_robots` and `blocked_by_ua_rule`,
 * and every verdict has its phrase. Each segment page, for each fixture it is previewed with, is
 * rendered and read: every verdict cell (`data-v2-verdict`) must show its vocabulary phrase and
 * glyph, and "blocked" may appear in a cell, or in a table row holding verdict cells, only where a
 * blocking verdict is. A property then puts any verdict on any cell of the matrix.
 */
const BLOCKING: readonly Verdict[] = ['disallowed_by_robots', 'blocked_by_ua_rule'];
const BLOCKED = /\bblocked\b/i;

const doc = (markup: string) => new JSDOM(`<body>${markup}</body>`).window.document;
/** Visible text: screen-reader-only words removed, as the eye reads the cell. */
const seen = (el: Element) => {
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll('[data-v2-sr-only], svg').forEach((n) => n.remove());
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
};

/** Every problem the rule finds on one rendered page. */
function problems(markup: string): string[] {
  const out: string[] = [];
  const d = doc(markup);
  for (const cell of d.querySelectorAll('[data-v2-verdict]')) {
    const v = cell.getAttribute('data-v2-verdict') as Verdict;
    if (!Object.hasOwn(VERDICTS, v)) {
      out.push(`unknown verdict ${v}`);
      continue;
    }
    const text = seen(cell);
    if (!text.startsWith(VERDICTS[v].label)) out.push(`${v}: "${text}" lacks its phrase`);
    if (BLOCKED.test(text) !== BLOCKING.includes(v)) out.push(`${v}: "${text}"`);
    const pill = cell.querySelector('[data-v2-pill]')?.getAttribute('data-v2-pill');
    if (pill !== VERDICTS[v].state) out.push(`${v}: drawn as ${pill}`);
  }
  for (const row of d.querySelectorAll('tr')) {
    const verdicts = [...row.querySelectorAll('[data-v2-verdict]')].map(
      (c) => c.getAttribute('data-v2-verdict') as Verdict,
    );
    if (!verdicts.length) continue;
    if (BLOCKED.test(seen(row)) && !verdicts.some((v) => BLOCKING.includes(v))) {
      out.push(`row "${seen(row).slice(0, 80)}" says blocked beside ${verdicts.join(', ')}`);
    }
  }
  return out;
}

const SEGMENTS: SegmentKey[] = ['access', 'nojs', 'structure', 'content', 'signals', 'changes'];

describe('verdict copy guard', () => {
  it('covers every segment page in the preview registry', () => {
    const paths = PREVIEWS.map((p) => p.path).filter((p) => p.includes('/screens/segment/'));
    expect(paths).toHaveLength(SEGMENTS.length * SEGMENT_VARIANTS.length + 2);
  });

  it.each(SEGMENTS.flatMap((s) => SEGMENT_VARIANTS.map((v) => [s, v] as const)))(
    '%s, %s: "blocked" only beside a blocking verdict, and every verdict with its phrase',
    (segment, variant) => {
      expect(problems(renderToStaticMarkup(segmentElement(segment, variant)))).toEqual([]);
    },
  );

  it.each(['history', 'challenged-history'] as const)('changes, %s: the same', (name) => {
    expect(problems(renderToStaticMarkup(changesHistoryElement(name)))).toEqual([]);
  });

  it('gives each of the eleven verdicts a phrase and a status glyph', () => {
    expect(Object.keys(VERDICTS).sort()).toEqual([...VerdictSchema.options].sort());
    for (const v of VerdictSchema.options) {
      expect(VERDICTS[v].label.length, v).toBeGreaterThan(0);
      expect(PILL_STATES[VERDICTS[v].state], v).toBeDefined();
    }
  });

  it('shows the matrix with the rule kept, whatever verdicts the crawlers get (property)', () => {
    const verdicts = VerdictSchema.options as readonly Verdict[];
    const base = fixture('bad-site');
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.constantFrom(...verdicts), { minLength: 4, maxLength: 4 }), {
          minLength: 6,
          maxLength: 6,
        }),
        (grid) => {
          const d = structuredClone(base);
          const check: Check = findCheck(d, CHECKS.badFirstAudit);
          check.crawlers
            .filter((c) => c.group !== 'search_engine')
            .forEach((c, i) => {
              c.by_template = c.by_template.map((t, j) => ({ ...t, verdict: grid[i]![j]! }));
            });
          const markup = renderToStaticMarkup(
            <AccessScreen data={accessView(d, CHECKS.badFirstAudit, { asFirstSeen: true })} />,
          );
          const found = problems(markup);
          const shown = new Set(
            [...doc(markup).querySelectorAll('[data-v2-verdict]')].map((c) =>
              c.getAttribute('data-v2-verdict'),
            ),
          );
          return found.length === 0 && grid.flat().every((v) => shown.has(v));
        },
      ),
      { numRuns: 60 },
    );
  });
});
