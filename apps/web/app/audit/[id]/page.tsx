import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { AuditView } from './AuditView';
import { supabaseServer } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: audit } = await sb.from('audits').select('id, url').eq('id', id).maybeSingle();
  if (!audit) notFound();

  return (
    <>
      <Header />
      <main className="max-w-4xl mx-auto px-6 pt-12 pb-32">
        <div className="mb-6">
          <div className="text-xs uppercase tracking-wider text-ink/50 font-semibold">Auditing</div>
          <h1 className="font-mono text-lg break-all">{audit.url}</h1>
        </div>
        <AuditView auditId={audit.id} />
      </main>
      <Footer />
    </>
  );
}
