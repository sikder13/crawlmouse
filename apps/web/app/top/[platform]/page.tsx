import Link from 'next/link';
import type { Route } from 'next';
import { notFound } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { asNumber } from '@/lib/numeric';
import { isPassingScore } from '@/lib/limits';

// Immutable, public, link-shared leaderboard → cache and revalidate rather than
// re-query the DB on every viral hit. Takedowns reflect within the window (and on
// the manual ops SLA), which is acceptable for a ranking page.
export const revalidate = 300;

const VALID_PLATFORMS = ['shopify', 'wordpress', 'webflow', 'wix', 'squarespace', 'framer', 'ghost', 'custom'] as const;
type Platform = typeof VALID_PLATFORMS[number];

const LEADERBOARD_SIZE = 50;

export async function generateMetadata({ params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  return { title: `Top ${platform} sites — Crawlmouse leaderboard` };
}

export default async function LeaderboardPage({ params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!VALID_PLATFORMS.includes(platform as Platform)) notFound();

  const sb = supabaseAdmin();
  // Genuine top-N by score: order by the denormalized score in the DB (served by
  // public_reports_leaderboard_idx) *before* the limit, so we get the real leaders
  // for this platform — not 50 arbitrary rows re-sorted in JS.
  const { data: top } = await sb
    .from('public_reports')
    .select('slug, domain, grade, score')
    .eq('cms_detected', platform)
    .eq('opt_in_leaderboard', true)
    .is('takedown_requested_at', null)
    .not('score', 'is', null)
    .order('score', { ascending: false })
    .limit(LEADERBOARD_SIZE);

  const ranked = (top ?? []).map((r) => ({
    slug: r.slug,
    domain: r.domain,
    grade: r.grade ?? '?',
    score: asNumber(r.score) ?? 0,
  }));

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
              <Link key={r.slug} href={`/r/${r.slug}` as Route}>
                <Card className="hover:border-peach transition-colors flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="font-mono text-xs text-ink/40 w-8">#{i + 1}</div>
                    <div className="font-mono text-sm">{r.domain}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone={isPassingScore(r.score) ? 'sage' : 'peach'}>{r.score.toFixed(0)}</Badge>
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
