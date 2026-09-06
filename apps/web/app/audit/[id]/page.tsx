import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { AuditView } from './AuditView';
import { AuditUrlHeader } from '@/components/audit/AuditUrlHeader';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

// Capability URL: the unguessable audit UUID is the only thing guarding this page, so it must
// never be indexed. The indexable surface for a result is the minted /r/<slug> report.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { robots: { index: false, follow: true }, alternates: { canonical: `/audit/${id}` } };
}

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Capability-URL: the audit is resolved by its unguessable UUID via the service-role
  // client (minimal columns only) so an anonymous owner can view their own result. RLS
  // would otherwise 404 anonymous audits (user_id = null).
  const sb = supabaseAdmin();
  const { data: audit } = await sb.from('audits').select('id, url').eq('id', id).maybeSingle();
  if (!audit) notFound();

  return (
    <>
      <Header />
      <main className="max-w-4xl mx-auto px-6 pt-12 pb-32">
        <AuditUrlHeader url={audit.url} />
        <AuditView auditId={audit.id} />
      </main>
      <Footer />
    </>
  );
}
