import type { MetadataRoute } from 'next';
import { siteOrigin, siteUrl } from '@/lib/site-url';
import { POSTS } from '@/lib/blog/posts';

type ChangeFreq = NonNullable<MetadataRoute.Sitemap[number]['changeFrequency']>;

export default function sitemap(): MetadataRoute.Sitemap {
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
    entry('/blog', 0.8, 'weekly'),
    entry('/guides', 0.8, 'weekly'),
    entry('/developers', 0.7, 'monthly'),
    entry('/bot', 0.4, 'yearly'),
    entry('/status', 0.3, 'weekly'),
  ];

  const legal: MetadataRoute.Sitemap = ['/privacy', '/terms', '/aup', '/subprocessors'].map((p) =>
    entry(p, 0.2, 'yearly'),
  );

  // Leaderboards (/top/*) are intentionally NOT listed here: their indexing is
  // page-controlled via the robots meta in app/top/[platform]/page.tsx (noindex
  // while empty/thin, indexable once real data accrues), exactly like /r/.

  const posts: MetadataRoute.Sitemap = POSTS.map((post) => ({
    url: siteUrl(`/blog/${post.slug}`),
    lastModified: new Date(post.updatedAt),
    changeFrequency: 'monthly',
    priority: 0.7,
  }));

  return [...marketing, ...legal, ...posts];
}
