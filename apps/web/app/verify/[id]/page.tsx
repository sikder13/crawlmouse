import { redirect, notFound } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { supabaseServer } from '@/lib/supabase/server';
import { safeNextPath } from '@/lib/safe-next-path';
import { VerifyClient } from './VerifyClient';

// Owner-only verification step, reachable by id — never a search result.
export const metadata = { robots: { index: false, follow: true } };

export default async function VerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  // R1 — a `?next=` return target (from the claim island) validated to a same-origin relative path
  // before it can ever be rendered as a link on the verified card. Off-origin → null → no link.
  const sp = await searchParams;
  const nextRaw = Array.isArray(sp.next) ? sp.next[0] : sp.next;
  const returnTo = safeNextPath(nextRaw ?? null);

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
          returnTo={returnTo}
        />
      </main>
      <Footer />
    </>
  );
}
