import type { MetadataRoute } from 'next';
import { siteOrigin, siteUrl } from '@/lib/site-url';
import { POSTS } from '@/lib/blog/posts';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { fetchIndexableReportSlugs } from '@/lib/sitemap-reports';
import { SITEMAP_REPORTS_MAX } from '@/lib/limits';

type ChangeFreq = NonNullable<MetadataRoute.Sitemap[number]['changeFrequency']>;

// ISR-cache the sitemap so the DB-backed /r/ section isn't recomputed on every crawler hit (cost
// ceiling). A claim / visibility change flips the report page's robots immediately (purgePublicReport)
// and the sitemap catches up within this window.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const entry = (path: string, priority: number, changeFrequency: ChangeFreq): MetadataRoute.Sitemap[number] => ({
    url: path ? siteUrl(path) : siteOrigin(),
    lastModified: now,
    changeFrequency,
    priority,
  });

  const marketing: MetadataRoute.Sitemap = [
    entry('', 1.0, 'weekly'),
    entry('/pricing', 0.9, 'monthly'),
    entry('/ai-readiness-checker', 0.9, 'monthly'),
    entry('/blog', 0.8, 'weekly'),
    entry('/guides', 0.8, 'weekly'),
    entry('/developers', 0.7, 'monthly'),
    entry('/bot', 0.4, 'yearly'),
    entry('/status', 0.3, 'weekly'),
  ];

  const legal: MetadataRoute.Sitemap = ['/privacy', '/terms', '/aup', '/subprocessors', '/takedown'].map((p) =>
    entry(p, 0.2, 'yearly'),
  );

  // Leaderboards (/top/*) are intentionally NOT listed here: their indexing is
  // page-controlled via the robots meta in app/top/[platform]/page.tsx (noindex
  // while empty/thin, indexable once real data accrues), exactly like an UNCLAIMED /r/.

  const posts: MetadataRoute.Sitemap = POSTS.map((post) => ({
    url: siteUrl(`/blog/${post.slug}`),
    lastModified: new Date(post.updatedAt),
    changeFrequency: 'monthly',
    priority: 0.7,
  }));

  // SPEC 04 §8 (V13) — claimed + indexable public reports. Unclaimed mints have indexable=false and
  // never appear here (the guardrail). Deploy-order-safe + fail-soft: the helper returns [] on any
  // query error (incl. the pre-Runbook-B undefined-column error), and the try/catch also covers a
  // supabaseAdmin() construction failure (e.g. missing env at build) — so the sitemap NEVER breaks;
  // it just omits the /r/ section until the section is available.
  let reports: MetadataRoute.Sitemap = [];
  try {
    const rows = await fetchIndexableReportSlugs(supabaseAdmin(), SITEMAP_REPORTS_MAX);
    reports = rows.map((r) => ({
      url: siteUrl(`/r/${r.slug}`),
      lastModified: new Date(r.lastModified),
      changeFrequency: 'monthly' as ChangeFreq,
      priority: 0.6,
    }));
  } catch {
    reports = [];
  }

  return [...marketing, ...legal, ...posts, ...reports];
}
