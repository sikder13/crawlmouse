import { postsNewestFirst } from '@/lib/blog/posts';
import { siteUrl } from '@/lib/site-url';

// Served at /llms.txt (the folder name `llms.txt` is a literal path segment, so this
// Route Handler resolves at that exact path). It's the llms.txt convention: a plain-text,
// markdown-flavored map of the site for AI engines. The guide list is generated from the live
// POST metadata so it auto-updates as guides ship — no second list to keep in sync with the blog.
export const dynamic = 'force-static';

// Founder-approved copy, carried verbatim — do not reword.
const DESCRIPTOR =
  'Crawlmouse is a free, browser-based website auditor by Nahl Technologies. Paste a URL and get an ' +
  'honest A–F grade on your internal links and what AI crawlers actually see — orphan pages, click ' +
  'depth, link graph. Free, no signup.';

const MAKER =
  'Built by [Nahl Technologies](https://nahltech.com), an AI consulting and implementation firm in Indianapolis.';

// One line per page, each description reusing copy that already ships on that page — no prose is
// authored here. Sources, so a drift is traceable: home + /guides + /bot are the lines this file
// already carried; /pricing is the first sentence of its own H1 lede (app/pricing/page.tsx);
// /developers is its existing `metadata.title` (app/developers/page.tsx); /blog is its
// `DESCRIPTION` constant (app/blog/page.tsx). /pricing and /developers ship no meta description of
// their own — they inherit the site-wide one from app/layout.tsx — which is why their own on-page
// copy is used rather than repeating the home line three times.
const KEY_PAGES: readonly (readonly [label: string, path: string, description: string])[] = [
  ["Grade your site's internal linking", '/', 'Free A–F grade in under two minutes — no account, no install.'],
  ['Pricing', '/pricing', 'Free is genuinely free — a real grade and one complete fix.'],
  ['Crawlmouse for developers', '/developers', 'CLI, GitHub Action & webhooks.'],
  [
    'The Crawlmouse blog',
    '/blog',
    'Practical, no-fluff guides to internal linking, orphan pages, crawl depth, and the site structure ' +
      'that actually ranks — from the team behind Crawlmouse.',
  ],
  ['All guides', '/guides', 'Every guide, grouped by topic.'],
  ['About CrawlmouseBot', '/bot', 'How our crawler behaves and how to control it.'],
];

export function GET() {
  const keyPageLines = KEY_PAGES.map(
    ([label, path, description]) => `- [${label}](${siteUrl(path)}): ${description}`,
  );

  const guideLines = postsNewestFirst().map(
    (post) => `- [${post.title}](${siteUrl(`/blog/${post.slug}`)}): ${post.description}`,
  );

  const body = `${[
    '# Crawlmouse',
    '',
    `> ${DESCRIPTOR}`,
    '',
    '## Key pages',
    '',
    ...keyPageLines,
    '',
    '## Guides',
    '',
    ...guideLines,
    '',
    '## Maker',
    '',
    MAKER,
  ].join('\n')}\n`;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
