import { describe, it, expect } from 'vitest';
import { deriveAuditViewState } from './audit-view-state';
import type { FailureCategory } from './failure-classification';

const snap = (
  o: Partial<{ status: string; grade: string | null; score: number | null; failureCategory: FailureCategory | null }>,
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
      .toEqual({ running: false, awaitingResults: false, graded: false, failed: false, gradeFailed: true, failureCategory: null });
  });

  it('null snapshot is treated as running', () => {
    expect(derive(null, false)).toMatchObject({ running: true });
  });

  // The flash window with grade STILL null (completed arrived before the grade column was
  // populated): must stay awaitingResults, NOT prematurely render the "couldn't grade" card.
  it('completed with grade still null and done=false stays awaitingResults', () => {
    expect(derive(snap({ status: 'completed', grade: null, score: null }), false))
      .toEqual({ running: false, awaitingResults: true, graded: false, failed: false, gradeFailed: false, failureCategory: null });
  });

  // Each state has exactly one `true` flag — pin the full object so a stray flag is caught.
  it('running asserts every flag exhaustively (only running true)', () => {
    expect(derive(snap({ status: 'crawling' }), false))
      .toEqual({ running: true, awaitingResults: false, graded: false, failed: false, gradeFailed: false, failureCategory: null });
  });

  it('awaitingResults asserts every flag exhaustively (only awaitingResults true)', () => {
    expect(derive(snap({ status: 'completed', grade: 'A', score: 92 }), false))
      .toEqual({ running: false, awaitingResults: true, graded: false, failed: false, gradeFailed: false, failureCategory: null });
  });

  it('graded asserts every flag exhaustively (only graded true)', () => {
    expect(derive(snap({ status: 'completed', grade: 'A', score: 92 }), true))
      .toEqual({ running: false, awaitingResults: false, graded: true, failed: false, gradeFailed: false, failureCategory: null });
  });

  it('failed asserts every flag exhaustively (only failed true)', () => {
    expect(derive(snap({ status: 'failed' }), false))
      .toEqual({ running: false, awaitingResults: false, graded: false, failed: true, gradeFailed: false, failureCategory: 'internal' });
  });

  // Dead-state guard: a terminal `done` (e.g. a named stream `error` event sets done=true
  // while the last snapshot is non-terminal) must NEVER render a blank screen — it falls back
  // to gradeFailed so the "couldn't grade / try again" card is always reachable.
  it('done=true with a non-terminal status falls back to gradeFailed (no blank render)', () => {
    expect(derive(snap({ status: 'crawling' }), true))
      .toEqual({ running: false, awaitingResults: false, graded: false, failed: false, gradeFailed: true, failureCategory: null });
  });

  it('failed wins over done (a failed crawl is never gradeFailed)', () => {
    expect(derive(snap({ status: 'failed' }), true))
      .toEqual({ running: false, awaitingResults: false, graded: false, failed: true, gradeFailed: false, failureCategory: 'internal' });
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
      .toEqual({ running: false, awaitingResults: false, graded: false, failed: false, gradeFailed: true, failureCategory: null });
  });

  it('completed + grade + done WITH stats present is graded (the real done path)', () => {
    expect(deriveAuditViewState(snap({ status: 'completed', grade: 'A', score: 92 }), true, true))
      .toEqual({ running: false, awaitingResults: false, graded: true, failed: false, gradeFailed: false, failureCategory: null });
  });

  it('completed + grade, done=false, stats absent is still just awaitingResults (no premature gradeFailed)', () => {
    expect(deriveAuditViewState(snap({ status: 'completed', grade: 'A', score: 92 }), false, false))
      .toEqual({ running: false, awaitingResults: true, graded: false, failed: false, gradeFailed: false, failureCategory: null });
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
      .toMatchObject({ failed: true, failureCategory: 'internal' });
  });

  it('never surfaces a failureCategory on a non-failed audit (even a stray one)', () => {
    expect(derive(snap({ status: 'completed', grade: 'A', score: 92, failureCategory: 'blocked' }), true).failureCategory).toBe(null);
    expect(derive(snap({ status: 'crawling', failureCategory: 'blocked' }), false).failureCategory).toBe(null);
  });
});
