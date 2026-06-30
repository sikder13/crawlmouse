import type { ClientAuditV2 } from './audit-stream-projection';

/**
 * Discriminate a completed-audit SSE snapshot as the SPEC 02 conversion-core payload (ClientAuditV2)
 * vs a legacy v1 payload. The marker is `crawlHealth != null` — the client mirror of the server's
 * `isV2 = row.confidence != null` (the SSE route sets crawlHealth iff the v2 engine produced one).
 *
 * `entitlement` is NOT a usable marker: the SSE route populates it on EVERY completed audit (v1
 * included), so keying off it routes v1 audits (projectedGrade=null, findings=[]) into the full
 * ResultView and renders a FALSE "clean bill of health". Always discriminate on crawlHealth.
 */
export function asClientAuditV2(
  snapshot: { crawlHealth?: unknown } | null | undefined,
): ClientAuditV2 | null {
  if (!snapshot) return null;
  // The cast is sound because callers render this ONLY at the terminal `done` edge (gated on `graded`),
  // where a v2 payload carries every ClientAuditV2 field; progress ticks have crawlHealth null → null here.
  return snapshot.crawlHealth != null ? (snapshot as unknown as ClientAuditV2) : null;
}
