'use client';

import { useEffect } from 'react';

/** The view route of a shared report: `POST /api/reports/<slug>/view`. */
export const reportViewPath = (slug: string) => `/api/reports/${encodeURIComponent(slug)}/view`;

/**
 * Posts one view of the shared report when the page mounts (CC-29 Q14): the page is cached, so the
 * server cannot count a view as it renders. The route reads the visitor's consent and sends
 * `report_viewed`; this sends nothing of its own and renders nothing. A failed post is dropped.
 */
export function ReportViewBeacon({ slug }: { slug: string }) {
  // Once per mount: the slug is fixed for a rendered page.
  useEffect(() => {
    fetch(reportViewPath(slug), { method: 'POST', keepalive: true }).catch(() => {});
  }, []);
  return null;
}
