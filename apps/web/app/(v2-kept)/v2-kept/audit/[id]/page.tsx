import { notFound } from 'next/navigation';
import AuditPage from '@/app/audit/[id]/page';
import { keptPage } from '@/app/(v2-kept)/_lib/KeptShell';
import { checksPublicEnabled } from '@/lib/auth/flags';

export { generateMetadata } from '@/app/audit/[id]/page';

/**
 * `/audit/<id>` in the v2 shell while V2_CHECKS_PUBLIC is on (CC-36 D3, `V2_REWRITES`); a 404 with it
 * off. v1's page decides everything else as it does at its own address: its redirects and its 404
 * are thrown from it, before the shell is drawn.
 */
export default async function KeptAuditPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  if (!checksPublicEnabled()) return notFound();
  return keptPage(await AuditPage(props));
}
