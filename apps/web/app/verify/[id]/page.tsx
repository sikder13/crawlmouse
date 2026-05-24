import { redirect, notFound } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { supabaseServer } from '@/lib/supabase/server';
import { VerifyClient } from './VerifyClient';

export default async function VerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const { data: v } = await sb
    .from('domain_verifications')
    .select('id, domain, method, verification_token, verified_at')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!v) notFound();

  return (
    <>
      <Header />
      <main className="max-w-2xl mx-auto px-6 pt-12 pb-32">
        <h1 className="font-display font-bold text-4xl tracking-tight mb-2">Verify domain ownership</h1>
        <p className="text-ink/70 mb-6 font-mono text-sm">{v.domain}</p>
        <VerifyClient
          id={v.id}
          domain={v.domain}
          method={v.method as 'dns_txt' | 'meta_tag'}
          token={v.verification_token}
          alreadyVerified={!!v.verified_at}
        />
      </main>
      <Footer />
    </>
  );
}
