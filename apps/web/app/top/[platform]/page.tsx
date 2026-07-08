import Link from 'next/link';
import type { Metadata, Route } from 'next';
import { notFound } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { asNumber } from '@/lib/numeric';
import { isPassingScore } from '@/lib/limits';
import { PLATFORMS, isPlatform } from '@/lib/platforms';
import { fetchLeaderboardReports, countLeaderboardReports } from '@/lib/leaderboard';

// Immutable, public, link-shared leaderboard → cache and revalidate rather than
// re-query the DB on every viral hit. Takedowns reflect within the window (and on
// the manual ops SLA), which is acceptable for a ranking page.
export const revalidate = 300;

const LEADERBOARD_SIZE = 50;

// Below this many qualifying ranked reports a leaderboard is too thin to be worth
// indexing (empty/near-empty ranking = a doorway page). It flips to indexable
// automatically once real data accrues — indexing is page-controlled, like /r/.
const LEADERBOARD_MIN_INDEX = 10;

// Pre-render every leaderboard at build (refreshed on the ISR window) so all are crawlable + fast.
export function generateStaticParams() {
  return PLATFORMS.map((platform) => ({ platform }));
}

export async function generateMetadata({ params }: { params: Promise<{ platform: string }> }): Promise<Metadata> {
  const { platform } = await params;
  const title = `Top ${platform} sites — Crawlmouse leaderboard`;

  // Unknown platform → the page 404s; never index it and never touch the DB.
  if (!isPlatform(platform)) return { title, robots: { index: false, follow: true } };

  // Only index once the leaderboard has enough real ranked reports (same filters the page uses,
  // incl. the hide exclusion). An empty/thin board stays noindex but still follow, so crawlers can
  // reach the linked /r/ reports. A hidden report must NOT count toward indexability (§9).
  const count = await countLeaderboardReports(supabaseAdmin(), platform);
  const indexable = count >= LEADERBOARD_MIN_INDEX;

  return {
    title,
    ...(indexable
      ? { description: `The top ${platform} sites ranked by internal-linking grade.` }
      : {}),
    robots: { index: indexable, follow: true },
  };
}

export default async function LeaderboardPage({ params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!isPlatform(platform)) notFound();

  // Genuine top-N by score, ordered in the DB before the limit; excludes taken-down AND HIDDEN
  // reports (§9), with a deploy-order-safe fallback (pre-Runbook-B the hidden_at column is absent).
  const top = await fetchLeaderboardReports(supabaseAdmin(), platform, LEADERBOARD_SIZE);

  const ranked = top.map((r) => ({
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
