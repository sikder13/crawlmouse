import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// The compare page is stream-driven; the streams are stubbed so the COMPOSED SCREEN can be rendered.
const streams = new Map<string, unknown>();
vi.mock('@/lib/use-audit-stream', () => ({
  useAuditStream: (id: string) => streams.get(id),
}));

import { CompareView, compareOutcome, type ColumnState } from './CompareView';

/**
 * GATE 4 / B3 — the compare page converted a refusal into a defeat.
 *
 * Rendered with one side graded and one side refused, the screen read:
 *
 *     yourshop.com wins — we couldn’t grade theirsite.com.
 *       [yourshop.com]   Winner ring · Grade B · 81/100
 *       [theirsite.com]  No grade — We didn’t have enough evidence to publish a grade for this site.
 *
 * One screen saying we had no evidence, and awarding a win four lines above BECAUSE of it. That
 * inverts Stage 4's rule — a site we could not read is not a bad site — and 5.1a makes it
 * SYSTEMATIC rather than rare: `no_observed_links` fires on every JS-rendered site, so every
 * comparison against a Framer or Webflow SPA would permanently publish a defeat that measures our
 * static crawler rather than the site's linking.
 *
 * WHY IT SURVIVED THREE GATES. The surface proof stopped one call short — `refusal-surfaces.test.ts`
 * SURFACE 12 asserts on `columnState`, the extracted per-column decision, and never on the composed
 * banner. That is the identical seam that hid gate 3's blocker: the piece was proved and the
 * assembly was not. So these tests assert BOTH the pure outcome and the rendered bytes.
 */

const A = { id: 'aud-a', domain: 'yourshop.com' };
const B = { id: 'aud-b', domain: 'theirsite.com' };

const graded = (score: number): ColumnState => ({ kind: 'graded', grade: 'B', score, orphanCount: 3, avgDepth: 2.4 });
const ungradable: ColumnState = { kind: 'ungradable' };
const running: ColumnState = { kind: 'running', pageCount: 4, pageCap: 500, status: 'running' };

/** Render the real component by feeding the stubbed streams the snapshots each state comes from. */
function render(snapA: unknown, snapB: unknown): string {
  streams.clear();
  streams.set(A.id, snapA);
  streams.set(B.id, snapB);
  return renderToStaticMarkup(<CompareView a={A} b={B} />);
}
const gradedSnap = { snapshot: { status: 'completed', grade: 'B', score: 81.39, orphanCount: 3, avgDepth: 2.4 }, finished: true };
const refusedSnap = { snapshot: { status: 'completed', grade: null, score: null }, finished: true };
const runningSnap = { snapshot: { status: 'running', page_count: 4 }, finished: false };

describe('B3 — a refusal is not a defeat', () => {
  it('declares NO winner when only one side could be graded', () => {
    expect(compareOutcome(graded(81), ungradable, A, B)).toEqual({
      kind: 'one-sided', gradedDomain: 'yourshop.com', ungradedDomain: 'theirsite.com',
    });
    // ...and symmetrically, so the fix is not an artifact of which column was refused.
    expect(compareOutcome(ungradable, graded(81), A, B)).toEqual({
      kind: 'one-sided', gradedDomain: 'theirsite.com', ungradedDomain: 'yourshop.com',
    });
  });

  it('the RENDERED screen awards no win and draws no winner ring', () => {
    const html = render(gradedSnap, refusedSnap);
    // The exact sentence the page used to publish.
    expect(html).not.toContain('wins — we couldn’t grade');
    expect(html).not.toContain('wins this round');
    expect(html).not.toContain('Winner');
    // The ring is the visual half of the same claim, and it is drawn from `isWinner`, not the banner.
    expect(html).not.toContain('ring-sage');
  });

  it('says which side we could grade — losing the false claim must not lose the true one', () => {
    const html = render(gradedSnap, refusedSnap);
    expect(html).toContain('We could only grade');
    expect(html).toContain('yourshop.com');
    expect(html).toContain('theirsite.com');
    // The refused column keeps the Stage 4 copy, and never a guessed cause.
    expect(html).toContain('No grade');
    expect(html).not.toContain('usually a site that blocks crawlers');
  });

  it('still names a winner when BOTH sides were graded — the negative control', () => {
    expect(compareOutcome(graded(81), graded(64), A, B)).toEqual({
      kind: 'winner', winnerId: 'aud-a', winnerDomain: 'yourshop.com',
    });
    const html = render(gradedSnap, { snapshot: { status: 'completed', grade: 'D', score: 64, orphanCount: 9, avgDepth: 4 }, finished: true });
    expect(html).toContain('wins this round');
    expect(html).toContain('Winner');
    expect(html).toContain('ring-sage');
  });

  it('still calls a dead heat on equal rounded scores', () => {
    expect(compareOutcome(graded(81.2), graded(80.8), A, B)).toEqual({ kind: 'tie', score: 81 });
  });

  it('stays undecided while a side is still crawling, and when BOTH were refused', () => {
    expect(compareOutcome(graded(81), running, A, B)).toEqual({ kind: 'undecided' });
    expect(compareOutcome(ungradable, ungradable, A, B)).toEqual({ kind: 'undecided' });
    // Two refusals must not produce a banner at all — there is nothing to say about either site.
    const html = render(refusedSnap, refusedSnap);
    expect(html).not.toContain('We could only grade');
    expect(html).not.toContain('Winner');
  });

  it('renders the running column while a crawl is in flight — the stub is really driving it', () => {
    // Anti-vacuity: if the mock returned nothing useful, every "not.toContain" above would pass on
    // an empty screen.
    const html = render(gradedSnap, runningSnap);
    expect(html).toContain('yourshop.com');
    expect(html.length).toBeGreaterThan(500);
  });
});
