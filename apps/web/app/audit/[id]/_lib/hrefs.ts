/**
 * The paths of a v2 check's pages (CC-22b D4), built in one place: the overview, the six
 * segments, a fix and the link map in its two scopes. `/audit/[id]` itself is the v1 audit page,
 * which sends a v2 check to its overview.
 */
import type { FixHrefs } from '../../../../lib/v2/view/fix';
import { SEGMENT_KEYS, type SegmentKey } from '../../../../lib/v2/view/segment/frame';

export interface AuditHrefs extends Required<FixHrefs> {
  overview: string;
  segment: (key: SegmentKey) => string;
  fix: (fixId: string) => string;
  map: { hubs: string; all: string };
  check: (checkId: string) => string;
}

export function auditHrefs(checkId: string): AuditHrefs {
  const base = `/audit/${checkId}`;
  return {
    overview: `${base}/overview`,
    segment: (key) => `${base}/${key}`,
    fix: (fixId) => `${base}/fix/${fixId}`,
    map: { hubs: `${base}/map`, all: `${base}/map?scope=all` },
    // Another check's own address: `/audit/[id]` sends a v2 check on to its overview.
    check: (other) => `/audit/${other}`,
  };
}

/** The segment a path's last part names, or null. */
export const segmentKeyOf = (value: string): SegmentKey | null =>
  (SEGMENT_KEYS as readonly string[]).includes(value) ? (value as SegmentKey) : null;
