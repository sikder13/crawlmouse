'use client';

import { useEffect, useState } from 'react';
import { AuditProgress } from '@/components/audit/AuditProgress';
import { DripFeedFindings } from '@/components/audit/DripFeedFindings';
import { GradeCard } from '@/components/ui/GradeCard';
import { Card } from '@/components/ui/Card';
import { SharePanel } from '@/components/share/SharePanel';
import { FindingsPanel } from '@/components/audit/FindingsPanel';
import { UpgradeCard } from '@/components/billing/UpgradeCard';
import { Button } from '@/components/ui/Button';
import { GradeCardSkeleton } from '@/components/ui/GradeCardSkeleton';
import { ResultView } from '@/components/audit/ResultView';
import { FREE_PAGE_CAP } from '@/lib/limits';
import { deriveAuditViewState } from '@/lib/audit-view-state';
import { FAILURE_COPY, type FailureCategory } from '@/lib/failure-classification';
import { wireAuditStream } from '@/lib/audit-stream-wiring';
import { track, trackRaw } from '@/lib/analytics';
import { auditCompletedProps } from '@/lib/audit-completed-event';
import type { FindingGroup } from '@/lib/findings';
import type { ClientAuditV2 } from '@/lib/audit-stream-projection';

interface Snapshot {
  id: string;
  status: string;
  grade?: string | null;
  score?: number | null; // coerced to a real number server-side (PostgREST serializes numeric as a string)
  page_count?: number | null;
  link_count?: number | null;
  cms_detected?: string | null;
  settings?: { pageCap?: number } | null;
  findingGroups?: FindingGroup[];
  viewerIsPro?: boolean;
  orphanCount?: number;
  avgDepth?: number;
  failureCategory?: FailureCategory | null; // coarse failure bucket (server-classified); drives the failure copy
  crawlHealth?: { confidence: string; coveragePct: number; blockRate: number; partial: boolean } | null; // §6/§10 (v2)
  entitlement?: unknown; // present ⇒ this is the SPEC 02 ClientAuditV2 payload (conversion core)
}

// Integration seam: the SPEC 02 conversion-core stream emits a ClientAuditV2 (carries `entitlement`).
// Until that merges, the live stream emits the legacy payload (no entitlement) → we keep the current
// rendering. When a V2 payload arrives, we render the full conversion arc (ResultView). Casting is
// safe because the presence of `entitlement` is the V2 marker the server sets on the same chokepoint.
function asV2(s: Snapshot): ClientAuditV2 | null {
  return 'entitlement' in s && (s as { entitlement?: unknown }).entitlement != null
    ? (s as unknown as ClientAuditV2)
    : null;
}

export function AuditView({ auditId }: { auditId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [done, setDone] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  // Real per-audit cap (free = 500, Pro = 2000), threaded from the audit's settings via the stream.
  const pageCap = snapshot?.settings?.pageCap ?? FREE_PAGE_CAP;

  useEffect(() => {
    const es = new EventSource(`/api/audits/${auditId}/stream`);
    // Shared wiring (lib/audit-stream-wiring): `done` and the named-`error`-vs-native-error
    // distinction live in one unit-tested place. A terminal error sets done=true so the last
    // snapshot resolves to the "couldn't grade" card, not a forever-spinning skeleton.
    wireAuditStream(es, {
      onSnapshot: (payload) => setSnapshot(payload as Snapshot),
      onDone: () => setDone(true),
      onTerminalError: () => setDone(true),
    });
    return () => es.close();
  }, [auditId]);

  // Fire `audit-completed` exactly once when the stream terminates. `onSnapshot` runs before
  // `onDone` in the same `done` event (see wireAuditStream), so `snapshot` is current here.
  // Keyed on the `done` edge only (reading the latest snapshot is intentional, not a dep).
  useEffect(() => {
    if (!done || !snapshot) return;
    track('audit-completed', auditCompletedProps(snapshot));
    // Conversion-spine event (interim trackRaw; SPEC 02 owns adding it to the typed funnel).
    const v2 = asV2(snapshot);
    if (v2 && v2.grade != null) trackRaw('grade_revealed', { grade: v2.grade });
  }, [done]);

  // The `done` payload alone carries orphanCount/avgDepth — gate the numeric stats behind their
  // PRESENCE (not merely `done`) so neither the brief completed-but-pre-done window NOR a
  // `done`-via-`error` snapshot (which kept a prior progress tick's grade+score but has no stats)
  // can render a 0-orphans / 0.0-depth GradeCard. Without stats the view falls back to the
  // "couldn't grade" card.
  const hasResults = snapshot?.orphanCount != null && snapshot?.avgDepth != null;
  const { running, awaitingResults, graded, failed, gradeFailed, failureCategory, canceled } = deriveAuditViewState(snapshot, done, hasResults);
  const v2 = snapshot ? asV2(snapshot) : null;
  // Distinct failure copy: a true crawl failure shows the classified reason (timeout / dns /
  // blocked / internal); a completed-but-ungradable crawl keeps the "couldn't grade" explanation.
  const resultErrorCopy = failed
    ? FAILURE_COPY[failureCategory ?? 'internal']
    : {
        title: 'Couldn’t grade this site',
        body: 'The crawl finished but we couldn’t compute a grade — usually a site that blocks crawlers or has no crawlable pages. Try again or contact support.',
      };

  async function cancelAudit() {
    setCanceling(true);
    setCancelError(null);
    try {
      const res = await fetch(`/api/audits/${auditId}/cancel`, { method: 'POST' });
      // On success the SSE stream picks up status='canceled' and re-renders. A 409 means it already
      // finished — let the stream resolve it; other errors surface inline.
      if (!res.ok && res.status !== 409) setCancelError('Could not cancel — please try again.');
    } catch {
      setCancelError('Network error — please try again.');
    } finally {
      setCanceling(false);
    }
  }

  return (
    <div className="space-y-6">
      {running && <AuditProgress pageCount={snapshot?.page_count ?? 0} pageCap={pageCap} status={snapshot?.status ?? 'pending'} />}
      {running && <DripFeedFindings active={running} />}
      {running && (
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={cancelAudit} disabled={canceling}>{canceling ? 'Canceling…' : 'Cancel audit'}</Button>
          {cancelError && <span className="text-warning text-sm">{cancelError}</span>}
        </div>
      )}
      {awaitingResults && <GradeCardSkeleton />}

      {/* SPEC 02 conversion-core payload → the full arc. */}
      {graded && v2 && <ResultView audit={v2} />}

      {/* Legacy payload (pre-integration) → current rendering. Unchanged. */}
      {graded && !v2 && (
        <>
          <GradeCard
            grade={snapshot!.grade!}
            score={snapshot!.score!}
            orphanCount={snapshot?.orphanCount ?? 0}
            avgDepth={snapshot?.avgDepth ?? 0}
            passing={(snapshot!.score ?? 0) >= 60}
          />
          <SharePanel auditId={auditId} />
          {snapshot?.findingGroups && <FindingsPanel groups={snapshot.findingGroups} />}
          {snapshot?.viewerIsPro ? (
            <a href={`/api/audits/${auditId}/export`} onClick={() => track('csv-download', { auditId })}>
              <Button variant="secondary" className="w-full">Download CSV</Button>
            </a>
          ) : (
            <UpgradeCard headline="Export every finding + page as CSV." sub="Sortable spreadsheet of your whole site." />
          )}
        </>
      )}

      {(failed || gradeFailed) && (
        <Card>
          <h2 className="font-display font-bold text-2xl text-warning">{resultErrorCopy.title}</h2>
          <p className="mt-2 text-ink/70">{resultErrorCopy.body}</p>
        </Card>
      )}
      {canceled && (
        <Card>
          <h2 className="font-display font-bold text-2xl">Audit canceled</h2>
          <p className="mt-2 text-ink/70">You stopped this audit before it finished. <a href="/" className="text-peach underline">Run another</a>.</p>
        </Card>
      )}
    </div>
  );
}
