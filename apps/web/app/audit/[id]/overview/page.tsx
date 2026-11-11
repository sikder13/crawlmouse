import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { checksPublicEnabled } from '@/lib/auth/flags';
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
  const read = await readAudit((await params).id);
  if (read === null) notFound();
  return <CheckPage read={read} />;
}
