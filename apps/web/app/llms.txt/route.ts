import { postsNewestFirst } from '@/lib/blog/posts';
import { siteUrl } from '@/lib/site-url';

// Served at /llms.txt (the folder name `llms.txt` is a literal path segment, so this
// Route Handler resolves at that exact path). It's the llms.txt convention: a plain-text,
// markdown-flavored map of the site for AI engines. Generated from the live POST metadata so
// it auto-updates as guides ship — no second list to keep in sync with the blog.
export const dynamic = 'force-static';

const INTRO = [
  '# Crawlmouse',
  '',
  '> Crawlmouse is a free, no-install internal-linking grader for any website. Paste a URL and it crawls',
  "> your live site's static HTML, maps the internal-link graph, and returns an A–F grade (0–100) plus the",
  '> specific issues holding it back: orphan pages, pages buried too deep, weak hubs, and thin anchor text.',
  '> Because it reads the static HTML your server returns, it shows the same site a non-rendering AI crawler sees.',
  '',
  '## Product',
  `- [Grade your site's internal linking](${siteUrl('/')}): Free A–F grade in under two minutes — no account, no install.`,
  `- [Pricing](${siteUrl('/pricing')}): Free tier and Pro.`,
  `- [About CrawlmouseBot](${siteUrl('/bot')}): How our crawler behaves and how to control it.`,
  '',
  '## Guides',
  `- [All guides](${siteUrl('/guides')}): Every guide, grouped by topic.`,
];

export function GET() {
  const postLines = postsNewestFirst().map(
    (post) => `- [${post.title}](${siteUrl(`/blog/${post.slug}`)}): ${post.description}`,
  );

  const body = `${[...INTRO, ...postLines].join('\n')}\n`;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
