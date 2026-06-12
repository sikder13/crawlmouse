import type { MetadataRoute } from 'next';
import { siteUrl, siteHost } from '@/lib/site-url';

// ONE `User-Agent: *` group. A previous version emitted TWO separate `*` groups (one `allow`, one
// `disallow`), which crawlers merge or pick from inconsistently. Allow everything except the private
// / non-indexable surfaces, and point crawlers at the sitemap.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Private app + capability-URL surfaces. NB: /r/ public reports are intentionally NOT blocked
      // here — their indexing is controlled per-page (page-level robots meta) so the crawler can
      // actually fetch them and honor that signal, instead of the "indexed but blocked" anti-pattern.
      disallow: ['/embed/', '/audit/', '/dashboard', '/verify/'],
    },
    sitemap: siteUrl('/sitemap.xml'),
    host: siteHost(),
  };
}
