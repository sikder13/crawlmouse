import { notFound } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Card } from '@/components/ui/Card';
import { GradeCard } from '@/components/ui/GradeCard';
import { Badge } from '@/components/ui/Badge';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return {
    title: 'Crawlmouse Report',
    robots: { index: false, follow: false, nocache: true },
    openGraph: { images: [{ url: `/r/${slug}/opengraph-image` }] },
  };
}

export default async function PublicReportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = supabaseAdmin();
  const { data: report } = await sb
    .from('public_reports')
    .select('slug, audit_id, domain, takedown_requested_at, created_at')
    .eq('slug', slug)
    .maybeSingle();

  if (!report || report.takedown_requested_at) notFound();

  const { data: audit } = await sb
    .from('audits')
    .select('url, cms_detected, grade, score, page_count, link_count')
    .eq('id', report.audit_id)
    .maybeSingle();

  if (!audit || !audit.grade) notFound();

  const { count: orphanCount } = await sb
    .from('findings')
    .select('id', { count: 'exact', head: true })
    .eq('audit_id', report.audit_id)
    .eq('category', 'orphan');

  return (
    <>
      <Header />
      <main className="max-w-3xl mx-auto px-6 pt-12 pb-32">
        <div className="mb-6">
          <Badge tone="oat">Public report</Badge>
          <h1 className="font-mono text-xl break-all mt-2">{audit.url}</h1>
          <div className="text-xs text-ink/50 mt-1">Audited {new Date(report.created_at).toLocaleDateString()} &middot; {audit.cms_detected ?? 'custom'}</div>
        </div>
        <GradeCard
          grade={audit.grade}
          score={Number(audit.score ?? 0)}
          orphanCount={orphanCount ?? 0}
          avgDepth={0}
          passing={Number(audit.score ?? 0) >= 60}
        />
        <Card className="mt-6 text-center">
          <p className="font-display text-xl">Want one for your site?</p>
          <a href="/" className="inline-block mt-3 bg-peach text-white px-6 py-3 rounded-lg font-medium">Run Crawlmouse on your site &rarr;</a>
        </Card>
        <p className="text-center text-xs text-ink/50 mt-10">Powered by <a href="/" className="text-peach underline">Crawlmouse</a></p>
      </main>
      <Footer />
    </>
  );
}
