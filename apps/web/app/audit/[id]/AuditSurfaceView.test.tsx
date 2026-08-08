import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/analytics', () => ({ track: () => {}, trackRaw: () => {} }));
// SharePanel reads the app router; the legacy graded card renders it.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

import { AuditSurfaceView, AuditSurfaceMap, type AuditSurfaceDeps } from './AuditSurfaceView';
import type { AuditSurfaceDescriptor } from '@/lib/audit-view-state';
import { freeFixture, refusedFixture } from '@/components/audit/__fixtures__/client-audit-v2';

/**
 * THE DESCRIPTOR → COMPONENT MAP, RENDERED. One case per descriptor kind.
 *
 * This is the half that a source guard was doing badly for four gates. `AuditView` cannot mount here
 * (EventSource, no jsdom), but the MAP is a plain function of its props, so it renders through
 * `renderToStaticMarkup` like everything else — and every one of gate 6's four evasions is now either
 * impossible or caught by execution:
 *
 *   · a one-line early return           — there is no branch in the map to return past
 *   · an additive `{state.refused && …}` — the map is a `switch`; a second case for a kind is a
 *                                          compile error, and an extra element in a case shows up here
 *   · mutating what feeds the decision   — `decideAuditSurface` is called with the arguments under
 *                                          test in `audit-view-state.test.ts`, not with whatever the
 *                                          component happened to compute
 *   · nulling `v2`                       — a `result` descriptor CARRIES its audit; there is no
 *                                          nullable variable left for the map to consult
 */

const DEPS: AuditSurfaceDeps = {
  auditId: 'aud-1',
  pageCount: 12,
  pageCap: 500,
  status: 'running',
  pagesCrawled: 12,
  estimatedTotal: 40,
  phase: 'crawling',
  stalled: false,
  activityFeed: [],
  canceling: false,
  cancelError: null,
  onCancel: () => {},
};

const render = (descriptor: AuditSurfaceDescriptor) =>
  renderToStaticMarkup(<AuditSurfaceMap descriptor={descriptor} deps={DEPS} />);

/** The pre-5.1 failure copy — the invented cause this spec exists to delete. */
const INVENTED_CAUSE = 'usually a site that blocks crawlers';

describe('AuditSurfaceView — one render per descriptor', () => {
  it('result/refused → the Stage 4 arc, with no failure copy and no letter', () => {
    const html = render({ kind: 'result', verdict: 'refused', audit: refusedFixture });
    expect(html).toContain('No grade');
    expect(html).not.toContain(INVENTED_CAUSE);
    expect(html).not.toContain('contact support');
    expect(html).not.toContain('text-warning');
  });

  it('result/graded → the full arc with the letter', () => {
    const html = render({ kind: 'result', verdict: 'graded', audit: freeFixture });
    expect(html).toContain(freeFixture.grade!);
    expect(html).not.toContain(INVENTED_CAUSE);
  });

  it('graded-legacy → the v1 card, from the descriptor’s own numbers', () => {
    const html = render({
      kind: 'graded-legacy', grade: 'B', score: 81.39, orphanCount: 3, avgDepth: 2.4,
      findingGroups: null, viewerIsPro: false,
    });
    expect(html).toContain('81');
    // Free viewer → the upgrade path, not the export link.
    expect(html).toContain('CSV');
    expect(html).not.toContain('/export');
  });

  it('graded-legacy → a Pro viewer gets the export link instead', () => {
    const html = render({
      kind: 'graded-legacy', grade: 'B', score: 81.39, orphanCount: 3, avgDepth: 2.4,
      findingGroups: null, viewerIsPro: true,
    });
    expect(html).toContain('/api/audits/aud-1/export');
  });

  it('error → the failure card, carrying the copy the descriptor chose', () => {
    const html = render({ kind: 'error', copy: { title: 'Couldn’t grade this site', body: 'Body text.' } });
    expect(html).toContain('Couldn’t grade this site');
    expect(html).toContain('Body text.');
    expect(html).toContain('text-warning');
  });

  it('canceled → the canceled card, and never the failure tone', () => {
    const html = render({ kind: 'canceled' });
    expect(html).toContain('Audit canceled');
    expect(html).not.toContain('text-warning');
  });

  it('running → progress, feed, email capture and the cancel control', () => {
    const html = render({ kind: 'running' });
    expect(html).toContain('Cancel audit');
    expect(html.length).toBeGreaterThan(200);
  });

  it('running → surfaces a cancel error when there is one', () => {
    const html = renderToStaticMarkup(
      <AuditSurfaceMap descriptor={{ kind: 'running' }} deps={{ ...DEPS, cancelError: 'Network error — please try again.' }} />,
    );
    expect(html).toContain('Network error');
  });

  it('awaiting → the skeleton, with no numbers in it', () => {
    const html = render({ kind: 'awaiting' });
    expect(html).not.toContain('81');
    expect(html.length).toBeGreaterThan(20);
  });

  it('none → nothing at all', () => {
    expect(render({ kind: 'none' })).toBe('');
  });

  it('NO descriptor renders the invented cause except `error` — swept, not spot-checked', () => {
    // The property the four gates were really about. Every non-error descriptor is rendered and
    // checked for the pre-5.1 sentence, so a future case that reaches for the failure card fails here
    // rather than in production.
    const nonError: AuditSurfaceDescriptor[] = [
      { kind: 'canceled' },
      { kind: 'running' },
      { kind: 'awaiting' },
      { kind: 'result', verdict: 'refused', audit: refusedFixture },
      { kind: 'result', verdict: 'graded', audit: freeFixture },
      { kind: 'graded-legacy', grade: 'B', score: 81.39, orphanCount: 3, avgDepth: 2.4, findingGroups: null, viewerIsPro: false },
      { kind: 'none' },
    ];
    for (const d of nonError) {
      expect(render(d), `${d.kind} rendered the invented cause`).not.toContain(INVENTED_CAUSE);
    }
    // Anti-vacuity: the sentence IS reachable, from the one descriptor that owns it.
    expect(render({ kind: 'error', copy: { title: 'x', body: `The crawl finished — ${INVENTED_CAUSE}.` } })).toContain(INVENTED_CAUSE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE WHOLE CHAIN, DRIVEN FROM A SNAPSHOT — snapshot → state → v2 → descriptor → rendered screen.
//
// Gate 6's two subtlest evasions mutated what was FED to the decision rather than the decision or the
// branch table, and nothing could see them because they sat in the EventSource-driven component that
// never mounts. The derivation now lives in `AuditSurfaceView`, which does render here, so those
// inputs are under execution: `deriveAuditViewState`, `asClientAuditV2` and `decideAuditSurface` are
// all called by code this test runs.
// ─────────────────────────────────────────────────────────────────────────────
describe('AuditSurfaceView — the chain, from the snapshot the stream emits', () => {
  const chain = (snapshot: unknown, done: boolean) =>
    renderToStaticMarkup(<AuditSurfaceView snapshot={snapshot as never} done={done} deps={DEPS} />);

  it('a refused snapshot renders the Stage 4 arc, never the failure card', () => {
    const html = chain({ ...refusedFixture, status: 'completed', orphanCount: 0, avgDepth: 0 }, true);
    expect(html).toContain('No grade');
    expect(html).not.toContain(INVENTED_CAUSE);
    expect(html).not.toContain('contact support');
  });

  it('a graded v2 snapshot renders the full arc with its letter', () => {
    const html = chain({ ...freeFixture, status: 'completed', orphanCount: 3, avgDepth: 2.4 }, true);
    expect(html).toContain(freeFixture.grade!);
    expect(html).not.toContain(INVENTED_CAUSE);
  });

  it('a null verdict with NO refusal payload renders the failure card — the two meanings stay apart', () => {
    const html = chain({ status: 'completed', grade: null, score: null, refusal: null }, true);
    expect(html).toContain('Couldn’t grade this site');
    expect(html).not.toContain('No grade');
  });

  it('a running snapshot renders progress, not a verdict', () => {
    const html = chain({ status: 'running', page_count: 12 }, false);
    expect(html).toContain('Cancel audit');
    expect(html).not.toContain('No grade');
    expect(html).not.toContain(INVENTED_CAUSE);
  });

  it('a completed snapshot before `done` renders the skeleton, never a 0/0 card', () => {
    const html = chain({ status: 'completed', grade: 'B', score: 81 }, false);
    expect(html).not.toContain('81');
    expect(html).not.toContain(INVENTED_CAUSE);
  });

  it('a failed snapshot renders the classified failure copy', () => {
    const html = chain({ status: 'failed', failureCategory: 'timeout' }, true);
    expect(html).toContain('text-warning');
    expect(html).not.toContain('No grade');
  });

  it('a canceled snapshot says canceled, in the neutral tone', () => {
    const html = chain({ status: 'canceled' }, true);
    expect(html).toContain('Audit canceled');
    expect(html).not.toContain('text-warning');
  });

  it('a legacy graded snapshot (no crawlHealth) renders the v1 card', () => {
    const html = chain({ status: 'completed', grade: 'B', score: 81.39, orphanCount: 3, avgDepth: 2.4 }, true);
    expect(html).toContain('81');
    expect(html).not.toContain(INVENTED_CAUSE);
  });
});
