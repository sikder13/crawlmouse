'use client';

import { useEffect, useRef, useState } from 'react';
import { FREE_PAGE_CAP } from '@/lib/limits';
import { deriveAuditViewState, decideAuditSurface } from '@/lib/audit-view-state';
import { AuditSurfaceView } from './AuditSurfaceView';
import { wireAuditStream } from '@/lib/audit-stream-wiring';
import { reduceActivity, isStalled, shouldShowStall, type ActivityState } from '@/lib/audit-activity';
import type { CrawlActivityEvent } from '@crawlmouse/types';
import { track } from '@/lib/analytics';
import { auditCompletedProps } from '@/lib/audit-completed-event';
import type { FindingGroup } from '@/lib/findings';
import type { FailureCategory } from '@/lib/failure-classification';
import { asClientAuditV2 } from '@/lib/audit-v2';

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
  /**
   * SPEC 5.1a §4 — the persisted refusal decision, emitted by the SSE route (`AUDIT_COLS` ->
   * `projectAuditForClient`). DECLARED HERE DELIBERATELY (gate 4, R1-NB6 / R3-NB3): it reached the
   * component at runtime and typechecked only because `AuditSnapshotLite.refusal` is optional, so a
   * `Pick`/mapping refactor of the SSE payload could drop it and re-break gate 3's blocker with
   * `tsc` green. The whole first-class refused state rests on this field; the type says so now.
   */
  refusal?: { refused?: boolean } | null;
  entitlement?: unknown; // set on EVERY completed audit (v1 too) — NOT the v2 marker; see asClientAuditV2 (keys on crawlHealth)
}

// v1/v2 discrimination is the pure, unit-tested asClientAuditV2 (lib/audit-v2): the marker is
// crawlHealth (the client mirror of the server's isV2), NOT entitlement — the SSE route sets
// entitlement on EVERY completed audit, so keying off it would render a v1 audit's empty conversion
// payload as a false "clean bill of health" while ENGINE_V2 is dark.

export function AuditView({ auditId }: { auditId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [done, setDone] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  // SPEC 04 §2 — activity state, folded exclusively from real `activity` SSE events.
  const [activity, setActivity] = useState<ActivityState | undefined>(undefined);
  // SPEC 04 §13/§14 — fire `activity_feed_first_event` once per audit on the FIRST real activity event
  // (the time-to-first-value signal). Ref-guarded so it's exactly-once (not per event), reset per audit.
  const firstActivityFired = useRef(false);
  // Staleness clock for the honest stall state. The interval only OBSERVES the absence of events
  // (so the stall line can appear); progress itself never advances on time.
  const [nowTick, setNowTick] = useState(() => Date.now());
  // Real per-audit cap (free = 500, Pro = 2000), threaded from the audit's settings via the stream.
  const pageCap = snapshot?.settings?.pageCap ?? FREE_PAGE_CAP;

  useEffect(() => {
    // Reset all per-audit derived state so a soft navigation /audit/A → /audit/B never shows A's
    // feed/snapshot or drops B's low-seq events against A's stale watermark.
    setSnapshot(null);
    setDone(false);
    setActivity(undefined);
    firstActivityFired.current = false;
    const es = new EventSource(`/api/audits/${auditId}/stream`);
    // Shared wiring (lib/audit-stream-wiring): `done` and the named-`error`-vs-native-error
    // distinction live in one unit-tested place. A terminal error sets done=true so the last
    // snapshot resolves to the "couldn't grade" card, not a forever-spinning skeleton.
    wireAuditStream(es, {
      onSnapshot: (payload) => setSnapshot(payload as Snapshot),
      onDone: () => setDone(true),
      onTerminalError: () => setDone(true),
      onActivity: (payload) => setActivity((s) => reduceActivity(s, payload as CrawlActivityEvent[])),
    });
    return () => es.close();
  }, [auditId]);

  useEffect(() => {
    if (done) return;
    const t = setInterval(() => setNowTick(Date.now()), 5000);
    return () => clearInterval(t);
  }, [done]);

  // SPEC 04 §13/§14 — time-to-first-value: fire once when the first real activity event arrives.
  useEffect(() => {
    if (activity !== undefined && !firstActivityFired.current) {
      firstActivityFired.current = true;
      track('activity_feed_first_event');
    }
  }, [activity]);

  // Fire `audit-completed` exactly once when the stream terminates. `onSnapshot` runs before
  // `onDone` in the same `done` event (see wireAuditStream), so `snapshot` is current here.
  // Keyed on the `done` edge only (reading the latest snapshot is intentional, not a dep).
  useEffect(() => {
    if (!done || !snapshot) return;
    track('audit-completed', auditCompletedProps(snapshot));
    // Conversion-spine event — now in SPEC 02's typed funnel (FUNNEL_EVENTS).
    const v2 = asClientAuditV2(snapshot);
    if (v2 && v2.grade != null) track('grade_revealed', { grade: v2.grade });
  }, [done]);


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
      {/* THIS COMPONENT MAKES NO RENDER DECISION AT ALL. The whole chain — state derivation, v2
          discrimination, surface choice, and the descriptor→component map — lives inside
          `AuditSurfaceView`, which is a plain function of its props and is executed in tests. What is
          left here is the EventSource plumbing and raw stream state passed through. After four gates
          in which a source guard failed to police a decision living in unmountable JSX, the decision
          moved to where a test can run it. */}
      <AuditSurfaceView
        snapshot={snapshot}
        done={done}
        deps={{
          auditId,
          pageCount: snapshot?.page_count ?? 0,
          pageCap,
          status: snapshot?.status ?? 'pending',
          pagesCrawled: activity?.pagesCrawled,
          estimatedTotal: activity?.estimatedTotal,
          phase: activity?.phase,
          stalled: shouldShowStall(snapshot?.status, activity?.phase, isStalled(activity, nowTick)),
          activityFeed: activity?.feed ?? [],
          canceling,
          cancelError,
          onCancel: cancelAudit,
        }}
      />
    </div>
  );
}
