import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { SeatTheme } from '@/components/v2/SeatTheme';
import { sessionTheme } from '@/lib/v2/account/session-theme';
import { readAudit } from '../_lib/access';
import { CheckPage } from '../_lib/CheckPage';
import { auditHrefs } from '../_lib/hrefs';
import { auditMetadata } from '../_lib/metadata';

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return auditMetadata(auditHrefs((await params).id).overview);
}

/**
 * A v2 check's own page (CC-22b D4): the crawl while it waits or runs, the result once it is
 * graded, a notice for one that failed or expired. `/audit/[id]` sends a v2 check here; it is a
 * route of its own so that the v1 page at `/audit/[id]` holds none of the v2 screens' stylesheets.
 */
export default async function AuditOverviewPage({ params }: { params: Params }) {
  if (!checksPublicEnabled()) return notFound();
  // The theme is read beside the audit, and never fails the page (session-theme.ts).
  const [read, theme] = await Promise.all([readAudit((await params).id), sessionTheme()]);
  if (read === null) notFound();
  return <CheckPage read={read} theme={theme ? <SeatTheme theme={theme} /> : null} />;
}
