import { AuditProgress } from '@/components/audit/AuditProgress';
import { ActivityFeed } from '@/components/audit/ActivityFeed';
import { EmailWhenDone } from '@/components/audit/EmailWhenDone';
import { EducationalCards } from '@/components/audit/EducationalCards';
import { GradeCard } from '@/components/ui/GradeCard';
import { Card } from '@/components/ui/Card';
import { SharePanel } from '@/components/share/SharePanel';
import { FindingsPanel } from '@/components/audit/FindingsPanel';
import { UpgradeCard } from '@/components/billing/UpgradeCard';
import { Button, buttonClasses } from '@/components/ui/Button';
import { GradeCardSkeleton } from '@/components/ui/GradeCardSkeleton';
import { ResultView } from '@/components/audit/ResultView';
import { track } from '@/lib/analytics';
import { deriveAuditViewState, decideAuditSurface, type AuditSnapshotLite, type AuditSurfaceDescriptor } from '@/lib/audit-view-state';
import { asClientAuditV2 } from '@/lib/audit-v2';
import type { CrawlActivityEvent } from '@crawlmouse/types';

/**
 * THE DESCRIPTOR → COMPONENT MAP. One `switch`, one element per case, and NO CONDITION OF ITS OWN.
 *
 * Everything that decides WHICH screen appears lives in `decideAuditSurface` (`lib/audit-view-state`)
 * and is proved by execution. This file only renders what it is handed — which is the point: after
 * four gates in which a source guard failed to police the decision inside JSX, the decision left the
 * JSX. There is no expression here to weaken, no `&&` chain to prefix, and no branch to duplicate.
 *
 * IT IS SEPARATE FROM `AuditView` SO IT CAN BE RENDERED IN A TEST. This one is a plain function of its
 * props and renders through `renderToStaticMarkup` like every other component here, which is what
 * makes "the map is trivial" a measured claim rather than an assertion.
 *
 * (When this was written, `AuditView` mounted in no test at all. It does now — `AuditView.test.tsx`,
 * per-file jsdom, replaying sequences captured from the real SSE route — so the two are complementary
 * rather than one substituting for the other: that file covers the stream hop, this one the map.)
 *
 * THE EXHAUSTIVENESS CHECK IS LOAD-BEARING. The `never` assignment at the end means adding a
 * descriptor kind without a case is a COMPILE error, not a blank screen — the failure mode the old
 * catch-all `{surface === 'error' && …}` was there to paper over.
 */
export interface AuditSurfaceDeps {
  auditId: string;
  /** Live progress values. Not decisions — the descriptor already made the only decision. */
  pageCount: number;
  pageCap: number;
  status: string;
  pagesCrawled?: number | null;
  estimatedTotal?: number | null;
  phase?: string | null;
  stalled: boolean;
  activityFeed: CrawlActivityEvent[];
  canceling: boolean;
  cancelError: string | null;
  onCancel: () => void;
  /** Entry point, from `?view=ai`. Reorders the result arc; absent leaves it untouched. */
  resultView?: 'ai';
}

/**
 * THE WHOLE CHAIN LIVES HERE, because this component is executable and `AuditView` is not.
 *
 * Gate 6 produced two evasions that mutated what was FED to the decision rather than the decision or
 * the branch table — and no test could see them, because they sat in the EventSource-driven component
 * that nothing mounted. Moving `deriveAuditViewState` → `asClientAuditV2` → `decideAuditSurface` in
 * here puts every one of those inputs under `renderToStaticMarkup`, so `AuditView` is left passing raw
 * stream state (`snapshot`, `done`) through. That remaining hop is no longer unexecuted either:
 * `AuditView.test.tsx` mounts the component and replays real captured streams through it.
 */
export type AuditSnapshotForView = AuditSnapshotLite & { page_count?: number | null; crawlHealth?: unknown };

export function AuditSurfaceView({
  snapshot,
  done,
  deps,
}: {
  snapshot: AuditSnapshotForView | null;
  done: boolean;
  deps: AuditSurfaceDeps;
}) {
  // The `done` payload alone carries orphanCount/avgDepth — gate the numeric stats behind their
  // PRESENCE (not merely `done`) so neither the completed-but-pre-done window NOR a `done`-via-`error`
  // snapshot (which kept a prior tick's grade+score but has no stats) can render a 0/0 GradeCard.
  const hasResults = snapshot?.orphanCount != null && snapshot?.avgDepth != null;
  const state = deriveAuditViewState(snapshot, done, hasResults);
  const descriptor = decideAuditSurface(state, snapshot, asClientAuditV2(snapshot));
  return <AuditSurfaceMap descriptor={descriptor} deps={deps} />;
}

/** The map alone, so a test can render an arbitrary descriptor — including ones no snapshot reaches. */
export function AuditSurfaceMap({
  descriptor,
  deps,
}: {
  descriptor: AuditSurfaceDescriptor;
  deps: AuditSurfaceDeps;
}) {
  switch (descriptor.kind) {
    case 'running':
      return (
        <>
          <AuditProgress
            pageCount={deps.pageCount}
            pageCap={deps.pageCap}
            status={deps.status}
            pagesCrawled={deps.pagesCrawled}
            estimatedTotal={deps.estimatedTotal}
            phase={deps.phase}
            stalled={deps.stalled}
          />
          <ActivityFeed events={deps.activityFeed} />
          <EmailWhenDone auditId={deps.auditId} />
          <EducationalCards />
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={deps.onCancel} disabled={deps.canceling}>
              {deps.canceling ? 'Canceling…' : 'Cancel audit'}
            </Button>
            {deps.cancelError ? <span className="text-warning text-sm">{deps.cancelError}</span> : null}
          </div>
        </>
      );

    case 'awaiting':
      return <GradeCardSkeleton />;

    // SPEC 5.1a §4 (refused) and SPEC 02 (graded) render the SAME arc. `ResultView` reads the verdict
    // from the audit's own refusal payload — the descriptor's `verdict` is provenance for tests, and
    // deliberately not a second decision the render could disagree with.
    case 'result':
      return <ResultView audit={descriptor.audit} view={deps.resultView} />;

    case 'graded-legacy':
      return (
        <>
          <GradeCard
            grade={descriptor.grade}
            score={descriptor.score}
            orphanCount={descriptor.orphanCount}
            avgDepth={descriptor.avgDepth}
            passing={descriptor.score >= 60}
          />
          <SharePanel auditId={deps.auditId} />
          {descriptor.findingGroups ? <FindingsPanel groups={descriptor.findingGroups} /> : null}
          {descriptor.viewerIsPro ? (
            <a
              href={`/api/audits/${deps.auditId}/export`}
              onClick={() => track('csv-download', { auditId: deps.auditId })}
              className={buttonClasses({ variant: 'secondary', className: 'w-full' })}
            >
              Download CSV
            </a>
          ) : (
            <UpgradeCard headline="Export every finding + page as CSV." sub="Sortable spreadsheet of your whole site." />
          )}
        </>
      );

    case 'error':
      return (
        <Card>
          <h2 className="font-display font-bold text-2xl text-warning">{descriptor.copy.title}</h2>
          <p className="mt-2 text-ink/70">{descriptor.copy.body}</p>
        </Card>
      );

    case 'canceled':
      return (
        <Card>
          <h2 className="font-display font-bold text-2xl">Audit canceled</h2>
          <p className="mt-2 text-ink/70">
            You stopped this audit before it finished. <a href="/" className="text-peach underline">Run another</a>.
          </p>
        </Card>
      );

    case 'none':
      return null;

    default: {
      const exhaustive: never = descriptor;
      return exhaustive;
    }
  }
}
