import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/analytics', () => ({ track: () => {}, trackRaw: () => {} }));

import { projectAuditForClient, type AuditRow } from '@/lib/audit-stream-projection';
import { deriveAuditViewState, chooseSurface } from '@/lib/audit-view-state';
import { AUDIT_COLS, REFUSAL_REQUIRED_COLS, REFUSAL_COUNT_COLS, auditColumnSet } from '@/lib/audit-columns';
import { ResultView } from '@/components/audit/ResultView';

/**
 * ROUTE-LEVEL refusal tests — the rule that exists to prevent a fourth gate round.
 *
 * THREE GATES RUNNING, component tests proved the component and never the product. `ResultView`'s
 * refusal branch was correct, tested, and UNREACHABLE: `deriveAuditViewState` gated the whole view on
 * `graded`, which requires a non-null grade, so every refused audit fell through to the pre-5.1
 * failure card — "usually a site that blocks crawlers or has no crawlable pages", in the failure
 * colour. Rendering `ResultView` directly could never have caught that, because the bug was in what
 * the ROUTE decides to mount.
 *
 * So these start from the DATABASE ROW and walk the real path:
 *     AuditRow -> projectAuditForClient -> deriveAuditViewState -> the branch AuditView takes -> render
 *
 * WHAT THIS IS NOT: a DOM mount. `AuditView` is a client component driven by EventSource and this
 * suite renders server-side, so the React lifecycle is out of reach. Every SEAM between the row and
 * the screen is covered — which is where the defect lived — but the JSX wiring inside `AuditView`
 * itself is verified by inspection, not by this test. Stated rather than implied.
 */

const refusedRow = (over: Partial<AuditRow> = {}): AuditRow => ({
  id: 'aud-1',
  url: 'https://ex.com/',
  status: 'completed',
  grade: null,
  score: null,
  page_count: 3,
  link_count: 0,
  cms_detected: null,
  user_id: null,
  settings: null,
  failure_reason: null,
  confidence: 'low',
  coverage_pct: '1',
  block_rate: '0',
  partial: false,
  discovered_count: 3,
  blocked_count: 0,
  refusal: { refused: true, triggers: ['site_too_small_to_measure'], confidenceCapped: false, unevaluable: [] },
  coverage: {
    fetched: 3, gradeable: 3, excluded: [], sitemapDeclared: null,
    sitemapRobotsExcluded: null, estimatedTotal: 3, estimateSource: 'frontier', coverageRatio: 1,
  },
  ...over,
} as AuditRow);

const conversion = {
  entitlement: { canSeeAllPrescriptions: false, canMonitor: false },
  isOwner: false, confidenceBand: null, projectedGrade: null, freeFix: null, prescriptions: null,
  monitoring: null, findings: [], orphanCount: 0, avgDepth: 0, viewerSignedIn: false,
  graph: null, aiReadiness: null, pageAiSignals: [],
} as never;

/** The exact decision `AuditView` makes, from the row the route reads. */
function routeDecision(row: AuditRow) {
  const client = projectAuditForClient(row, conversion);
  const state = deriveAuditViewState(
    { status: client.status, grade: client.grade, score: client.score, refusal: client.refusal as { refused?: boolean } | null },
    true,
    true,
  );
  return { client, state, surface: chooseSurface(state, true) };
}

const TRIGGERS = ['site_too_small_to_measure', 'too_few_gradeable_pages', 'nothing_read', 'no_observed_links'] as const;

describe('ROUTE LEVEL — a refused audit reaches the Stage 4 presentation, not the failure card', () => {
  for (const trigger of TRIGGERS) {
    it(`${trigger}: the route resolves to REFUSED, not gradeFailed`, () => {
      const { state } = routeDecision(refusedRow({
        refusal: { refused: true, triggers: [trigger], confidenceCapped: false, unevaluable: [] },
      } as Partial<AuditRow>));
      expect(state.refused).toBe(true);
      // The three states that would each render the WRONG screen.
      expect(state.gradeFailed).toBe(false);
      expect(state.graded).toBe(false);
      expect(state.failed).toBe(false);
    });

    it(`${trigger}: the rendered screen carries the Stage 4 copy and none of the pre-5.1 copy`, () => {
      const { client } = routeDecision(refusedRow({
        refusal: { refused: true, triggers: [trigger], confidenceCapped: false, unevaluable: [] },
      } as Partial<AuditRow>));
      const html = renderToStaticMarkup(<ResultView audit={client as never} />);
      // The invented cause this spec deleted — and the failure colour it was rendered in.
      expect(html).not.toContain('usually a site that blocks crawlers');
      expect(html).not.toContain('contact support');
      expect(html).not.toContain('text-warning');
      // ...and no letter, anywhere in the bytes.
      expect(html).not.toMatch(/grade is\s*[A-F]\b/i);
    });
  }

  it('a null grade WITHOUT a refusal payload still routes to gradeFailed — the two meanings stay apart', () => {
    const { state } = routeDecision(refusedRow({ refusal: null } as Partial<AuditRow>));
    expect(state.refused).toBe(false);
    expect(state.gradeFailed).toBe(true);
  });

  it('a graded audit still routes to graded — the negative control', () => {
    const { state } = routeDecision(refusedRow({
      grade: 'B+', score: '81.39', refusal: null,
    } as unknown as Partial<AuditRow>));
    expect(state.graded).toBe(true);
    expect(state.refused).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE 4 / W1 + W1b — THE ROUTE TESTS MUST CONSUME THE ROW SHAPE THE LOADER ACTUALLY EMITS.
//
// Two mutations survived the entire 1426-test suite: dropping `refusal, coverage` from the SSE
// route's select list, and dropping `discovered_count, blocked_count`. The write side is pinned in
// `persist-results` and the projection is pinned in `audit-stream-projection`; nothing pinned the
// SELECT that connects them. A refused audit would have arrived at the browser with no refusal
// payload and been routed straight back to the failure card — gate 3's blocker, via the database.
//
// The same class produced B1 one file over: a dashboard test passing on `delta: null`, a shape the
// loader cannot produce, while 19 of 20 real cards rendered the defect. A fixture that outruns its
// loader proves a state the product never enters.
//
// So these assert against the REAL exported select list, not a copy of it and not its source text.
// ─────────────────────────────────────────────────────────────────────────────
describe('the row fixture is the loader’s row — not a shape the loader cannot produce', () => {
  const cols = auditColumnSet(AUDIT_COLS);

  it('every column the refusal presentation needs is actually SELECTED', () => {
    for (const c of REFUSAL_REQUIRED_COLS) expect([...cols]).toContain(c);
  });

  it('keeps selecting the crawl-health counts body (e) needs, though they are inert today', () => {
    // Dropping these was gate 4 / W1, and it survived the whole suite — because nothing renders them
    // yet. "M refused" comes from `blocked_count`; "N requests" is `attempted`, which no column
    // stores, so the sentence is omitted on every production read and both values currently travel
    // for nothing. That is a recorded gap, not a licence to drop the columns: removing them now is
    // invisible and re-breaks the sentence the day `attempted_count` lands.
    // See docs/tickets/2026-08-07-attempted-count-not-persisted.md.
    for (const c of REFUSAL_COUNT_COLS) expect([...cols]).toContain(c);
  });

  it('the fixture invents no field the route does not select', () => {
    // The direction that catches a fixture drifting AHEAD of the loader. Every key of the row we
    // test with must be a column the route actually asks the database for.
    for (const key of Object.keys(refusedRow())) expect([...cols]).toContain(key);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE 4 / W8b — the SURFACE the route picks, not just the state it derives.
//
// `AuditView` rendered `{refused && v2 && <ResultView/>}`, and prefixing that with `false &&` left
// the whole suite green: the state was proved, the choice made from it was not. `chooseSurface` is
// that choice, extracted so it can be executed here; the companion source guard pins the JSX shape.
// ─────────────────────────────────────────────────────────────────────────────
describe('ROUTE LEVEL — the chosen SURFACE, per trigger', () => {
  for (const trigger of TRIGGERS) {
    it(`${trigger}: chooses the refusal result surface`, () => {
      const { surface } = routeDecision(refusedRow({
        refusal: { refused: true, triggers: [trigger], confidenceCapped: false, unevaluable: [] },
      } as Partial<AuditRow>));
      expect(surface).toBe('refused-v2');
    });
  }

  it('a null grade with NO refusal payload chooses the error surface, never the Stage 4 copy', () => {
    expect(routeDecision(refusedRow({ refusal: null } as Partial<AuditRow>)).surface).toBe('error');
  });

  it('a graded audit chooses the graded surface — the negative control', () => {
    const { surface } = routeDecision(refusedRow({
      grade: 'B+', score: '81.39', refusal: null,
    } as unknown as Partial<AuditRow>));
    expect(surface).toBe('graded-v2');
  });

  it('a refusal payload beats a stray non-null grade — the two gates cannot disagree', () => {
    // The latent inversion R3 named: the route said `refused` while ResultView still keyed on
    // `grade == null`, so a row carrying both would have rendered the FULL GRADED ARC WITH A LETTER
    // under a route that had already decided to withhold one. Unreachable today only because the
    // engine happens to null both together — which is agreement, not a guarantee.
    const row = refusedRow({
      grade: 'B+', score: '81.39',
      refusal: { refused: true, triggers: ['no_observed_links'], confidenceCapped: false, unevaluable: [] },
    } as unknown as Partial<AuditRow>);
    const { client, surface } = routeDecision(row);
    expect(surface).toBe('refused-v2');
    const html = renderToStaticMarkup(<ResultView audit={client as never} />);
    expect(html).toContain('No grade');
    expect(html).not.toContain('81.39');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE 4 / B2 — the counts the refusal screen prints, from the row the loader emits.
// ─────────────────────────────────────────────────────────────────────────────
describe('ROUTE LEVEL — nothing_read prints no invented request count', () => {
  it('does not print `discovered` as the number of requests', () => {
    // The row shape that produced the defect: 3 requests made, 8 URLs discovered. `attempted` has no
    // column, so the loader cannot supply it and the sentence must be omitted — never backfilled
    // from the one number that happens to be present.
    const { client } = routeDecision(refusedRow({
      page_count: 0,
      discovered_count: 8,
      blocked_count: 0,
      refusal: { refused: true, triggers: ['nothing_read'], confidenceCapped: false, unevaluable: [] },
    } as Partial<AuditRow>));
    const html = renderToStaticMarkup(<ResultView audit={client as never} />);
    expect(html).not.toContain('8 requests');
    expect(html).not.toMatch(/\d+\s+requests?/);
    // The rest of body (e) survives — the omission must not gut the screen.
    expect(html).toContain('GPTBot');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE 4 / W9 + W9b — what a refused audit still SHOWS.
//
// Both survived the whole suite. Dropping `sitemap_unreached` from INFORMATIONAL restores the state
// the gate-3 commit says it fixed — the delta emitted, persisted, and structurally unrenderable on
// the one screen where it is the most useful thing we have. Reverting the heading gate from
// `renderableFindings` to `verdictFreeFindings` restores an EMPTY "What we did find" heading, because
// the banners draw only the informational categories and the rest are filtered or unsupported.
//
// Rendered from the row, not from a hand-built props object, so the finding has to survive the
// projection to count.
// ─────────────────────────────────────────────────────────────────────────────
describe('ROUTE LEVEL — the evidence that survives a refusal', () => {
  const withFindings = (findings: unknown[]) => ({ ...(conversion as object), findings } as never);

  const renderRefused = (findings: unknown[]) => {
    const row = refusedRow({
      refusal: { refused: true, triggers: ['no_observed_links'], confidenceCapped: false, unevaluable: [] },
    } as Partial<AuditRow>);
    const client = projectAuditForClient(row, withFindings(findings));
    return renderToStaticMarkup(<ResultView audit={client as never} />);
  };

  it('a PRE-CUT row carrying sitemap_unreached renders no site-wide banner — D4 stays cut', () => {
    // D4 is cut, but rows written before the cut still carry the category in `findings`. This pins the
    // safety property the type comment claims: the category is no longer in INFORMATIONAL and has no
    // comprehension entry, so an old row cannot resurrect the reachability claim as a banner.
    const html = renderRefused([
      { category: 'sitemap_unreached', severity: 'critical', payload: { unreached: 820, declared: 821, reachable: 1, robotsExcluded: 0 } },
    ]);
    expect(html).not.toContain('Declared in your sitemap');
    expect(html).not.toContain('reached by following links');
    expect(html).not.toContain('What we did find');
  });

  it('renders NO heading when nothing under it would draw — never an empty "What we did find"', () => {
    // W9b, and the fixture matters. `incomplete_crawl` alone does NOT discriminate: it asserts a
    // verdict, so it is dropped by BOTH the filtered and the unfiltered gate and the heading vanishes
    // either way. The gate only differs on a finding that is verdict-FREE but not INFORMATIONAL —
    // `orphan_page` is an actionable ledger row, so the banners draw nothing for it. Under the old
    // gate that is a heading rendered above empty space.
    const html = renderRefused([
      { category: 'orphan_page', severity: 'high', payload: { count: 4 } },
    ]);
    expect(html).not.toContain('What we did find');
  });

  it('a verdict-asserting finding alone also draws no heading', () => {
    // The other half: `incomplete_crawl` reads "your grade is an estimate until the whole site is
    // crawled", which is true on a graded partial audit and false four lines under a no-grade label.
    const html = renderRefused([{ category: 'incomplete_crawl', severity: 'medium', payload: {} }]);
    expect(html).not.toContain('What we did find');
    expect(html).not.toContain('estimate until');
  });

  it('withholds the finding that presumes a verdict, while keeping the one that does not', () => {
    // `incomplete_crawl` reads "your grade is an estimate until the whole site is crawled" — true on a
    // graded partial audit, false four lines under a no-grade label. `js_rendered` asserts no verdict
    // and is informational, so it survives and draws the heading.
    const html = renderRefused([
      { category: 'incomplete_crawl', severity: 'medium', payload: {} },
      { category: 'js_rendered', severity: 'medium', payload: {} },
    ]);
    expect(html).toContain('What we did find');
    expect(html).toContain('JavaScript');
    expect(html).not.toContain('estimate until');
  });

});
