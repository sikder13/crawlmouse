// CTO ruling 3 of 2026-11-15 (owner-delegated): deliberate changes to the search-result title and
// the meta description of posts that earn impressions (OPERATING-RULES §13). Each is recorded here
// with what it replaced and the Search Console line it rests on (export of 2026-11-15, last three
// months), and the post's metadata in posts.ts carries the `after`. Nothing on the page changes: a
// `seoTitle` sets `<title>`, Open Graph and Twitter only, and the H1 and the Article headline keep
// the post's `title`. The pinned existing-post guard applies these to its baseline and must then
// match exactly, so a metadata change not listed here fails it; ruled-copy.test.ts checks each
// `after` against posts.ts and each `before` against the baseline fixture.

export interface RuledChange {
  slug: string;
  field: 'seoTitle' | 'description';
  /** For `seoTitle`, the `<title>` it replaces: the post's `title`. */
  before: string;
  after: string;
  /** The Search Console line the change rests on. */
  basis: string;
}

export const RULED_CHANGES: readonly RuledChange[] = [
  {
    slug: 'cloudflare-ai-crawler-defaults-september-15',
    field: 'seoTitle',
    before:
      "Cloudflare Starts Blocking AI Crawlers by Default on September 15. Here's Who It Affects — and How to Check Your Site",
    after: 'Cloudflare Now Blocks AI Crawlers by Default: Check Your Site',
    basis: 'position 9.27, 123 impressions, 0 clicks; the 117-character title is cut in results',
  },
  {
    slug: 'block-ai-crawlers-robots-txt',
    field: 'seoTitle',
    before: 'Should You Block AI Crawlers? A robots.txt Guide for GPTBot, ClaudeBot & Co.',
    after: 'Block AI Crawlers in robots.txt: GPTBot, ClaudeBot & More',
    basis: 'position 74.63, 1,030 impressions; queries "gptbot robots.txt", "block ai crawlers"',
  },
  {
    slug: 'screaming-frog-alternative',
    field: 'seoTitle',
    before: 'Screaming Frog Alternatives in 2026: Six Options, Compared Honestly',
    after: 'Screaming Frog Alternatives (2026): 6 Options Compared',
    basis: 'position 56.96, 1,658 impressions; the title was 67 characters',
  },
  {
    slug: 'sitebulb-alternative',
    field: 'seoTitle',
    before: 'Sitebulb Alternatives (2026): Free and Paid Options, Honestly Compared',
    after: 'Sitebulb Alternatives (2026): Free and Paid Options Compared',
    basis: 'position 47.02, 535 impressions; the title was 70 characters',
  },
  {
    slug: 'screaming-frog-vs-lumar-deepcrawl',
    field: 'seoTitle',
    before: 'Screaming Frog vs Lumar (DeepCrawl): Desktop Tool vs Enterprise Platform',
    after: 'Screaming Frog vs DeepCrawl (Lumar): Which Crawler to Use?',
    basis:
      'position 20.06, 449 impressions; queries "screaming frog vs deepcrawl" (297), "deepcrawl vs screaming frog" (90)',
  },
  {
    slug: 'how-deep-is-too-deep-crawl-depth',
    field: 'seoTitle',
    before: 'How Deep Is Too Deep? Crawl Depth Limits and How to Fix Buried Pages',
    after: 'Crawl Depth: How Many Clicks Is Too Deep, and How to Fix It',
    basis: 'position 65.39, 594 impressions; queries "crawl depth", "crawl depth seo"',
  },
  {
    slug: 'discovered-currently-not-indexed',
    field: 'seoTitle',
    before: 'Discovered – Currently Not Indexed: Why It Happens and How to Fix It',
    after: 'Discovered – Currently Not Indexed: Causes and Fixes',
    basis: 'position 81.67, 592 impressions; query "discovered currently not indexed"',
  },
  {
    slug: 'screaming-frog-alternative',
    field: 'description',
    before:
      'Six real Screaming Frog alternatives compared — free, browser-based, cloud, and open source — plus the honest cases where Screaming Frog is still the right tool.',
    after:
      'Screaming Frog alternatives compared: free, browser-based, cloud and open-source crawlers, with prices, limits, and when Screaming Frog is still the pick.',
    basis: '1,658 impressions, 3 clicks, CTR 0.18%, position 56.96',
  },
  {
    slug: 'can-ai-crawlers-see-javascript',
    field: 'description',
    before:
      "AI crawlers like GPTBot and ClaudeBot don't run JavaScript, so a JS site can rank on Google yet be invisible to ChatGPT. Here's how to check what yours shows them.",
    after:
      "Can AI crawlers see JavaScript? GPTBot, ClaudeBot and PerplexityBot don't execute it, so a JS site can rank on Google yet show them nothing. How to check.",
    basis: '1,088 impressions, 6 clicks, CTR 0.55%, position 23.94',
  },
  {
    slug: 'block-ai-crawlers-robots-txt',
    field: 'description',
    before:
      'Should you block GPTBot, ClaudeBot, and other AI crawlers? A practical 2026 robots.txt guide — what each bot does, what blocking costs, and copy-paste rules.',
    after:
      'Block AI crawlers in robots.txt? What GPTBot, ClaudeBot and other bots do, what blocking costs, and copy-paste rules for each choice.',
    basis: '1,030 impressions, 0 clicks, position 74.63',
  },
  {
    slug: 'how-deep-is-too-deep-crawl-depth',
    field: 'description',
    before:
      'How many clicks from your homepage is too many? A practical, site-size-aware guide to crawl depth limits — and exactly how to pull buried pages back up.',
    after:
      "How deep is too deep? Crawl depth explained: how many clicks from the homepage is too many for your site's size, and how to pull buried pages back up.",
    basis: '594 impressions, 1 click, CTR 0.17%, position 65.39',
  },
  {
    slug: 'discovered-currently-not-indexed',
    field: 'description',
    before:
      "Discovered - currently not indexed means Google found your page but hasn't crawled it yet. Here's why it happens, and how stronger internal linking fixes it.",
    after:
      'Discovered – currently not indexed: Google found the URL but has not crawled it. Why it happens, how to check, and how internal links get it crawled.',
    basis: '592 impressions, 0 clicks, position 81.67',
  },
  {
    slug: 'sitebulb-alternative',
    field: 'description',
    before:
      'Six real Sitebulb alternatives compared with August 2026 pricing — free, paid, and open source. Includes when Sitebulb is still the right choice.',
    after:
      'Sitebulb alternatives with current pricing: free, paid and open-source crawlers compared honestly, and the cases where Sitebulb is still the right choice.',
    basis: '535 impressions, 0 clicks, position 47.02',
  },
  {
    slug: 'sitebulb-vs-screaming-frog',
    field: 'description',
    before:
      "Sitebulb and Screaming Frog are the two big SEO crawlers. Here's an honest comparison of features, pricing, and which to pick — plus a free no-install option.",
    after:
      'Sitebulb vs Screaming Frog: features, pricing and reports of the two big SEO crawlers compared, which one fits your work, and a free no-install option.',
    basis: '466 impressions, 0 clicks, position 31.25',
  },
  {
    slug: 'screaming-frog-vs-lumar-deepcrawl',
    field: 'description',
    before:
      'Screaming Frog and Lumar (formerly DeepCrawl) solve different problems at very different prices. An honest August 2026 comparison — and when you need neither.',
    after:
      'Screaming Frog vs DeepCrawl (now Lumar): desktop crawler vs enterprise platform — pricing, monitoring and CI/CD compared, and when you need neither.',
    basis: '449 impressions, 1 click, CTR 0.22%, position 20.06',
  },
  {
    slug: 'sitebulb-vs-jetoctopus-vs-oncrawl',
    field: 'description',
    before:
      'Sitebulb Cloud, JetOctopus, and Oncrawl are the main cloud SEO crawlers. An honest July 2026 comparison of pricing, log analysis, and which one fits your site.',
    after:
      'Sitebulb vs JetOctopus vs Oncrawl: the cloud SEO crawlers compared on pricing, log-file analysis and scale, and which one fits your site.',
    basis: '153 impressions, 0 clicks, position 22.14',
  },
  {
    slug: 'cloudflare-ai-crawler-defaults-september-15',
    field: 'description',
    before:
      "From September 15, 2026, Cloudflare blocks Training and Agent crawlers by default on ad pages. What changes, who's affected, and how to check your site.",
    after:
      "Cloudflare blocks AI training and agent crawlers by default from September 15, 2026 on ad pages. Who is affected and how to check your own site's settings.",
    basis: '123 impressions, 0 clicks, position 9.27',
  },
];

/** The recorded description changes, as [before, after] pairs. */
export const RULED_DESCRIPTIONS: readonly (readonly [before: string, after: string])[] =
  RULED_CHANGES.filter((c) => c.field === 'description').map((c) => [c.before, c.after] as const);

/** The changes as a Markdown table for the spec and PR (OPERATING-RULES §10: rendered from data). */
export function ruledChangesMarkdown(changes: readonly RuledChange[] = RULED_CHANGES): string {
  const cell = (s: string) => s.replace(/\|/g, '\\|');
  return [
    `${changes.length} changes (ruling 3): ${changes.filter((c) => c.field === 'seoTitle').length} search-result titles, ${changes.filter((c) => c.field === 'description').length} meta descriptions.`,
    '',
    '| Post | Field | Before (chars) | After (chars) | Search Console, 3 months |',
    '| --- | --- | --- | --- | --- |',
    ...changes.map(
      (c) =>
        `| /blog/${c.slug} | ${c.field === 'seoTitle' ? '<title>' : 'description'} | ${cell(c.before)} (${c.before.length}) | ${cell(c.after)} (${c.after.length}) | ${cell(c.basis)} |`,
    ),
  ].join('\n');
}
