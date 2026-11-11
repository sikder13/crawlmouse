import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { auditMetadata } from '../../_lib/metadata';
import { FixPage } from '../../_lib/ReadyPage';

type Params = Promise<{ id: string; fixId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id, fixId } = await params;
  return auditMetadata(id, `/fix/${fixId}`);
}

export default async function AuditFixPage({ params }: { params: Params }) {
  if (!checksPublicEnabled()) return notFound();
  const { id, fixId } = await params;
  return <FixPage id={id} fixId={fixId} />;
}
