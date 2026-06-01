'use client';

import { useEffect, useState } from 'react';

export interface AuditSnapshot {
  id: string;
  status: string;
  grade?: string | null;
  score?: number | null; // coerced to a real number server-side (PostgREST numeric -> string)
  page_count?: number | null;
  orphanCount?: number;
  avgDepth?: number;
  settings?: { pageCap?: number } | null;
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
    const onData = (e: Event) => setSnapshot(JSON.parse((e as MessageEvent).data));
    es.addEventListener('snapshot', onData);
    es.addEventListener('progress', onData);
    es.addEventListener('done', (e) => {
      setSnapshot(JSON.parse((e as MessageEvent).data));
      setFinished(true);
      es.close();
    });
    return () => es.close();
  }, [auditId]);
  return { snapshot, finished };
}
