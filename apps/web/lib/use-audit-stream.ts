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

/**
 * Subscribe to an audit's live result stream (the capability-URL SSE endpoint).
 * Returns the latest snapshot, or null until the first event. Closes on `done`.
 * Shared by the single-audit and head-to-head compare views.
 */
export function useAuditStream(auditId: string): AuditSnapshot | null {
  const [snapshot, setSnapshot] = useState<AuditSnapshot | null>(null);
  useEffect(() => {
    setSnapshot(null);
    const es = new EventSource(`/api/audits/${auditId}/stream`);
    const onData = (e: Event) => setSnapshot(JSON.parse((e as MessageEvent).data));
    es.addEventListener('snapshot', onData);
    es.addEventListener('progress', onData);
    es.addEventListener('done', (e) => {
      setSnapshot(JSON.parse((e as MessageEvent).data));
      es.close();
    });
    return () => es.close();
  }, [auditId]);
  return snapshot;
}
