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
}

export interface AuditViewState {
  running: boolean;          // crawl in progress
  awaitingResults: boolean;  // terminal=completed but done payload not yet received → skeleton
  graded: boolean;           // safe to render GradeCard with REAL numbers (stats present)
  failed: boolean;
  gradeFailed: boolean;      // terminal (done) but not graded — catch-all so a missing/failed/
                             // stats-less done payload always reaches the "couldn't grade" card,
                             // never a blank render and never a misleading 0-orphans/0.0-depth card
  failureCategory: FailureCategory | null; // which failure copy to show — set ONLY when failed
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
  const hasGrade = !!snapshot?.grade && snapshot?.score != null;
  // `graded` (render GradeCard with real numbers) requires BOTH the grade AND the stats payload.
  // The orphanCount/avgDepth come only with the `done` event, so a `progress` snapshot that
  // happens to carry grade+score (when the server then emits `error` instead of `done`) must NOT
  // be treated as graded — it would show a permanent 0 orphans / 0.0 depth.
  const graded = done && completed && hasGrade && hasResults;
  // `done` can arrive via the terminal `done` event OR a named stream `error` event (result
  // finalization failed) whose last snapshot may still read 'completed' (with or without a grade)
  // — or, defensively, a non-terminal status. Make gradeFailed the catch-all terminal-but-not-
  // graded state so a missing/failed/stats-less `done` payload always reaches the "couldn't
  // grade / try again" card and a blank (or 0/0) render is unrepresentable.
  const gradeFailed = done && !failed && !graded;
  const awaitingResults = completed && !failed && !done;
  const running = !completed && !failed && !done;
  // The failure copy is keyed off the category, but ONLY a genuinely failed audit shows it; a
  // stray category on a non-failed snapshot is dropped so failure copy can't leak into the
  // running/graded/gradeFailed states. A failed audit always has a category server-side; default
  // to 'internal' defensively so the copy is never blank.
  const failureCategory = failed ? (snapshot?.failureCategory ?? 'internal') : null;
  return { running, awaitingResults, graded, failed, gradeFailed, failureCategory };
}
