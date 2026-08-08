import { FAILURE_COPY, type FailureCategory } from './failure-classification';
import type { FindingGroup } from './findings';
import type { ClientAuditV2 } from './audit-stream-projection';

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
   *
   * REQUIRED, NOT OPTIONAL — and that is the point. While it was optional, a `Pick`/mapping refactor
   * of the SSE payload could DROP the field and `tsc` stayed clean, because an absent optional key is
   * a valid `AuditSnapshotLite`; the state then derived `refused: false` and gate 3's blocker was live
   * again. That evasion survived gate 7. `projectAuditForClient` emits `refusal: row.refusal ?? null`
   * on EVERY payload — base, progress and done — so requiring it here is a true claim about the wire,
   * and omitting it is now a compile error instead of a silent behaviour change. Nullable, because
   * `null` is the honest value for an audit that was not refused; what is forbidden is SILENCE.
   */
  refusal: { refused?: boolean } | null;
  /**
   * The pre-integration (v1) render payload. Carried here so `decideAuditSurface` can put it INTO the
   * descriptor: the view then renders it without a non-null assertion, and the legacy branch becomes
   * as assertable as every other one.
   */
  orphanCount?: number;
  avgDepth?: number;
  findingGroups?: FindingGroup[];
  viewerIsPro?: boolean;
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
  // `hasResults` GATES REFUSED EXACTLY AS IT GATES GRADED — gate 7 / B4.
  //
  // It did not, and that was a crash. The SSE route emits the BASE `ClientAudit` on `snapshot` and
  // `progress` and only the terminal `done` event carries `findings`/`entitlement`; when `buildDone`
  // throws, the route sends a named `error`, `done` flips true, and the last snapshot is that base
  // payload. `asClientAuditV2` keys only on `crawlHealth != null` and CASTS — its own docstring
  // states the precondition ("callers render this ONLY at the terminal done edge, gated on graded") —
  // so a refused audit reached `ResultView` with no `findings` and threw
  // `TypeError: Cannot read properties of undefined (reading 'filter')` on the primary result page.
  // On `main` the same path degraded to the "couldn't grade" card. A crash is worse than the card it
  // replaced, so refused is held to the same terminal-payload requirement as graded.
  const refused = done && completed && hasResults && snapshot?.refusal?.refused === true;
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

/**
 * WHICH SCREEN THE AUDIT PAGE DRAWS — as DATA, not as a string the JSX then re-interprets.
 *
 * WHY THIS SHAPE. The render decision lived in JSX and was verified by a SOURCE GUARD, because
 * `AuditView` is an EventSource-driven client component and this suite has no jsdom, so it never
 * mounts in any test. That guard was found weaker than its own docstring at FOUR consecutive gates,
 * and the last produced four independent edits that restored gate 3's blocker — a refused audit
 * rendering "usually a site that blocks crawlers" — with the whole suite green and `tsc` clean:
 *
 *   · a ONE-LINE `if (state.refused) return <failure card>;` (the return counter matched only a
 *     `return` that BEGINS a line, so the fix had closed exactly one spelling)
 *   · an ADDITIVE `{state.refused && <failure card>}` branch beside the real one
 *   · `chooseSurface(state.refused ? { ...state, refused: false, failed: true } : state, …)`
 *   · `const v2 = state.refused ? null : asClientAuditV2(snapshot)`
 *
 * The last two are the tell: they mutate what is FED to the decision, which no guard over the branch
 * table can see. THE MEDIUM WAS THE DEFECT, NOT THE COVERAGE. So the logic leaves the unverifiable
 * medium — this function decides everything and returns a descriptor a test asserts directly, and the
 * view becomes a switch with one element per case and no condition of its own. A fifth evasion has
 * nothing left to evade, because there is no expression in the JSX to weaken.
 *
 * THE DESCRIPTOR CARRIES ITS DATA. `result` carries the audit and `graded-legacy` carries the values
 * it renders, which deletes every `v2!` and `snapshot!` assertion from the view: the type now makes
 * rendering `ResultView` without an audit impossible.
 *
 * PRECEDENCE, and why each step sits where it does:
 *   1. `canceled` — the user stopped it. Not a failure, and nothing else is worth saying.
 *   2. `running` / `awaiting` — non-terminal; the result surfaces need a terminal audit.
 *   3. `refused` BEFORE `graded` and before the error card. A withheld verdict is not a failure, and
 *      routing it to the failure card is the exact defect gates 3–6 kept re-finding.
 *   4. `graded`, v2 then legacy.
 *   5. the error card LAST, as the catch-all — including a refusal with no v2 payload, structurally
 *      unreachable (`decideRefusal` runs only on the v2 path) and never allowed to be blank.
 */
export type AuditSurfaceDescriptor =
  | { kind: 'canceled' }
  | { kind: 'running' }
  | { kind: 'awaiting' }
  /** The Stage 4 / SPEC 02 arc. `verdict` records WHY, so a test can tell the two apart. */
  | { kind: 'result'; verdict: 'refused' | 'graded'; audit: ClientAuditV2 }
  | {
      kind: 'graded-legacy';
      grade: string;
      score: number;
      orphanCount: number;
      avgDepth: number;
      findingGroups: FindingGroup[] | null;
      viewerIsPro: boolean;
    }
  | { kind: 'error'; copy: { title: string; body: string } }
  | { kind: 'none' };

/** Copy for a completed-but-ungradable crawl. NOT a refusal — those live in `refusal-copy.ts`. */
const COULD_NOT_GRADE = {
  title: 'Couldn’t grade this site',
  body: 'The crawl finished but we couldn’t compute a grade — usually a site that blocks crawlers or has no crawlable pages. Try again or contact support.',
};

export function decideAuditSurface(
  state: AuditViewState,
  snapshot: AuditSnapshotLite | null,
  v2: ClientAuditV2 | null,
): AuditSurfaceDescriptor {
  if (state.canceled) return { kind: 'canceled' };
  if (state.running) return { kind: 'running' };
  if (state.awaitingResults) return { kind: 'awaiting' };
  if (state.refused) {
    return v2 ? { kind: 'result', verdict: 'refused', audit: v2 } : { kind: 'error', copy: COULD_NOT_GRADE };
  }
  if (state.graded) {
    if (v2) return { kind: 'result', verdict: 'graded', audit: v2 };
    // `graded` already requires a non-null grade AND score, so the legacy payload is complete here.
    return {
      kind: 'graded-legacy',
      grade: snapshot!.grade!,
      score: snapshot!.score!,
      orphanCount: snapshot?.orphanCount ?? 0,
      avgDepth: snapshot?.avgDepth ?? 0,
      findingGroups: snapshot?.findingGroups ?? null,
      viewerIsPro: snapshot?.viewerIsPro ?? false,
    };
  }
  if (state.failed) return { kind: 'error', copy: FAILURE_COPY[state.failureCategory ?? 'internal'] };
  if (state.gradeFailed) return { kind: 'error', copy: COULD_NOT_GRADE };
  return { kind: 'none' };
}
