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
import {
  ACCOUNT_ELEMENTS,
  SEGMENT_VARIANTS,
  changesHistoryElement,
  segmentElement,
} from './_lib/screens';
import { DashboardScreen } from '../../components/v2/screens/dashboard/DashboardScreen';
import { SiteScreen } from '../../components/v2/screens/site/SiteScreen';
import { ACCOUNT_VIEWERS } from '../../app/(v2-preview)/v2-preview/_preview/accounts';
import { viewAt } from '../../lib/v2/view/account';
import { accountShellView } from '../../lib/v2/view/account-shell';
import { dashboardView } from '../../lib/v2/view/dashboard';
import { siteView } from '../../lib/v2/view/site';

/**
 * FACTS I2: the word "blocked" is said only of `disallowed_by_robots` and `blocked_by_ua_rule`,
 * and every verdict has its phrase. Each segment page, for each fixture it is previewed with, is
 * rendered and read: every verdict cell (`data-v2-verdict`) must show its vocabulary phrase and
 * glyph, and "blocked" may appear in a cell, or in a table row holding verdict cells, only where a
 * blocking verdict is. A property then puts any verdict on any cell of the matrix. The account
 * screens (dashboard, site page) are read more strictly, in what is heard as well as seen (see
 * pageProblems), with a property of their own.
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

/** What a screen reader hears that the eye may not: screen-reader-only text and aria-labels. */
const heard = (el: Element) =>
  [
    ...[...el.querySelectorAll('[data-v2-sr-only]')].map((n) => n.textContent ?? ''),
    ...[el, ...el.querySelectorAll('[aria-label]')].map((n) => n.getAttribute('aria-label') ?? ''),
  ]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The verdicts an element vouches for: its cells' and its marked lists'. */
const verdictsIn = (el: Element): Verdict[] => [
  ...[el, ...el.querySelectorAll('[data-v2-verdict]')].flatMap((c) => {
    const v = c.getAttribute('data-v2-verdict');
    return v ? [v as Verdict] : [];
  }),
  ...[el, ...el.querySelectorAll('[data-v2-verdicts]')].flatMap(
    (c) => (c.getAttribute('data-v2-verdicts') ?? '').split(' ').filter(Boolean) as Verdict[],
  ),
];

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
    // A glyph-only cell shows no words; its words are the ones it gives a screen reader.
    const text = seen(cell) || heard(cell);
    if (!text.startsWith(VERDICTS[v].label)) out.push(`${v}: "${text}" lacks its phrase`);
    if (BLOCKED.test(text) !== BLOCKING.includes(v)) out.push(`${v}: "${text}"`);
    const pill =
      cell.querySelector('[data-v2-pill]')?.getAttribute('data-v2-pill') ??
      cell.getAttribute('data-v2-check-glyph');
    if (pill !== VERDICTS[v].state) out.push(`${v}: drawn as ${pill}`);
  }
  for (const el of d.querySelectorAll('[data-v2-verdicts]')) {
    const text = `${seen(el)} ${heard(el)}`;
    if (BLOCKED.test(text) && !verdictsIn(el).some((v) => BLOCKING.includes(v))) {
      out.push(
        `"${text.slice(0, 80)}" says blocked beside ${verdictsIn(el).join(', ') || 'no verdict'}`,
      );
    }
  }
  for (const row of d.querySelectorAll('tr')) {
    const verdicts = verdictsIn(row);
    if (!verdicts.length) continue;
    const text = `${seen(row)} ${heard(row)}`;
    if (BLOCKED.test(text) && !verdicts.some((v) => BLOCKING.includes(v))) {
      out.push(`row "${text.slice(0, 80)}" says blocked beside ${verdicts.join(', ')}`);
    }
  }
  return out;
}

/**
 * The account screens' stricter reading: every "blocked" on the page, in its text or an
 * aria-label, sits in a cell, a marked list or a table row that holds a blocking verdict. It does
 * not read the SVG chart's own labels, which are hidden from assistive technology and drawn from
 * the same view model fields.
 */
function pageProblems(markup: string): string[] {
  const out: string[] = [];
  const d = doc(markup);
  const vouched = (el: Element | null): boolean => {
    for (let n = el; n; n = n.parentElement) {
      if (n.closest('svg')) return true;
      const own =
        n.hasAttribute('data-v2-verdict') ||
        n.hasAttribute('data-v2-verdicts') ||
        n.tagName === 'TR'
          ? verdictsIn(n)
          : [];
      if (own.some((v) => BLOCKING.includes(v))) return true;
    }
    return false;
  };
  const walker = d.createTreeWalker(d.body, 4 /* NodeFilter.SHOW_TEXT */);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (BLOCKED.test(t.textContent ?? '') && !vouched(t.parentElement)) {
      out.push(
        `"${(t.textContent ?? '').trim().slice(0, 80)}" says blocked with no blocking verdict`,
      );
    }
  }
  for (const el of d.querySelectorAll('[aria-label]')) {
    if (BLOCKED.test(el.getAttribute('aria-label') ?? '') && !vouched(el)) {
      out.push(
        `aria-label "${el.getAttribute('aria-label')}" says blocked with no blocking verdict`,
      );
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

  it('covers every account screen in the preview registry, counted apart from the segments', () => {
    const paths = PREVIEWS.map((p) => p.path).filter((p) =>
      /\/screens\/(dashboard|site)(\/|$)/.test(p),
    );
    expect(paths.sort()).toEqual(Object.keys(ACCOUNT_ELEMENTS).sort());
  });

  it.each(Object.keys(ACCOUNT_ELEMENTS))(
    '%s: "blocked" only beside a blocking verdict, in what is seen and what is heard',
    (path) => {
      const markup = renderToStaticMarkup(ACCOUNT_ELEMENTS[path]!());
      expect(problems(markup)).toEqual([]);
      expect(pageProblems(markup)).toEqual([]);
    },
  );

  it('keeps the rule on the dashboard and site page, whatever verdicts the primary site gets (property)', () => {
    const verdicts = VerdictSchema.options as readonly Verdict[];
    const base = fixture('bad-site');
    const outfitter = '50000000-0000-4000-8000-000000000001';
    // Runs in which a crawler change opened on a verdict that is not a block: the case the rule is for.
    let reached = 0;
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.constantFrom(...verdicts), { minLength: 8, maxLength: 8 }), {
          minLength: 6,
          maxLength: 6,
        }),
        (grid) => {
          const d = structuredClone(base);
          d.checks
            .filter((c) => c.site_id === outfitter && c.crawlers.length)
            .forEach((c, i) => c.crawlers.forEach((r, j) => (r.verdict = grid[i]![j]!)));
          // A crawler change's summary is the record's own sentence about the verdicts replaced
          // above, so it is replaced by one that says nothing of them; the record, its crawler and
          // its new verdict stay, so the view's own wording of the change is what is checked. (The
          // titles as written are checked on the fixtures as given.)
          d.changes = d.changes.map((c) =>
            c.site_id === outfitter && c.subject === 'crawler_access'
              ? { ...c, summary: `${c.ua} changed on example-outfitter.com` }
              : c,
          );
          const latest = d.checks.find((c) => c.id === 'c0000000-0000-4000-8000-000000000006')!;
          if (
            d.changes.some(
              (c) =>
                c.site_id === outfitter &&
                c.kind === 'opened' &&
                c.subject === 'crawler_access' &&
                !BLOCKING.includes(latest.crawlers.find((r) => r.ua === c.ua)!.verdict),
            )
          ) {
            reached++;
          }
          const viewer = ACCOUNT_VIEWERS.home();
          const markup = [
            renderToStaticMarkup(<DashboardScreen data={dashboardView(d, viewer)} />),
            renderToStaticMarkup(
              <SiteScreen
                data={siteView(d, viewer, outfitter)}
                shell={accountShellView(viewAt(d, viewer), 'Sites')}
              />,
            ),
          ];
          return markup.every((m) => problems(m).length === 0 && pageProblems(m).length === 0);
        },
      ),
      { numRuns: 40 },
    );
    expect(
      reached,
      'runs with a crawler change opened on a verdict that is not a block',
    ).toBeGreaterThan(0);
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
