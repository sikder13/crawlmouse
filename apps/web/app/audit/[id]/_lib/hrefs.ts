/**
 * The paths of a v2 check's pages, as the audit routes use them: `auditHrefs` from
 * lib/v2/view/audit-hrefs.ts, and the segment a route's path part names.
 */
import { SEGMENT_KEYS, type SegmentKey } from '../../../../lib/v2/view/segment/frame';

export { auditHrefs, type AuditHrefs } from '../../../../lib/v2/view/audit-hrefs';

/** The segment a path's last part names, or null. */
export const segmentKeyOf = (value: string): SegmentKey | null =>
  (SEGMENT_KEYS as readonly string[]).includes(value) ? (value as SegmentKey) : null;
