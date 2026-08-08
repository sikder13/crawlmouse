import { describe, it, expect } from 'vitest';
import { deriveAuditViewState, decideAuditSurface, type AuditViewState, type AuditSnapshotLite } from './audit-view-state';
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

// ─────────────────────────────────────────────────────────────────────────────
// THE RENDER DECISION, AS DATA — the full state matrix, enumerated.
//
// The decision used to live in JSX behind a source guard, because AuditView is EventSource-driven and
// this suite has no jsdom. That guard was weaker than its own docstring at FOUR consecutive gates, and
// gate 6 produced four independent edits that restored gate 3's blocker with the suite and `tsc`
// green — two of them by mutating what was FED to the decision, which no guard over a branch table
// can see. The decision therefore left the JSX. This is the whole of it, and every row below is a
// state the product can actually be in.
// ─────────────────────────────────────────────────────────────────────────────
describe('decideAuditSurface — the full state matrix', () => {
  const st = (over: Partial<AuditViewState> = {}): AuditViewState => ({
    running: false, awaitingResults: false, graded: false, refused: false,
    failed: false, gradeFailed: false, failureCategory: null, canceled: false,
    ...over,
  });
  const V2 = { grade: 'B', score: 81 } as never;
  const LEGACY = { status: 'completed', grade: 'B', score: 81.39, orphanCount: 3, avgDepth: 2.4, viewerIsPro: false };

  it('draws the RESULT arc for a refused audit, and records WHY', () => {
    expect(decideAuditSurface(st({ refused: true }), null, V2)).toEqual({ kind: 'result', verdict: 'refused', audit: V2 });
  });

  it('puts refused AHEAD of gradeFailed — the gate-3 blocker, as a precedence rule', () => {
    // The catch-all used to swallow every refusal and show "usually a site that blocks crawlers".
    expect(decideAuditSurface(st({ refused: true, gradeFailed: true }), null, V2))
      .toEqual({ kind: 'result', verdict: 'refused', audit: V2 });
  });

  it('puts refused AHEAD of graded — a withheld verdict never renders a letter', () => {
    expect(decideAuditSurface(st({ refused: true, graded: true }), null, V2))
      .toEqual({ kind: 'result', verdict: 'refused', audit: V2 });
  });

  it('falls back to the error card when a refusal arrives with NO v2 payload', () => {
    // Structurally unreachable (decideRefusal runs only on the v2 path) and deliberately handled: the
    // failure card is a worse answer than the Stage 4 copy and an infinitely better one than a blank.
    const d = decideAuditSurface(st({ refused: true }), null, null);
    expect(d.kind).toBe('error');
  });

  it('routes a null verdict with NO refusal to the error card, never to the Stage 4 copy', () => {
    const d = decideAuditSurface(st({ gradeFailed: true }), null, V2);
    expect(d).toEqual({ kind: 'error', copy: { title: expect.stringContaining('Couldn’t grade'), body: expect.any(String) } });
  });

  it('carries the CLASSIFIED failure copy for a genuinely failed audit', () => {
    // A crawl failure names its reason; a completed-but-ungradable crawl does not. The two must not
    // share a sentence — that conflation is what put an invented cause on the refusal screen.
    const failed = decideAuditSurface(st({ failed: true, failureCategory: 'timeout' }), null, null);
    const ungradable = decideAuditSurface(st({ gradeFailed: true }), null, null);
    expect(failed.kind).toBe('error');
    expect(ungradable.kind).toBe('error');
    expect(failed).not.toEqual(ungradable);
  });

  it('draws the graded arc from v2, and the legacy payload without one', () => {
    expect(decideAuditSurface(st({ graded: true }), LEGACY, V2)).toEqual({ kind: 'result', verdict: 'graded', audit: V2 });
    expect(decideAuditSurface(st({ graded: true }), LEGACY, null)).toEqual({
      kind: 'graded-legacy', grade: 'B', score: 81.39, orphanCount: 3, avgDepth: 2.4,
      findingGroups: null, viewerIsPro: false,
    });
  });

  it('canceled outranks everything — the user stopped it, and that is not a failure', () => {
    expect(decideAuditSurface(st({ canceled: true, gradeFailed: true }), null, V2)).toEqual({ kind: 'canceled' });
    expect(decideAuditSurface(st({ canceled: true, running: true }), null, V2)).toEqual({ kind: 'canceled' });
  });

  it('draws running and awaiting before any terminal surface', () => {
    expect(decideAuditSurface(st({ running: true }), null, V2)).toEqual({ kind: 'running' });
    expect(decideAuditSurface(st({ awaitingResults: true }), null, V2)).toEqual({ kind: 'awaiting' });
  });

  it('draws nothing for a state that is neither running nor terminal', () => {
    expect(decideAuditSurface(st(), null, null)).toEqual({ kind: 'none' });
  });

  it('never yields a result descriptor without an audit — the type and the value agree', () => {
    // The property that deletes the old `v2!` assertion. Across every state, a `result` descriptor
    // always carries an audit, so the map cannot render ResultView with nothing.
    for (const over of [{ refused: true }, { graded: true }, { refused: true, graded: true }]) {
      for (const v2 of [V2, null]) {
        const d = decideAuditSurface(st(over), LEGACY, v2);
        if (d.kind === 'result') expect(d.audit).toBeTruthy();
      }
    }
  });

  it('is exhaustive over the real derivation — every deriveAuditViewState output has a descriptor', () => {
    // Anti-vacuity for the whole file: the matrix above is hand-built, so this walks the states the
    // PRODUCT actually produces and asserts none of them falls through to `none` unexpectedly.
    const rows: [AuditSnapshotLite | null, boolean, boolean][] = [
      [null, false, false],
      [{ status: 'pending' }, false, false],
      [{ status: 'completed', grade: 'B', score: 81 }, false, false],
      [{ status: 'completed', grade: 'B', score: 81, orphanCount: 1, avgDepth: 2 }, true, true],
      [{ status: 'completed', grade: null, score: null, refusal: { refused: true } }, true, true],
      [{ status: 'completed', grade: null, score: null, refusal: null }, true, false],
      [{ status: 'failed', failureCategory: 'dns' }, true, false],
      [{ status: 'canceled' }, true, false],
    ];
    for (const [snap, done, hasResults] of rows) {
      const state = deriveAuditViewState(snap, done, hasResults);
      const d = decideAuditSurface(state, snap, snap?.grade ? ({ grade: snap.grade } as never) : null);
      expect(d.kind, `state ${JSON.stringify(snap)} produced no surface`).not.toBe('none');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE 7 / B4 — a refused audit reaches a result surface ONLY at the terminal `done` payload.
// ─────────────────────────────────────────────────────────────────────────────
describe('refused is gated on hasResults, exactly as graded is', () => {
  const refusedSnap = { status: 'completed', grade: null, score: null, refusal: { refused: true } };

  it('is NOT refused when the terminal stats are absent — the base payload cannot reach ResultView', () => {
    // The buildDone-threw path: `done` arrives via a named `error` and the last snapshot is the base
    // ClientAudit with no `findings`. Rendering that threw a TypeError on the primary page.
    const state = deriveAuditViewState(refusedSnap, true, false);
    expect(state.refused).toBe(false);
    expect(state.gradeFailed).toBe(true);
    expect(decideAuditSurface(state, refusedSnap, { grade: 'B' } as never).kind).toBe('error');
  });

  it('IS refused on the real done payload — the negative control', () => {
    const full = { ...refusedSnap, orphanCount: 0, avgDepth: 0 };
    const state = deriveAuditViewState(full, true, true);
    expect(state.refused).toBe(true);
    expect(decideAuditSurface(state, full, { grade: null } as never).kind).toBe('result');
  });

  it('holds refused to the SAME condition as graded — a property, not two examples', () => {
    for (const hasResults of [false, true]) {
      const s1 = deriveAuditViewState(refusedSnap, true, hasResults);
      const s2 = deriveAuditViewState({ status: 'completed', grade: 'B', score: 81 }, true, hasResults);
      expect(s1.refused, `refused at hasResults=${hasResults}`).toBe(hasResults);
      expect(s2.graded, `graded at hasResults=${hasResults}`).toBe(hasResults);
    }
  });
});
