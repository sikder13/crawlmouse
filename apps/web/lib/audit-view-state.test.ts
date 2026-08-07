import { describe, it, expect } from 'vitest';
import { deriveAuditViewState } from './audit-view-state';
import type { FailureCategory } from './failure-classification';

const snap = (
  o: Partial<{ status: string; grade: string | null; score: number | null; failureCategory: FailureCategory | null ; refusal: { refused?: boolean } | null }>,
) => ({ id: 'x', status: 'pending', grade: null, score: null, ...o });

// deriveAuditViewState(snapshot, done, hasResults). `hasResults` = the done payload's numeric
// stats (orphanCount/avgDepth) are present. The default-true keeps the existing happy-path cases
// terse; the dedicated suite below pins the hasResults=false guard.
const derive = (
  s: ReturnType<typeof snap> | null,
  done: boolean,
  hasResults = true,
) => deriveAuditViewState(s, done, hasResults);

describe('deriveAuditViewState', () => {
  it('running while not terminal and done not received', () => {
    expect(derive(snap({ status: 'crawling' }), false))
      .toMatchObject({ running: true, awaitingResults: false, graded: false, failed: false });
  });

  it('awaitingResults when status=completed but the done payload has NOT arrived', () => {
    // This is the flash window: completed + grade present, but done=false.
    expect(derive(snap({ status: 'completed', grade: 'A', score: 92 }), false))
      .toMatchObject({ running: false, awaitingResults: true, graded: false });
  });

  it('graded only once done=true AND grade+score present', () => {
    expect(derive(snap({ status: 'completed', grade: 'A', score: 92 }), true))
      .toMatchObject({ graded: true, awaitingResults: false, running: false });
  });

  it('failed status is terminal and never awaitingResults', () => {
    expect(derive(snap({ status: 'failed' }), false))
      .toMatchObject({ failed: true, running: false, awaitingResults: false, graded: false });
  });

  it('completed-but-ungradable (done, no grade) is neither graded nor awaiting', () => {
    expect(derive(snap({ status: 'completed', grade: null, score: null }), true))
      .toEqual({ running: false, awaitingResults: false, graded: false, failed: false, gradeFailed: true, refused: false, failureCategory: null, canceled: false });
  });

  it('null snapshot is treated as running', () => {
    expect(derive(null, false)).toMatchObject({ running: true });
  });

  // The flash window with grade STILL null (completed arrived before the grade column was
  // populated): must stay awaitingResults, NOT prematurely render the "couldn't grade" card.
  it('completed with grade still null and done=false stays awaitingResults', () => {
    expect(derive(snap({ status: 'completed', grade: null, score: null }), false))
      .toEqual({ running: false, awaitingResults: true, graded: false, failed: false, gradeFailed: false, refused: false, failureCategory: null, canceled: false });
  });

  // Each state has exactly one `true` flag — pin the full object so a stray flag is caught.
  it('running asserts every flag exhaustively (only running true)', () => {
    expect(derive(snap({ status: 'crawling' }), false))
      .toEqual({ running: true, awaitingResults: false, graded: false, failed: false, gradeFailed: false, refused: false, failureCategory: null, canceled: false });
  });

  it('awaitingResults asserts every flag exhaustively (only awaitingResults true)', () => {
    expect(derive(snap({ status: 'completed', grade: 'A', score: 92 }), false))
      .toEqual({ running: false, awaitingResults: true, graded: false, failed: false, gradeFailed: false, refused: false, failureCategory: null, canceled: false });
  });

  it('graded asserts every flag exhaustively (only graded true)', () => {
    expect(derive(snap({ status: 'completed', grade: 'A', score: 92 }), true))
      .toEqual({ running: false, awaitingResults: false, graded: true, failed: false, gradeFailed: false, refused: false, failureCategory: null, canceled: false });
  });

  it('failed asserts every flag exhaustively (only failed true)', () => {
    expect(derive(snap({ status: 'failed' }), false))
      .toEqual({ running: false, awaitingResults: false, graded: false, failed: true, gradeFailed: false, refused: false, failureCategory: 'internal', canceled: false });
  });

  // Dead-state guard: a terminal `done` (e.g. a named stream `error` event sets done=true
  // while the last snapshot is non-terminal) must NEVER render a blank screen — it falls back
  // to gradeFailed so the "couldn't grade / try again" card is always reachable.
  it('done=true with a non-terminal status falls back to gradeFailed (no blank render)', () => {
    expect(derive(snap({ status: 'crawling' }), true))
      .toEqual({ running: false, awaitingResults: false, graded: false, failed: false, gradeFailed: true, refused: false, failureCategory: null, canceled: false });
  });

  it('failed wins over done (a failed crawl is never gradeFailed)', () => {
    expect(derive(snap({ status: 'failed' }), true))
      .toEqual({ running: false, awaitingResults: false, graded: false, failed: true, gradeFailed: false, refused: false, failureCategory: 'internal', canceled: false });
  });

  it('canceled is a distinct terminal state — only `canceled` true, never running/failed/gradeFailed', () => {
    expect(derive(snap({ status: 'canceled' }), false))
      .toEqual({ running: false, awaitingResults: false, graded: false, failed: false, gradeFailed: false, refused: false, failureCategory: null, canceled: true });
  });

  it('canceled stays canceled once done arrives (never falls back to gradeFailed)', () => {
    expect(derive(snap({ status: 'canceled' }), true))
      .toEqual({ running: false, awaitingResults: false, graded: false, failed: false, gradeFailed: false, refused: false, failureCategory: null, canceled: true });
  });
});

// The done payload alone carries orphanCount/avgDepth. If the server hits buildDone and its reads
// throw, it emits a NAMED `error` event (not `done`) whose last snapshot is the prior `progress`
// tick — which DOES carry grade+score but NOT the numeric stats. The client's error listener sets
// done=true, so without a results-presence gate `graded` would be true and GradeCard would render
// a PERMANENT, misleading 0 orphans / 0.0 depth. `hasResults` closes that: a terminal `done`
// carrying grade but no stats is gradeFailed (couldn't-grade card), never a 0/0 GradeCard.
describe('deriveAuditViewState — results-presence gate', () => {
  it('completed + grade + done but stats ABSENT renders the couldn’t-grade card, not a 0/0 GradeCard', () => {
    expect(deriveAuditViewState(snap({ status: 'completed', grade: 'A', score: 92 }), true, false))
      .toEqual({ running: false, awaitingResults: false, graded: false, failed: false, gradeFailed: true, refused: false, failureCategory: null, canceled: false });
  });

  it('completed + grade + done WITH stats present is graded (the real done path)', () => {
    expect(deriveAuditViewState(snap({ status: 'completed', grade: 'A', score: 92 }), true, true))
      .toEqual({ running: false, awaitingResults: false, graded: true, failed: false, gradeFailed: false, refused: false, failureCategory: null, canceled: false });
  });

  it('completed + grade, done=false, stats absent is still just awaitingResults (no premature gradeFailed)', () => {
    expect(deriveAuditViewState(snap({ status: 'completed', grade: 'A', score: 92 }), false, false))
      .toEqual({ running: false, awaitingResults: true, graded: false, failed: false, gradeFailed: false, refused: false, failureCategory: null, canceled: false });
  });
});

// The failure category (timeout/dns/blocked/internal) is classified server-side and rides on the
// failed snapshot; the view state echoes it ONLY for a failed audit so the result card can show
// specific copy, and nulls it everywhere else so a stray value can't leak failure copy elsewhere.
describe('deriveAuditViewState — failure category', () => {
  it('surfaces the snapshot’s failureCategory on a failed audit', () => {
    expect(derive(snap({ status: 'failed', failureCategory: 'dns' }), false))
      .toMatchObject({ failed: true, failureCategory: 'dns' });
    expect(derive(snap({ status: 'failed', failureCategory: 'timeout' }), true))
      .toMatchObject({ failed: true, failureCategory: 'timeout' });
  });

  it('defaults a failed audit with no category to internal (defensive)', () => {
    expect(derive(snap({ status: 'failed' }), false))
      .toMatchObject({ failed: true, failureCategory: 'internal', canceled: false });
  });

  it('never surfaces a failureCategory on a non-failed audit (even a stray one)', () => {
    expect(derive(snap({ status: 'completed', grade: 'A', score: 92, failureCategory: 'blocked' }), true).failureCategory).toBe(null);
    expect(derive(snap({ status: 'crawling', failureCategory: 'blocked' }), false).failureCategory).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a §4 — REFUSED is a first-class state, derived from the persisted decision.
//
// It is NOT derived from `grade == null`, because a null grade has TWO meanings: "we declined to
// assert a letter" and "computing one failed". `audits.refusal` exists precisely to tell them apart.
// Deriving from the null merged an honest refusal into the failure card — which is how the pre-5.1
// copy ("usually a site that blocks crawlers…", in the failure colour, with a support link) stayed
// live on the primary screen while the entire Stage 4 presentation sat unreachable behind `graded`.
//
// Note what this buys: the test above — a completed row with a null grade and NO refusal payload —
// correctly REMAINS `gradeFailed`. That pin was not wrong; it described the compute-failure case.
// ─────────────────────────────────────────────────────────────────────────────
describe('a REFUSED audit is its own terminal state', () => {
  const refusedSnap = { status: 'completed', grade: null, score: null, refusal: { refused: true } };

  it('is refused — not graded, not gradeFailed, not failed', () => {
    const st = derive(snap(refusedSnap), true, true);
    expect(st.refused).toBe(true);
    expect(st.graded).toBe(false);
    expect(st.gradeFailed).toBe(false);
    expect(st.failed).toBe(false);
    expect(st.canceled).toBe(false);
  });

  it('a null grade WITHOUT a refusal payload is still gradeFailed — the two meanings stay apart', () => {
    const st = derive(snap({ status: 'completed', grade: null, score: null }), true, true);
    expect(st.refused).toBe(false);
    expect(st.gradeFailed).toBe(true);
  });

  it('refused:false in the payload is not a refusal', () => {
    const st = derive(snap({ status: 'completed', grade: null, score: null, refusal: { refused: false } }), true, true);
    expect(st.refused).toBe(false);
    expect(st.gradeFailed).toBe(true);
  });

  it('takes precedence over graded, so a stray grade beside a refusal cannot render a letter', () => {
    const st = derive(snap({ status: 'completed', grade: 'B+', score: 81.39, refusal: { refused: true } }), true, true);
    expect(st.refused).toBe(true);
    expect(st.graded).toBe(false);
  });

  it('is not reached before the terminal signal', () => {
    expect(derive(snap(refusedSnap), false, false).refused).toBe(false);
  });
});
