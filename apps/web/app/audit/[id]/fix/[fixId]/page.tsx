import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { noticeLine } from '@/lib/v2/copy/notices';
import { auditHrefs } from '../../_lib/hrefs';
import { auditMetadata } from '../../_lib/metadata';
import { FixPage } from '../../_lib/ReadyPage';

type Params = Promise<{ id: string; fixId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id, fixId } = await params;
  return auditMetadata(auditHrefs(id).fix(fixId));
}

export default async function AuditFixPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!checksPublicEnabled()) return notFound();
  const { id, fixId } = await params;
  // The code alone: this page has no account time zone to say a retry time in.
  const notice = noticeLine({ notice: (await searchParams).notice }, 'UTC');
  return <FixPage id={id} fixId={fixId} notice={notice} />;
}
