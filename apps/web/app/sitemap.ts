import type { MetadataRoute } from 'next';
import { siteOrigin, siteUrl } from '@/lib/site-url';
import { POSTS, postsByAuthor, postsWithTag, type BlogPostMeta } from '@/lib/blog/posts';
import { TAGS } from '@/lib/blog/tags';
import { authorPath, publishedAuthors } from '@/lib/blog/authors';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { fetchIndexableReportSlugs } from '@/lib/sitemap-reports';
import { SITEMAP_REPORTS_MAX } from '@/lib/limits';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { CHECK_QUESTIONS, checkPath } from '@/lib/v2/copy/check-pages';
import { HELP_SLUGS, helpPath } from '@/lib/v2/help/questions';
import { CLUSTERS } from '@/lib/blog/clusters';
import { LEGAL_UPDATED } from '@/lib/seo/page-dates';

type ChangeFreq = NonNullable<MetadataRoute.Sitemap[number]['changeFrequency']>;

// ISR-cache the sitemap so the DB-backed /r/ section isn't recomputed on every crawler hit (cost
// ceiling). A claim / visibility change flips the report page's robots immediately (purgePublicReport)
// and the sitemap catches up within this window.
export const revalidate = 3600;

// The newest updatedAt among a list of posts.
const newest = (list: readonly BlogPostMeta[]) =>
  new Date(list.reduce((max, p) => (p.updatedAt > max ? p.updatedAt : max), ''));

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // CC-40 D3: an entry carries lastModified only when the page has a real date (its posts' newest
  // updatedAt, or the date a legal page shows); one without omits it rather than claim the build's time.
  const entry = (
    path: string,
    priority: number,
    changeFrequency: ChangeFreq,
    lastModified?: Date,
  ): MetadataRoute.Sitemap[number] => ({
    url: path ? siteUrl(path) : siteOrigin(),
    ...(lastModified ? { lastModified } : {}),
    changeFrequency,
    priority,
  });
  const guided = new Set(CLUSTERS.flatMap((c) => c.slugs));

  const marketing: MetadataRoute.Sitemap = [
    entry('', 1.0, 'weekly'),
    entry('/pricing', 0.9, 'monthly'),
    entry('/agencies', 0.8, 'monthly'),
    entry('/ai-readiness-checker', 0.9, 'monthly'),
    entry('/blog', 0.8, 'weekly', newest(POSTS)),
    entry('/guides', 0.8, 'weekly', newest(POSTS.filter((p) => guided.has(p.slug)))),
    entry('/developers', 0.7, 'monthly'),
    entry('/bot', 0.4, 'yearly'),
    entry('/status', 0.3, 'weekly'),
  ];

  // CC-29: new pages that answer 404 while their flag is off, so each is listed only while it is on
  // (OPERATING-RULES §13: no sitemap entry answers an error). The
  // three /check pages and the help centre (CC-33 D4) follow V2_CHECKS_PUBLIC.
  const flagged: MetadataRoute.Sitemap = [
    ...(checksPublicEnabled()
      ? CHECK_QUESTIONS.map((q) => entry(checkPath(q), 0.8, 'monthly'))
      : []),
    ...(checksPublicEnabled()
      ? [
          entry('/help', 0.5, 'monthly'),
          ...HELP_SLUGS.map((s) => entry(helpPath(s), 0.5, 'monthly')),
        ]
      : []),
  ];

  const legal: MetadataRoute.Sitemap = [
    '/privacy',
    '/terms',
    '/aup',
    '/subprocessors',
    '/takedown',
  ].map((p) =>
    entry(
      p,
      0.2,
      'yearly',
      Object.hasOwn(LEGAL_UPDATED, p) ? new Date(LEGAL_UPDATED[p]!) : undefined,
    ),
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

  // Tag pages (/blog/research) and author pages (/authors/<slug>), each listed once it lists a post.
  // Their lastModified is the newest updatedAt among the posts they list.
  const listing = (path: string, list: readonly BlogPostMeta[]): MetadataRoute.Sitemap[number] => ({
    url: siteUrl(path),
    lastModified: newest(list),
    changeFrequency: 'monthly',
    priority: 0.5,
  });
  const tagPages: MetadataRoute.Sitemap = Object.values(TAGS)
    .map((t) => ({ path: t.path, list: postsWithTag(t.slug) }))
    .filter((t) => t.list.length > 0)
    .map((t) => listing(t.path, t.list));
  const authorPages: MetadataRoute.Sitemap = publishedAuthors().map((a) =>
    listing(authorPath(a.slug), postsByAuthor(a.slug)),
  );

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

  return [...marketing, ...flagged, ...legal, ...posts, ...tagPages, ...authorPages, ...reports];
}
