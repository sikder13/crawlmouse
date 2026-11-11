/**
 * The paths of a v2 check's pages (CC-22b D4): the overview, the six segments, a fix and the link
 * map in its two scopes. `/audit/[id]` itself is the v1 audit page, which sends a v2 check to its
 * overview. This module imports types only (`app/audit/[id]/audit-routes.test.tsx` reads its
 * imports), so a client component and the v1 page can import it.
 * `app/audit/[id]/_lib/hrefs.test.ts` lists the files that still write such a path by hand.
 */
import type { FixHrefs } from './fix';
import type { SegmentKey } from './segment/frame';

export interface AuditHrefs extends Required<FixHrefs> {
  overview: string;
  segment: (key: SegmentKey) => string;
  fix: (fixId: string) => string;
  map: { hubs: string; all: string };
  check: (checkId: string) => string;
}

/** A check's own address: `/audit/[id]` sends a v2 check on to its overview. */
export const auditHref = (checkId: string): string => `/audit/${checkId}`;

export function auditHrefs(checkId: string): AuditHrefs {
  const base = auditHref(checkId);
  return {
    overview: `${base}/overview`,
    segment: (key) => `${base}/${key}`,
    fix: (fixId) => `${base}/fix/${fixId}`,
    map: { hubs: `${base}/map`, all: `${base}/map?scope=all` },
    check: auditHref,
  };
}
