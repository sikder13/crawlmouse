import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { auditMetadata } from '../_lib/metadata';
import { SegmentPage } from '../_lib/ReadyPage';

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return auditMetadata((await params).id, '/nojs');
}

export default async function AuditSegmentPage({ params }: { params: Params }) {
  if (!checksPublicEnabled()) return notFound();
  return <SegmentPage id={(await params).id} segment="nojs" />;
}
