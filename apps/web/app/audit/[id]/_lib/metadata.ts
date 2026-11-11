/**
 * The metadata of each page under `/audit/[id]` (CC-22b): never indexed, because the id in the
 * path is the capability to read the audit, with the page's own path (from `auditHrefs`) as its
 * canonical. The root
 * layout's metadata (index, canonical "/") does not reach these routes' own values, so each route
 * file exports `generateMetadata` built here; `audit-routes.test.ts` holds each to it.
 */
import type { Metadata } from 'next';

export function auditMetadata(path: string): Metadata {
  return { robots: { index: false, follow: true }, alternates: { canonical: path } };
}
