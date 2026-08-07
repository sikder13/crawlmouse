import type { FailureCategory } from './failure-classification';

// Pure derivation of AuditView's render state from the latest snapshot, whether the `done`
// signal has arrived, and whether the done payload's numeric stats are present. Keeping this
// pure makes the "no 0/0 flash" AND "no permanent 0/0 GradeCard" guarantees unit-testable
// without a DOM/EventSource.
export interface AuditSnapshotLite {
  status: string;
  grade?: string | null;
  score?: number | null;
  failureCategory?: FailureCategory | null; // coarse failure bucket, classified server-side
  /**
   * SPEC 5.1a §4 — the persisted refusal decision. THE STATE IS DERIVED FROM THIS, NEVER FROM
   * `grade == null`.
   *
   * A null grade has TWO meanings — "we declined to assert a letter" and "computing one failed" —
   * and the `audits.refusal` column exists precisely to tell them apart. Deriving from the null
   * would merge an honest refusal into the failure card, which is how the pre-5.1 copy ("usually a
   * site that blocks crawlers…", in the failure colour) stayed live on the primary screen while the
   * whole Stage 4 presentation sat unreachable behind `graded`.
   */
  refusal?: { refused?: boolean } | null;
}

export interface AuditViewState {
  running: boolean;          // crawl in progress
  awaitingResults: boolean;  // terminal=completed but done payload not yet received → skeleton
  graded: boolean;           // safe to render GradeCard with REAL numbers (stats present)
  /**
   * SPEC 5.1a §4 — the engine DECLINED to assert a letter. A distinct terminal state: not graded,
   * not failed, and emphatically not `gradeFailed` — nothing went wrong, we simply hold too little
   * evidence to publish a verdict. Checked BEFORE graded and gradeFailed.
   */
  refused: boolean;
  failed: boolean;
  gradeFailed: boolean;      // terminal (done) but not graded — catch-all so a missing/failed/
                             // stats-less done payload always reaches the "couldn't grade" card,
                             // never a blank render and never a misleading 0-orphans/0.0-depth card
  failureCategory: FailureCategory | null; // which failure copy to show — set ONLY when failed
  canceled: boolean;         // user stopped the audit — a distinct terminal state (never failed/alert)
}

/**
 * @param snapshot   latest audit snapshot (or null before the first event)
 * @param done       the terminal signal arrived (via the `done` event OR a named stream `error`)
 * @param hasResults the done payload's numeric stats (orphanCount/avgDepth) are present. Only the
 *                   real `done` event carries them; a `progress` tick (which the client still holds
 *                   when the server emits `error` instead of `done`) carries grade+score but NOT
 *                   these stats. Defaults to false so a caller that forgets to thread it can never
 *                   accidentally render a 0/0 GradeCard.
 */
export function deriveAuditViewState(
  snapshot: AuditSnapshotLite | null,
  done: boolean,
  hasResults = false,
): AuditViewState {
  const status = snapshot?.status ?? 'pending';
  const completed = status === 'completed';
  const failed = status === 'failed';
  const canceled = status === 'canceled';
  const hasGrade = !!snapshot?.grade && snapshot?.score != null;
  // `graded` (render GradeCard with real numbers) requires BOTH the grade AND the stats payload.
  // The orphanCount/avgDepth come only with the `done` event, so a `progress` snapshot that
  // happens to carry grade+score (when the server then emits `error` instead of `done`) must NOT
  // be treated as graded — it would show a permanent 0 orphans / 0.0 depth.
  // REFUSED FIRST, and from the refusal payload rather than the null. A refused audit completed
  // normally; it is `done` and `completed` with an explicit decision attached.
  const refused = done && completed && snapshot?.refusal?.refused === true;
  const graded = done && completed && hasGrade && hasResults && !refused;
  // `done` can arrive via the terminal `done` event OR a named stream `error` event (result
  // finalization failed) whose last snapshot may still read 'completed' (with or without a grade)
  // — or, defensively, a non-terminal status. Make gradeFailed the catch-all terminal-but-not-
  // graded state so a missing/failed/stats-less `done` payload always reaches the "couldn't
  // grade / try again" card and a blank (or 0/0) render is unrepresentable.
  // ...and refused is subtracted from the catch-all, so an honest absence of a verdict can never
  // fall through to the "couldn't grade / try again" card.
  const gradeFailed = done && !failed && !canceled && !graded && !refused;
  const awaitingResults = completed && !failed && !done;
  const running = !completed && !failed && !canceled && !done;
  // The failure copy is keyed off the category, but ONLY a genuinely failed audit shows it; a
  // stray category on a non-failed snapshot is dropped so failure copy can't leak into the
  // running/graded/gradeFailed states. A failed audit always has a category server-side; default
  // to 'internal' defensively so the copy is never blank.
  const failureCategory = failed ? (snapshot?.failureCategory ?? 'internal') : null;
  return { running, awaitingResults, graded, refused, failed, gradeFailed, failureCategory, canceled };
}
