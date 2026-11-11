import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { auditHrefs } from '../_lib/hrefs';
import { auditMetadata } from '../_lib/metadata';
import { MapPage } from '../_lib/ReadyPage';

type Params = Promise<{ id: string }>;
type Query = Promise<{ scope?: string | string[] }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return auditMetadata(auditHrefs((await params).id).map.hubs);
}

export default async function AuditMapPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Query;
}) {
  if (!checksPublicEnabled()) return notFound();
  // `?scope=all` draws every page; any other value is the hubs.
  const scope = (await searchParams).scope === 'all' ? 'all' : 'hubs';
  return <MapPage id={(await params).id} scope={scope} />;
}
