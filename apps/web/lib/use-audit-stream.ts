'use client';

import { useEffect, useState } from 'react';
import { wireAuditStream } from './audit-stream-wiring';

export interface AuditSnapshot {
  id: string;
  status: string;
  grade?: string | null;
  score?: number | null; // coerced to a real number server-side (PostgREST numeric -> string)
  page_count?: number | null;
  orphanCount?: number;
  avgDepth?: number;
  settings?: { pageCap?: number } | null;
  /**
   * SPEC 5.1a §4 — the persisted refusal decision, already on this SSE payload
   * (`AUDIT_COLS` → `projectAuditForClient`). DECLARED HERE because gate 5 / B5-2 found the compare
   * page could not tell a WITHHELD verdict from a FAILED audit: it had the discriminator on the wire
   * and no type saying so, so `columnState` collapsed both into one bucket and the banner asserted
   * "not enough evidence" about an audit that had errored.
   */
  refusal?: { refused?: boolean } | null;
}

export interface AuditStream {
  snapshot: AuditSnapshot | null;
  /**
   * True once the terminal `done` event has arrived. The interim `progress` event
   * can report status 'completed' *before* the `done` event carries orphanCount/
   * avgDepth, so consumers that show those stats should wait for `finished` to avoid
   * a flash of zeros.
   */
  finished: boolean;
}

/**
 * Subscribe to an audit's live result stream (the capability-URL SSE endpoint).
 * Returns the latest snapshot plus whether the terminal event has landed. Closes on
 * `done`. Shared by the single-audit and head-to-head compare views.
 */
export function useAuditStream(auditId: string): AuditStream {
  const [snapshot, setSnapshot] = useState<AuditSnapshot | null>(null);
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    setSnapshot(null);
    setFinished(false);
    const es = new EventSource(`/api/audits/${auditId}/stream`);
    // Shared wiring (lib/audit-stream-wiring) — `done` and the named-`error`-vs-native-transport-
    // error semantics are unit-tested in one place so this hook and AuditView can't drift.
    wireAuditStream(es, {
      onSnapshot: (payload) => setSnapshot(payload as AuditSnapshot),
      onDone: () => setFinished(true),
      onTerminalError: () => setFinished(true),
    });
    return () => es.close();
  }, [auditId]);
  return { snapshot, finished };
}
