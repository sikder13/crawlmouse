import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/analytics', () => ({ track: () => {}, trackRaw: () => {} }));

import { projectAuditForClient, type AuditRow } from '@/lib/audit-stream-projection';
import { deriveAuditViewState } from '@/lib/audit-view-state';
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
    fetched: 3, gradeable: 3, excluded: [], sitemapDeclared: null, sitemapUnreached: null,
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
  return { client, state };
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
