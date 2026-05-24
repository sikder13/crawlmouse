import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { supabaseAdmin } from '@/lib/supabase/admin';

const VALID_PLATFORMS = ['shopify', 'wordpress', 'webflow', 'wix', 'squarespace', 'framer', 'ghost', 'custom'] as const;
type Platform = typeof VALID_PLATFORMS[number];

export async function generateMetadata({ params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  return { title: `Top ${platform} sites — Crawlmouse leaderboard` };
}

export default async function LeaderboardPage({ params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!VALID_PLATFORMS.includes(platform as Platform)) notFound();

  const sb = supabaseAdmin();
  // Top 50 verified public reports for this platform, by score desc
  const { data: top } = await sb
    .from('public_reports')
    .select('slug, domain, audit_id, audits!inner(grade, score, cms_detected)')
    .eq('audits.cms_detected', platform)
    .eq('opt_in_leaderboard', true)
    .is('takedown_requested_at', null)
    .order('audit_id', { ascending: false })
    .limit(50);

  type AuditRow = { grade: string; score: number | null; cms_detected: string | null };

  const ranked = (top ?? [])
    .filter((r) => {
      const audit = (r.audits as unknown as AuditRow | AuditRow[]);
      const a = Array.isArray(audit) ? audit[0] : audit;
      return a?.score != null;
    })
    .map((r) => {
      const audit = (r.audits as unknown as AuditRow | AuditRow[]);
      const a = Array.isArray(audit) ? audit[0] : audit;
      return {
        slug: r.slug,
        domain: r.domain,
        grade: a!.grade,
        score: Number(a!.score),
      };
    })
    .sort((a, b) => b.score - a.score);

  return (
    <>
      <Header />
      <main className="max-w-3xl mx-auto px-6 pt-12 pb-32">
        <h1 className="font-display font-bold text-5xl tracking-tight capitalize">Top {platform} sites</h1>
        <p className="text-ink/70 mt-3">By internal-linking grade. Updated as new audits complete.</p>

        {ranked.length === 0 ? (
          <Card className="mt-8 text-center py-10">
            <p className="text-ink/60">No public {platform} reports yet. <Link href={{ pathname: '/' }} className="text-peach underline">Be the first.</Link></p>
          </Card>
        ) : (
          <div className="mt-8 space-y-2">
            {ranked.map((r, i) => (
              <Link key={r.slug} href={{ pathname: `/r/${r.slug}` } as never}>
                <Card className="hover:border-peach transition-colors flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="font-mono text-xs text-ink/40 w-8">#{i + 1}</div>
                    <div className="font-mono text-sm">{r.domain}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone={r.score >= 60 ? 'sage' : 'peach'}>{r.score.toFixed(0)}</Badge>
                    <span className="font-display font-bold text-2xl">{r.grade}</span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
