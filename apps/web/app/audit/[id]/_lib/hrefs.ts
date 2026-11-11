/**
 * The paths of an audit's pages (CC-22b D4), built in one place: the overview, the six segments,
 * a fix and the link map in its two scopes.
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
  const overview = `/audit/${checkId}`;
  return {
    overview,
    segment: (key) => `${overview}/${key}`,
    fix: (fixId) => `${overview}/fix/${fixId}`,
    map: { hubs: `${overview}/map`, all: `${overview}/map?scope=all` },
    check: (other) => `/audit/${other}`,
  };
}

/** The segment a path's last part names, or null. */
export const segmentKeyOf = (value: string): SegmentKey | null =>
  (SEGMENT_KEYS as readonly string[]).includes(value) ? (value as SegmentKey) : null;
