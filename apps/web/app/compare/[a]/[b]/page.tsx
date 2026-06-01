import { notFound } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizeDomain } from '@/lib/domain';
import { CompareView } from '@/components/share/CompareView';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function domainOf(url: string): string {
  try {
    return normalizeDomain(url);
  } catch {
    return url;
  }
}

export const metadata = { robots: { index: false, follow: false } };

export default async function CompareResultsPage({ params }: { params: Promise<{ a: string; b: string }> }) {
  const { a, b } = await params;
  if (!UUID.test(a) || !UUID.test(b)) notFound();

  // Capability-URL: both audits were just created by this visitor, so they hold both
  // ids. Resolve via the service role (RLS would 404 anonymous audits), minimal cols.
  const sb = supabaseAdmin();
  const { data: rows } = await sb.from('audits').select('id, url').in('id', [a, b]);
  const urlById = new Map((rows ?? []).map((r) => [r.id, r.url]));
  if (!urlById.has(a) || !urlById.has(b)) notFound();

  return (
    <>
      <Header />
      <main className="max-w-5xl mx-auto px-6 pt-12 pb-32">
        <div className="mb-8">
          <div className="text-xs uppercase tracking-wider text-ink/50 font-semibold">Head to head</div>
          <h1 className="font-display font-bold text-4xl tracking-tight mt-1">Internal-linking face-off</h1>
        </div>
        <CompareView
          a={{ id: a, domain: domainOf(urlById.get(a)!) }}
          b={{ id: b, domain: domainOf(urlById.get(b)!) }}
        />
      </main>
      <Footer />
    </>
  );
}
