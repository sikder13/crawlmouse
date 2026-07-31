import { describe, it, expect } from 'vitest';
import { buildExecutiveSummary, summarizeFindings, buildMethodology } from './report-content';
import { findingMeta } from '@/components/audit/finding-meta';
import type { PublicReportSnapshot } from '@crawlmouse/types';

// SPEC 04 §4 (V7) — the client-ready report's DETERMINISTIC content, assembled from the frozen
// snapshot with no LLM (D3): same snapshot → byte-identical output. Honesty (§11 + the honesty guard):
// it sells the GRADE and discoverability, never rankings/traffic. All strings are plain React text at
// render; these builders return data/plain strings only.

const snap = (over: Partial<PublicReportSnapshot> = {}): PublicReportSnapshot => ({
  version: 1,
  domain: 'ex.com',
  grade: 'C',
  score: 63.66,
  cms: 'wordpress',
  mintedAt: '2026-07-07T12:00:00.000Z',
  pageCount: 42,
  orphanCount: 5,
  avgDepth: 2.4,
  confidence: 'high',
  coveragePct: 0.98,
  estimatedTotal: 43,
  findings: [
    { category: 'orphan', severity: 'critical', pageUrl: 'https://ex.com/a' },
    { category: 'orphan', severity: 'critical', pageUrl: 'https://ex.com/b' },
    { category: 'deep_page', severity: 'medium', pageUrl: 'https://ex.com/deep' },
  ],
  ledger: [
    { category: 'orphan', targetUrl: 'https://ex.com/a', targetTitle: 'A', marginalDelta: 5.1, effort: 'low', rationale: 'r' },
  ],
  ledgerDisclaimer: 'Each impact is an individual estimate…',
  projected: { grade: 'B', score: 76.09 },
  ...over,
});

// The narrow, positive rankings/traffic PROMISES the honesty guard forbids (mirrors its patterns).
const PROMISE = /rank(s|ing)?\s+higher|\boutrank\b|more\s+traffic|drive\s+traffic|boost\s+(your\s+)?(seo|traffic|ranking)|guaranteed?\s+(ranking|traffic)/i;

describe('buildExecutiveSummary', () => {
  it('is deterministic — same snapshot → identical sentences', () => {
    expect(buildExecutiveSummary(snap())).toEqual(buildExecutiveSummary(snap()));
  });

  it('leads with the grade, score, and domain, and is 3–5 sentences', () => {
    const s = buildExecutiveSummary(snap());
    expect(s.length).toBeGreaterThanOrEqual(3);
    expect(s.length).toBeLessThanOrEqual(5);
    expect(s[0]).toContain('ex.com');
    expect(s[0]).toContain('C');
    expect(s[0]).toContain('64'); // 63.66 rounded
  });

  it('names the top issue categories with counts (by their plain-language labels)', () => {
    const joined = buildExecutiveSummary(snap()).join(' ');
    expect(joined.toLowerCase()).toContain('orphan');
    expect(joined).toContain('5'); // 5 orphans (the orphanCount)
  });

  it('states the achievable grade when a projection exists, framed as a GRADE gain (not traffic)', () => {
    const joined = buildExecutiveSummary(snap()).join(' ');
    expect(joined).toContain('B'); // achievable grade
    expect(joined).not.toMatch(PROMISE);
  });

  it('never promises rankings/traffic in any sentence (honesty)', () => {
    for (const sentence of buildExecutiveSummary(snap())) expect(sentence).not.toMatch(PROMISE);
    // a strong passing site must stay honest too
    for (const sentence of buildExecutiveSummary(snap({ grade: 'A', score: 94, orphanCount: 0, findings: [], projected: null })))
      expect(sentence).not.toMatch(PROMISE);
  });

  it('a clean site (no findings) reads as positive, without inventing issues', () => {
    const s = buildExecutiveSummary(snap({ grade: 'A', score: 93, orphanCount: 0, findings: [], projected: null }));
    const joined = s.join(' ').toLowerCase();
    expect(joined).toContain('a'); // the grade
    expect(joined).not.toContain('orphan'); // never fabricated
  });

  it('caveats a low-confidence / partial crawl as an estimate', () => {
    const joined = buildExecutiveSummary(snap({ confidence: 'low' })).join(' ').toLowerCase();
    expect(joined).toMatch(/estimate|partial|couldn.t reach|incomplete/);
  });
});

describe('summarizeFindings', () => {
  it('groups by category with counts and the plain-language what/why (deterministic order by count desc)', () => {
    const groups = summarizeFindings(snap());
    expect(groups.map((g) => g.category)).toEqual(['orphan', 'deep_page']); // orphan(2) before deep_page(1)
    expect(groups[0]!.count).toBe(2);
    expect(groups[0]!.label.toLowerCase()).toContain('orphan');
    expect(groups[0]!.what.length).toBeGreaterThan(0);
    expect(groups[0]!.why.length).toBeGreaterThan(0);
  });

  it('is empty for a clean site', () => {
    expect(summarizeFindings(snap({ findings: [] }))).toEqual([]);
  });
});

describe('buildMethodology', () => {
  it('states the honest coverage "N of ~M pages" and the confidence', () => {
    const m = buildMethodology(snap());
    expect(m).toContain('42');
    expect(m).toContain('43'); // ~M
    expect(m.toLowerCase()).toContain('confidence');
  });

  it('omits "~M" when no estimate is derivable (never invents a total)', () => {
    const m = buildMethodology(snap({ estimatedTotal: null }));
    expect(m).toContain('42');
    expect(m).not.toContain('~');
  });

  it('describes the static-HTML method honestly (the AI-crawler view)', () => {
    expect(buildMethodology(snap()).toLowerCase()).toMatch(/static|html/);
  });
});

describe('executive summary — pluralisation is EXPLICIT, never inflected from display copy', () => {
  // THE SHIPPED DEFECT: "10 over-optimized anchorss" reached customers. The pluraliser appended 's' to
  // `findingMeta(cat).label`, and that label is already PLURAL for this category. Both branches were
  // wrong for one reason — `label` is display copy, not grammar: it is singular for some categories,
  // plural for others, an adjective phrase for `near_orphan` and a mass noun for
  // `generic_anchor_overuse`. So this pins EVERY category at 1 and at N, not just the reported one.
  const CATEGORIES = [
    'orphan', 'near_orphan', 'deep_page', 'unreachable_page', 'over_optimized_anchor',
    'generic_anchor_overuse', 'under_linked_important', 'incomplete_crawl', 'js_rendered',
  ] as const;

  // `orphan` is counted from the HEADLINE `orphanCount` and skipped in the per-category loop
  // (report-content.ts:43), so it has to be driven through that field or the case tests nothing.
  const withFindings = (category: string, count: number): PublicReportSnapshot =>
    category === 'orphan'
      ? snap({ orphanCount: count, findings: [] })
      : snap({
          orphanCount: 0, // keep the headline orphan line out of the way
          findings: Array.from({ length: count }, (_, i) => ({
            category: category as PublicReportSnapshot['findings'][number]['category'],
            severity: 'medium' as const,
            pageUrl: `https://ex.com/${i}`,
          })),
        });

  // LITERAL expectations. The first version of this test read its expectation out of the table under
  // test (`const m = findingMeta(cat); expect(text).toContain(`${count} ${m.countable.one}`)`), which
  // proves plumbing and never content: setting a category's countable to 'kumquat' shipped with the
  // entire 1290-test suite green. Copy has to be asserted against copy.
  const EXPECTED: Record<string, { one: string; many: string }> = {
    orphan: { one: '1 orphan page', many: '7 orphan pages' },
    near_orphan: { one: '1 nearly-orphaned page', many: '7 nearly-orphaned pages' },
    deep_page: { one: '1 buried page', many: '7 buried pages' },
    unreachable_page: { one: '1 unreachable page', many: '7 unreachable pages' },
    // Emitted per PAGE, so the unit is pages — not anchors.
    over_optimized_anchor: { one: '1 page with over-optimized anchor text', many: '7 pages with over-optimized anchor text' },
    under_linked_important: { one: '1 under-linked key page', many: '7 under-linked key pages' },
    // Site-level singleton like the two below — the engine emits it once per audit, so a count
    // is meaningless and '7 partial crawls' is a string it can never produce.
    incomplete_crawl: { one: 'a partial crawl of the site', many: 'a partial crawl of the site' },
    // Site-level singletons: an uncounted phrase, because "1 x" states a quantity that does not exist.
    generic_anchor_overuse: { one: 'overuse of vague link text', many: 'overuse of vague link text' },
    js_rendered: { one: 'links that only appear after JavaScript runs', many: 'links that only appear after JavaScript runs' },
  };

  // `toContain` is PREFIX-VULNERABLE here and that matters: `other` is `one + 's'` for most categories,
  // so "1 orphan pages" contains "1 orphan page" and a mutant that drops the `count === 1` branch —
  // shipping "1 orphan pages", "1 vague links" — passes. Only `over_optimized_anchor` catches it by
  // luck, because its plural falls mid-string ('page' -> 'pages with…'). Assert a trailing boundary so
  // EVERY category pins the singular branch, not just the lucky one.
  const containsExact = (haystack: string, phrase: string): boolean =>
    new RegExp(`${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`).test(haystack);

  it('emits the exact expected copy for every category, at 1 and at N', () => {
    for (const cat of CATEGORIES) {
      const e = EXPECTED[cat]!;
      const one = buildExecutiveSummary(withFindings(cat, 1)).join(' ');
      const many = buildExecutiveSummary(withFindings(cat, 7)).join(' ');
      expect(containsExact(one, e.one), `${cat} @ 1 — expected "${e.one}" in: ${one}`).toBe(true);
      expect(containsExact(many, e.many), `${cat} @ 7 — expected "${e.many}" in: ${many}`).toBe(true);
    }
  });

  it('never states a COUNT for a category the engine emits once site-wide', () => {
    // `js_rendered` (audit.ts:458) and `generic_anchor_overuse` (audit.ts:500) are emitted once for the
    // whole site, so "1 JavaScript-rendered link" describes a site whose entire link graph is invisible
    // to static crawlers as a single link. Grammatical and false is worse than ungrammatical and false.
    for (const cat of ['js_rendered', 'generic_anchor_overuse', 'incomplete_crawl']) {
      for (const n of [1, 7]) {
        const text = buildExecutiveSummary(withFindings(cat, n)).join(' ');
        expect(text, `${cat} @ ${n}`).not.toMatch(/\d+ (?:JavaScript-rendered|vague|partial crawl)/);
      }
    }
  });

  it('never emits a doubled plural — the exact string customers were shown', () => {
    for (const cat of CATEGORIES) {
      for (const count of [1, 10]) {
        const text = buildExecutiveSummary(withFindings(cat, count)).join(' ');
        // Narrowly targeted at the DOUBLED plural, not any word ending in "ss": the previous
        // `/\w*ss\b/` would reject legitimate future copy containing "access", "business" or "less".
        expect(text, `${cat} @ ${count}`).not.toMatch(/(?:page|anchor|link|crawl|issue)ss\b/);
        expect(text, `${cat} @ ${count}`).not.toContain('anchorss');
        expect(text, `${cat} @ ${count}`).not.toContain('orphaneds');
      }
    }
  });

  it('keeps mid-sentence capitalisation that a blanket toLowerCase destroyed', () => {
    // The old pluraliser lowercased the whole label, rendering 'javascript'. The phrase changed when
    // js_rendered became site-level, but the property under test is the same one.
    expect(buildExecutiveSummary(withFindings('js_rendered', 3)).join(' ')).toContain('JavaScript runs');
    expect(buildExecutiveSummary(withFindings('js_rendered', 3)).join(' ')).not.toContain('javascript');
  });
});

describe('findingMeta — a prototype-keyed category must degrade, not 500 the report', () => {
  it('falls back for every Object.prototype member instead of throwing', () => {
    // `META['__proto__']` resolves to Object.prototype — truthy, so `??` never fires — and the caller
    // then dereferences `.countable.one` and throws, taking down a public indexable page. The guard is
    // load-bearing and had no test: removing it survived the full 1302-test suite.
    for (const evil of Object.getOwnPropertyNames(Object.prototype)) {
      expect(() => findingMeta(evil), evil).not.toThrow();
      const m = findingMeta(evil);
      expect(typeof m.countable?.one, evil).toBe('string');
      expect(typeof m.countable?.other, evil).toBe('string');
    }
  });

  it('renders a drifted category through the executive summary without throwing', () => {
    for (const evil of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
      const snapshot = snap({
        orphanCount: 0,
        findings: [{ category: evil as never, severity: 'medium' as const, pageUrl: 'https://ex.com/a' }],
      });
      expect(() => buildExecutiveSummary(snapshot), evil).not.toThrow();
      // NAMES THE CATEGORY rather than swallowing it into a generic phrase — see distinctness, below.
      expect(buildExecutiveSummary(snapshot).join(' '), evil).toContain(evil);
    }
  });

  it('keeps two DIFFERENT drifted categories distinguishable in the same sentence', () => {
    // REGRESSION. The H2 rewrite overrode only `label` on the fallback, so every unknown category
    // inherited FALLBACK's countable and two distinct drifted categories both rendered
    // "7 internal-linking issues" — in one sentence, on a permanent artifact, with nothing to tell them
    // apart. The pre-hotfix code was ungrammatical ("7 deprecated_thing_as") but at least distinct;
    // making it grammatical by deleting the distinguisher is this hotfix's own principle backwards.
    const snapshot = snap({
      orphanCount: 0,
      findings: [
        ...Array.from({ length: 7 }, (_, i) => ({ category: 'deprecated_thing_a' as never, severity: 'medium' as const, pageUrl: `https://ex.com/a${i}` })),
        ...Array.from({ length: 3 }, (_, i) => ({ category: 'deprecated_thing_b' as never, severity: 'medium' as const, pageUrl: `https://ex.com/b${i}` })),
      ],
    });
    const sentence = buildExecutiveSummary(snapshot).join(' ');
    expect(sentence).toContain('7 deprecated_thing_a');
    expect(sentence).toContain('3 deprecated_thing_b');
    // The failing shape, stated literally: one phrase must not stand for two different categories.
    expect(sentence).not.toMatch(/internal-linking issues.*internal-linking issues/);
  });

  it('a KNOWN category is unaffected by the fallback change', () => {
    const snapshot = snap({
      orphanCount: 0,
      findings: Array.from({ length: 4 }, (_, i) => ({ category: 'deep_page' as const, severity: 'medium' as const, pageUrl: `https://ex.com/d${i}` })),
    });
    expect(buildExecutiveSummary(snapshot).join(' ')).toContain('4 buried pages');
  });
});

describe('executive-summary ordering is locale-INDEPENDENT (frozen artifact)', () => {
  it('is DETERMINISTIC across repeated runs (the property the tie-break protects)', () => {
    // HONEST SCOPE. The tie-break was moved off `localeCompare` because this output is frozen into a
    // permanent report and collation is ICU-build-dependent. But no divergence is CONSTRUCTIBLE from the
    // shipped category set: after `js_rendered` became site-level, no phrase begins with a capital, so
    // collation and code-unit order agree on every real pair. A test asserting a difference would have
    // to invent a category — i.e. assert against a fixture rather than the product.
    //
    // So this pins what is actually observable and actually matters: the ordering is stable. The
    // code-unit comparator is defence against a FUTURE phrase (or a future ICU build) making the two
    // disagree, and that intent lives in the comment at the sort site, not in a fabricated assertion.
    const snapshot = snap({
      orphanCount: 3,
      findings: [
        { category: 'deep_page' as const, severity: 'medium' as const, pageUrl: 'https://ex.com/a' },
        { category: 'js_rendered' as const, severity: 'medium' as const, pageUrl: 'https://ex.com/b' },
        { category: 'generic_anchor_overuse' as const, severity: 'minor' as const, pageUrl: 'https://ex.com/c' },
      ],
    });
    const first = buildExecutiveSummary(snapshot).join(' ');
    for (let i = 0; i < 50; i++) expect(buildExecutiveSummary(snapshot).join(' ')).toBe(first);
  });

  it('is invariant to the order the findings arrive in', () => {
    const mk = (cats: string[]) => snap({
      orphanCount: 0,
      findings: cats.map((c, i) => ({ category: c as never, severity: 'medium' as const, pageUrl: `https://ex.com/${i}` })),
    });
    const a = buildExecutiveSummary(mk(['deep_page', 'js_rendered', 'generic_anchor_overuse'])).join(' ');
    const b = buildExecutiveSummary(mk(['generic_anchor_overuse', 'js_rendered', 'deep_page'])).join(' ');
    expect(a).toBe(b);
  });
});
