# Public page audit

_Rendered by `scripts/seo/audit.ts --render` from the runs in `docs/seo/audit-data/`. Do not edit by hand._

- flags off: commit `2ed206c5`, read 2026-11-15T13:01:52.993Z
- flags on: commit `2ed206c5`, read 2026-11-15T13:10:20.265Z
- Search Console export of 2026-11-15 (indexed list as of 2026-11-08). Queries are attributed to pages by word match (`lib/seo/attribution.ts`): the export has no page × query table.

Re-run:

```bash
# each build: NEXT_PUBLIC_BASE_URL=https://crawlmouse.com, .env.ci placeholders; flags on = V2_ACCOUNT_DOOR=1 V2_PIPELINE=1 V2_CHECKS_PUBLIC=1 V2_BILLING=1
pnpm --filter @crawlmouse/web exec next start -p 3100
pnpm seo:audit -- --base=http://localhost:3100 --label="flags off" --out=docs/seo/audit-data/off.json
pnpm seo:audit -- --render --off=docs/seo/audit-data/off.json --on=docs/seo/audit-data/on.json --www
```

## Summary

| Pages with … | flags off | flags on |
| --- | ---: | ---: |
| URLs in the sitemap | 33 | 50 |
| answering other than 200 | 0 | 0 |
| not exactly one H1 | 0 | 0 |
| a skipped heading level | 1 | 0 |
| canonical not the page itself | 0 | 0 |
| no meta description | 0 | 0 |
| more than one meta description | 0 | 0 |
| description outside 70–160 characters | 5 | 9 |
| description shared with another page | 7 | 7 |
| title over 60 characters | 16 | 21 |
| an image without alt | 0 | 0 |
| noindex | 0 | 0 |
| a JSON-LD problem | 0 | 0 |
| FAQPage questions not shown on the page | 0 | 0 |
| no internal link to it from another sitemap page | 0 | 4 |

## Indexing: posts not in the indexed list

### flags off: 2 sitemap posts not in the indexed list

Indexed posts, for comparison (16): in-links 3–20; words 1129–2988; nearest-post similarity 0.035–0.115.

| Post | Published | Canonical | In-links (from) | Words | Nearest post (5-gram Jaccard) | Outside the indexed posts' range |
| --- | --- | --- | --- | ---: | --- | --- |
| /blog/orphan-pages | 2026-06-12 | self | 12 (/, /blog, /guides, /blog/find-orphan-pages-squarespace, /blog/can-ai-crawlers-see-javascript, /blog/find-orphan-pages-webflow, /blog/discovered-currently-not-indexed, /blog/find-orphan-pages-shopify, /blog/find-orphan-pages-wordpress, /blog/how-deep-is-too-deep-crawl-depth, /blog/free-internal-link-audit, /blog/crawl-depth-site-architecture) | 1728 | /blog/find-orphan-pages-wordpress (0.089) | none of the measured factors |
| /blog/crawl-depth-site-architecture | 2026-06-12 | self | 12 (/blog, /guides, /blog/screaming-frog-vs-lumar-deepcrawl, /blog/sitebulb-vs-jetoctopus-vs-oncrawl, /blog/sitebulb-vs-screaming-frog, /blog/sitebulb-alternative, /blog/discovered-currently-not-indexed, /blog/find-orphan-pages-shopify, /blog/find-orphan-pages-wordpress, /blog/how-deep-is-too-deep-crawl-depth, /blog/free-internal-link-audit, /blog/orphan-pages) | 1100 | /blog/how-deep-is-too-deep-crawl-depth (0.115) | fewer words |

### flags on: 2 sitemap posts not in the indexed list

Indexed posts, for comparison (16): in-links 3–49; words 1129–2988; nearest-post similarity 0.035–0.115.

| Post | Published | Canonical | In-links (from) | Words | Nearest post (5-gram Jaccard) | Outside the indexed posts' range |
| --- | --- | --- | --- | ---: | --- | --- |
| /blog/orphan-pages | 2026-06-12 | self | 11 (/blog, /guides, /blog/find-orphan-pages-squarespace, /blog/can-ai-crawlers-see-javascript, /blog/find-orphan-pages-webflow, /blog/discovered-currently-not-indexed, /blog/find-orphan-pages-shopify, /blog/find-orphan-pages-wordpress, /blog/how-deep-is-too-deep-crawl-depth, /blog/free-internal-link-audit, /blog/crawl-depth-site-architecture) | 1728 | /blog/find-orphan-pages-wordpress (0.089) | none of the measured factors |
| /blog/crawl-depth-site-architecture | 2026-06-12 | self | 12 (/blog, /guides, /blog/screaming-frog-vs-lumar-deepcrawl, /blog/sitebulb-vs-jetoctopus-vs-oncrawl, /blog/sitebulb-vs-screaming-frog, /blog/sitebulb-alternative, /blog/discovered-currently-not-indexed, /blog/find-orphan-pages-shopify, /blog/find-orphan-pages-wordpress, /blog/how-deep-is-too-deep-crawl-depth, /blog/free-internal-link-audit, /blog/orphan-pages) | 1100 | /blog/how-deep-is-too-deep-crawl-depth (0.115) | fewer words |

Search Console's reasons for the 21 URLs it does not index (counts only; the export names no URL per reason, so which reason covers which post above is not in the data):

| Reason | Source | URLs |
| --- | --- | ---: |
| Page with redirect | Website | 6 |
| Alternate page with proper canonical tag | Website | 3 |
| Excluded by ‘noindex’ tag | Website | 1 |
| Not found (404) | Website | 1 |
| Blocked by robots.txt | Website | 1 |
| Crawled - currently not indexed | Google systems | 8 |
| Discovered - currently not indexed | Google systems | 1 |

## App surfaces

No app surface answers an indexable page in either build: each is noindex, a redirect, or not found.

| Path | flags off | flags on |
| --- | --- | --- |
| /login | 200, noindex, follow | 200, noindex, follow |
| /signup | 404 | 200, noindex, nofollow |
| /check-email | 404 | 200, noindex, nofollow |
| /account | 404 | 404 |
| /settings | 404 | 307 → /login |
| /trial-ended | 404 | 307 → /login |
| /dashboard | 307 → /login | 307 → /login |
| /sites/00000000-0000-4000-8000-000000000000 | 404 | 307 → /login |
| /alerts | 404 | 307 → /login |
| /changes | 404 | 307 → /login |
| /billing | 307 → /login | 307 → /settings/plan |
| /seats | 404 | 307 → /login |
| /agency | 404 | 307 → /login |
| /agency-trial | 404 | 307 → /login |
| /invite | 404 | 200, noindex, nofollow |
| /internal | 404 | 404 |
| /unsubscribe | 404 | 200, noindex, nofollow |
| /reports | 404 | 307 → /login |
| /audit/00000000-0000-4000-8000-000000000000 | 404 | 500 |
| /verify/00000000-0000-4000-8000-000000000000 | 307 → /login | 307 → /login |
| /s/view | 404 | 404 |

## www

`https://www.crawlmouse.com/` answered one 308 to https://crawlmouse.com/: not separately indexable (read 2026-11-15T13:11:16.805Z).

## Pages, flags off

| Page | Status | Title | Desc. | H1 | Skips | Canonical | Robots | JSON-LD | In / out | Words | No alt | Impr. | Clicks | Pos. | Top queries (attributed, impressions) |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| / | 200 | 47 | 153 | 1 | h1→h3 | self | index, follow | Organization, WebSite, SoftwareApplication, FAQPage | 32 / 19 | 527 | 0 | 86 | 25 | 2.02 | crawlmouse (17) |
| /pricing | 200 | 20 | 164 | 1 | 0 | self | index, follow | Organization | 32 / 14 | 136 | 0 | 12 | 0 | 16.5 | — |
| /ai-readiness-checker | 200 | 56 | 149 | 1 | 0 | self | index, follow | Organization, WebPage, FAQPage | 32 / 16 | 913 | 0 | 116 | 0 | 34.35 | ai readiness checker (37) |
| /blog | 200 | 55 | 152 | 1 | 0 | self | index, follow | Organization | 32 / 33 | 995 | 0 | 241 | 0 | 63.04 | crawlmouse (17) |
| /guides | 200 | 67 | 148 | 1 | 0 | self | index, follow | Organization | 32 / 31 | 764 | 0 | 108 | 0 | 67.9 | crawl depth (113); what is crawl depth (20); what is crawl depth? (1) |
| /developers | 200 | 70 | 146 | 1 | 0 | self | index, follow | Organization | 32 / 14 | 104 | 0 | 14 | 0 | 7.21 | crawlmouse (17) |
| /bot | 200 | 46 | 127 | 1 | 0 | self | index, follow | Organization | 32 / 14 | 129 | 0 | 41 | 0 | 2.29 | — |
| /status | 200 | 0 | 153 | 1 | 0 | self | index, follow | Organization | 32 / 14 | 45 | 0 | 2 | 0 | 33 | — |
| /privacy | 200 | 27 | 153 | 1 | 0 | self | index, follow | Organization | 32 / 14 | 1410 | 0 | 19 | 0 | 2.58 | — |
| /terms | 200 | 29 | 153 | 1 | 0 | self | index, follow | Organization | 32 / 15 | 1612 | 0 | 0 | 0 | — | — |
| /aup | 200 | 27 | 153 | 1 | 0 | self | index, follow | Organization | 32 / 15 | 331 | 0 | 17 | 0 | 2.35 | — |
| /subprocessors | 200 | 26 | 153 | 1 | 0 | self | index, follow | Organization | 32 / 14 | 198 | 0 | 6 | 0 | 22.33 | — |
| /takedown | 200 | 29 | 153 | 1 | 0 | self | index, follow | Organization | 2 / 14 | 22 | 0 | 2 | 0 | 10 | — |
| /blog/ai-crawler-access-test-2026 | 200 | 77 | 148 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList | 3 / 18 | 2988 | 0 | 0 | 0 | — | block ai bots robots txt (45); ai crawlers robots.txt (20); robots.txt ai bots (18) |
| /blog/cloudflare-ai-crawler-defaults-september-15 | 200 | 117 | 152 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList, FAQPage | 20 / 17 | 1730 | 0 | 123 | 0 | 9.27 | ai crawler blocking (57); block ai crawlers (47); block ai training bots (7) |
| /blog/screaming-frog-vs-lumar-deepcrawl | 200 | 72 | 158 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList, FAQPage | 3 / 19 | 1375 | 0 | 449 | 1 | 20.06 | screaming frog alternative (828); screaming frog vs deepcrawl (297); deepcrawl vs screaming frog (90) |
| /blog/find-orphan-pages-squarespace | 200 | 66 | 161 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList, FAQPage | 4 / 22 | 1484 | 0 | 25 | 0 | 43.16 | how to find orphan pages (5); orphan page (3); what is an orphan page (1) |
| /blog/block-ai-crawlers-robots-txt | 200 | 76 | 157 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList, FAQPage | 19 / 17 | 1571 | 0 | 1030 | 0 | 74.63 | gptbot robots.txt (57); block ai crawlers (47); block ai bots robots txt (45) |
| /blog/sitebulb-vs-jetoctopus-vs-oncrawl | 200 | 62 | 159 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList, FAQPage | 5 / 20 | 1681 | 0 | 153 | 0 | 22.14 | sitebulb alternative (344); sitebulb vs oncrawl (89); sitebulb vs jetoctopus (32) |
| /blog/can-ai-crawlers-see-javascript | 200 | 56 | 163 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList, FAQPage | 9 / 19 | 2192 | 0 | 1088 | 6 | 23.94 | can ai crawlers execute javascript (87); ai search javascript rendering (32); do ai crawlers render javascript (23) |
| /blog/sitebulb-vs-screaming-frog | 200 | 61 | 158 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList, FAQPage | 4 / 21 | 1831 | 0 | 466 | 0 | 31.25 | sitebulb vs screaming frog (289); screaming frog vs sitebulb (112); sitebulb pricing (17) |
| /blog/find-orphan-pages-webflow | 200 | 50 | 151 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList, FAQPage | 3 / 21 | 1197 | 0 | 8 | 0 | 17.75 | how to find orphan pages (5); orphan page (3); what is an orphan page (1) |
| /blog/sitebulb-alternative | 200 | 70 | 145 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList, FAQPage | 5 / 21 | 1817 | 0 | 535 | 0 | 47.02 | sitebulb alternative (344); sitebulb pricing (17); sitebulb (1) |
| /blog/discovered-currently-not-indexed | 200 | 68 | 157 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList, FAQPage | 5 / 19 | 1509 | 0 | 592 | 0 | 81.67 | discovered currently not indexed (208); discovered - currently not indexed (148); fix+discovered+currently+not+indexed (8) |
| /blog/find-orphan-pages-shopify | 200 | 57 | 155 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList, FAQPage | 4 / 20 | 1327 | 0 | 7 | 0 | 5.71 | how to find orphan pages (5); orphan page (3); what is an orphan page (1) |
| /blog/find-orphan-pages-wordpress | 200 | 62 | 155 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList, FAQPage | 6 / 18 | 1314 | 0 | 12 | 0 | 35.33 | how to find orphan pages (5); orphan page (3); what is an orphan page (1) |
| /blog/screaming-frog-alternative | 200 | 67 | 161 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList, FAQPage | 9 / 18 | 1361 | 0 | 1658 | 3 | 56.96 | screaming frog alternative (828); sitebulb alternative (344); sitebulb vs screaming frog (289) |
| /blog/how-deep-is-too-deep-crawl-depth | 200 | 68 | 152 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList | 5 / 18 | 1452 | 0 | 594 | 1 | 65.39 | crawl depth (113); crawl depth seo (105); deep crawl (24) |
| /blog/free-internal-link-audit | 200 | 67 | 162 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList, FAQPage | 6 / 19 | 1129 | 0 | 4 | 0 | 48.75 | — |
| /blog/orphan-pages | 200 | 59 | 154 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList, FAQPage | 12 / 19 | 1728 | 0 | 4 | 0 | 73.5 | how to find orphan pages (5); orphan page (3); what is an orphan page (1) |
| /blog/crawl-depth-site-architecture | 200 | 65 | 149 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList | 12 / 18 | 1100 | 0 | 1 | 0 | 85 | crawl depth (113); crawl depth seo (105); what is crawl depth (20) |
| /blog/research | 200 | 21 | 127 | 1 | 0 | self | index, follow | Organization, BreadcrumbList | 2 / 15 | 83 | 0 | 3 | 0 | 3 | — |
| /authors/udaay-sikder | 200 | 25 | 77 | 1 | 0 | self | index, follow | Organization, Person | 1 / 16 | 64 | 0 | 2 | 0 | 8 | — |

### Titles, descriptions and H1s, flags off

| Page | Title | Meta description | H1 |
| --- | --- | --- | --- |
| / | Crawlmouse — Grade your site's internal linking | Free, no-install internal-linking grader for any website. Find orphan pages, weak hubs, and pages buried too deep — and get a clear A–F grade in seconds. | Grade your site’s internal linking in under 2 minutes. |
| /pricing | Pricing · Crawlmouse | Crawlmouse is free forever — audit any site, get a real A–F grade, and one complete fix. Pro is $19/month or $190/year for every fix, CSV export, and bigger crawls. | Pricing |
| /ai-readiness-checker | Free AI Readiness Checker — Whole-Site Test · Crawlmouse | Check whether ChatGPT, Claude, and Perplexity can find and read your website. A free, whole-site AI readiness score with the exact reasons and fixes. | AI Readiness Checker |
| /blog | Internal Linking & Site Structure — The Crawlmouse Blog | Practical, no-fluff guides to internal linking, orphan pages, crawl depth, and the site structure that actually ranks — from the team behind Crawlmouse. | The Crawlmouse blog |
| /guides | Guides — Internal Linking, Crawl Depth & Getting Found · Crawlmouse | Practical guides to internal linking, orphan pages, crawl depth, and getting your pages crawled and indexed — free tools and honest, no-hype advice. | Guides |
| /developers | Crawlmouse for developers — CLI, GitHub Action & webhooks · Crawlmouse | A CLI, GitHub Action, and webhooks built on the same engine as the web audit. Grade internal linking from your terminal or CI — join the waitlist. | Crawlmouse for developers |
| /bot | CrawlmouseBot — about our crawler · Crawlmouse | What CrawlmouseBot is, how it crawls, and how to block it or request a report takedown. We respect robots.txt and crawl gently. | CrawlmouseBot |
| /status | — | Free, no-install internal-linking grader for any website. Find orphan pages, weak hubs, and pages buried too deep — and get a clear A–F grade in seconds. | Crawlmouse status |
| /privacy | Privacy Policy · Crawlmouse | Free, no-install internal-linking grader for any website. Find orphan pages, weak hubs, and pages buried too deep — and get a clear A–F grade in seconds. | Privacy Policy |
| /terms | Terms of Service · Crawlmouse | Free, no-install internal-linking grader for any website. Find orphan pages, weak hubs, and pages buried too deep — and get a clear A–F grade in seconds. | Terms of Service |
| /aup | Acceptable Use · Crawlmouse | Free, no-install internal-linking grader for any website. Find orphan pages, weak hubs, and pages buried too deep — and get a clear A–F grade in seconds. | Acceptable Use |
| /subprocessors | Subprocessors · Crawlmouse | Free, no-install internal-linking grader for any website. Find orphan pages, weak hubs, and pages buried too deep — and get a clear A–F grade in seconds. | Subprocessors |
| /takedown | Takedown request · Crawlmouse | Free, no-install internal-linking grader for any website. Find orphan pages, weak hubs, and pages buried too deep — and get a clear A–F grade in seconds. | Takedown request |
| /blog/ai-crawler-access-test-2026 | We fetched 96 websites as AI crawlers. The answer depended on who was asking. | We fetched 96 websites as AI crawlers in October 2026. From two cloud networks, the same crawler names got different answers on three of five sites. | We fetched 96 websites as AI crawlers. The answer depended on who was asking. |
| /blog/cloudflare-ai-crawler-defaults-september-15 | Cloudflare Starts Blocking AI Crawlers by Default on September 15. Here's Who It Affects — and How to Check Your Site | From September 15, 2026, Cloudflare blocks Training and Agent crawlers by default on ad pages. What changes, who's affected, and how to check your site. | Cloudflare Starts Blocking AI Crawlers by Default on September 15. Here's Who It Affects — and How to Check Your Site |
| /blog/screaming-frog-vs-lumar-deepcrawl | Screaming Frog vs Lumar (DeepCrawl): Desktop Tool vs Enterprise Platform | Screaming Frog and Lumar (formerly DeepCrawl) solve different problems at very different prices. An honest August 2026 comparison — and when you need neither. | Screaming Frog vs Lumar (DeepCrawl): Desktop Tool vs Enterprise Platform |
| /blog/find-orphan-pages-squarespace | How to Find Orphan Pages on Squarespace (Free, Nothing to Install) | Squarespace's Not Linked section quietly creates orphan pages. Here is how to find every orphan on your Squarespace site for free — and fix the ones that matter. | How to Find Orphan Pages on Squarespace (Free, Nothing to Install) |
| /blog/block-ai-crawlers-robots-txt | Should You Block AI Crawlers? A robots.txt Guide for GPTBot, ClaudeBot & Co. | Should you block GPTBot, ClaudeBot, and other AI crawlers? A practical 2026 robots.txt guide — what each bot does, what blocking costs, and copy-paste rules. | Should You Block AI Crawlers? A robots.txt Guide for GPTBot, ClaudeBot & Co. |
| /blog/sitebulb-vs-jetoctopus-vs-oncrawl | Sitebulb vs JetOctopus vs Oncrawl: Cloud SEO Crawlers Compared | Sitebulb Cloud, JetOctopus, and Oncrawl are the main cloud SEO crawlers. An honest July 2026 comparison of pricing, log analysis, and which one fits your site. | Sitebulb vs JetOctopus vs Oncrawl: Cloud SEO Crawlers Compared |
| /blog/can-ai-crawlers-see-javascript | Can AI Crawlers See Your JavaScript Site? (How to Check) | AI crawlers like GPTBot and ClaudeBot don't run JavaScript, so a JS site can rank on Google yet be invisible to ChatGPT. Here's how to check what yours shows them. | Can AI Crawlers See Your JavaScript Site? (How to Check) |
| /blog/sitebulb-vs-screaming-frog | Sitebulb vs Screaming Frog: Which SEO Crawler Should You Use? | Sitebulb and Screaming Frog are the two big SEO crawlers. Here's an honest comparison of features, pricing, and which to pick — plus a free no-install option. | Sitebulb vs Screaming Frog: Which SEO Crawler Should You Use? |
| /blog/find-orphan-pages-webflow | How to Find Orphan Pages on Webflow (Free, No App) | Webflow orphans pages when you limit CMS Collection Lists or skip navigation links. Here's how to find every orphan page on your Webflow site for free. | How to Find Orphan Pages on Webflow (Free, No App) |
| /blog/sitebulb-alternative | Sitebulb Alternatives (2026): Free and Paid Options, Honestly Compared | Six real Sitebulb alternatives compared with August 2026 pricing — free, paid, and open source. Includes when Sitebulb is still the right choice. | Sitebulb Alternatives (2026): Free and Paid Options, Honestly Compared |
| /blog/discovered-currently-not-indexed | Discovered – Currently Not Indexed: Why It Happens and How to Fix It | Discovered - currently not indexed means Google found your page but hasn't crawled it yet. Here's why it happens, and how stronger internal linking fixes it. | Discovered – Currently Not Indexed: Why It Happens and How to Fix It |
| /blog/find-orphan-pages-shopify | How to Find Orphan Pages on Shopify (Free, No App Needed) | Shopify orphans your canonical product URLs by default, so they rarely get crawled or indexed. Here's how to find every orphan page on your store for free. | How to Find Orphan Pages on Shopify (Free, No App Needed) |
| /blog/find-orphan-pages-wordpress | How to Find Orphan Pages in WordPress (Free, No Plugin Needed) | Orphan pages pile up fast in WordPress. Here's how to find every orphaned post and page for free — no extra plugin needed — and fix the ones worth keeping. | How to Find Orphan Pages in WordPress (Free, No Plugin Needed) |
| /blog/screaming-frog-alternative | Screaming Frog Alternatives in 2026: Six Options, Compared Honestly | Six real Screaming Frog alternatives compared — free, browser-based, cloud, and open source — plus the honest cases where Screaming Frog is still the right tool. | Screaming Frog Alternatives in 2026: Six Options, Compared Honestly |
| /blog/how-deep-is-too-deep-crawl-depth | How Deep Is Too Deep? Crawl Depth Limits and How to Fix Buried Pages | How many clicks from your homepage is too many? A practical, site-size-aware guide to crawl depth limits — and exactly how to pull buried pages back up. | How Deep Is Too Deep? Crawl Depth Limits and How to Fix Buried Pages |
| /blog/free-internal-link-audit | Internal Link Checker: How to Audit Your Site's Internal Links Free | Check your internal links without installing software. Here's how to run a free internal-link audit — orphan pages, weak hubs, and buried pages — in your browser. | Internal Link Checker: How to Audit Your Site's Internal Links Free |
| /blog/orphan-pages | How to Find Orphan Pages on Your Website (Free, No Install) | Orphan pages have no internal links, so search engines rarely rank them. Here's how to find every orphan page free — no Screaming Frog or Semrush install. | How to Find Orphan Pages on Your Website (Free, No Install) |
| /blog/crawl-depth-site-architecture | Crawl Depth & Site Architecture: Why Click-Depth Affects Rankings | Click depth — how far a page sits from your homepage — shapes how often search engines crawl it and how much authority it gets. Here's how to fix it. | Crawl Depth & Site Architecture: Why Click-Depth Affects Rankings |
| /blog/research | Research · Crawlmouse | Research from the Crawlmouse team: live tests of how real websites answer AI crawlers, with the source data behind the numbers. | Research |
| /authors/udaay-sikder | Udaay Sikder · Crawlmouse | Posts by Udaay Sikder, Co-founder, Nahl Technologies, on the Crawlmouse blog. | Udaay Sikder |

## Pages, flags on

| Page | Status | Title | Desc. | H1 | Skips | Canonical | Robots | JSON-LD | In / out | Words | No alt | Impr. | Clicks | Pos. | Top queries (attributed, impressions) |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| / | 200 | 47 | 153 | 1 | 0 | self | index, follow | Organization, WebSite, SoftwareApplication | 49 / 18 | 459 | 0 | 86 | 25 | 2.02 | crawlmouse (17) |
| /pricing | 200 | 0 | 144 | 1 | 0 | self | index, follow | Organization | 49 / 19 | 632 | 0 | 12 | 0 | 16.5 | — |
| /ai-readiness-checker | 200 | 56 | 149 | 1 | 0 | self | index, follow | Organization, WebPage, FAQPage | 49 / 18 | 901 | 0 | 116 | 0 | 34.35 | ai readiness checker (37) |
| /blog | 200 | 55 | 152 | 1 | 0 | self | index, follow | Organization | 49 / 33 | 995 | 0 | 241 | 0 | 63.04 | crawlmouse (17) |
| /guides | 200 | 67 | 148 | 1 | 0 | self | index, follow | Organization | 49 / 32 | 764 | 0 | 108 | 0 | 67.9 | crawl depth (113); what is crawl depth (20); what is crawl depth? (1) |
| /developers | 200 | 23 | 193 | 1 | 0 | self | index, follow | Organization | 49 / 17 | 404 | 0 | 14 | 0 | 7.21 | — |
| /bot | 200 | 46 | 127 | 1 | 0 | self | index, follow | Organization | 49 / 17 | 129 | 0 | 41 | 0 | 2.29 | — |
| /status | 200 | 0 | 153 | 1 | 0 | self | index, follow | Organization | 49 / 17 | 45 | 0 | 2 | 0 | 33 | — |
| /agencies | 200 | 25 | 150 | 1 | 0 | self | index, follow | Organization | 0 / 18 | 367 | 0 | 0 | 0 | — | — |
| /check/gptbot | 200 | 58 | 170 | 1 | 0 | self | index, follow | Organization | 0 / 17 | 260 | 0 | 0 | 0 | — | — |
| /check/javascript | 200 | 77 | 167 | 1 | 0 | self | index, follow | Organization | 0 / 17 | 213 | 0 | 0 | 0 | — | can ai crawl javascript (4); can ai read javascript (3); can google read javascript (3) |
| /check/robots-ai | 200 | 67 | 148 | 1 | 0 | self | index, follow | Organization | 0 / 17 | 325 | 0 | 0 | 0 | — | ai crawlers robots.txt (20); robots.txt ai crawler (14); robots.txt for ai (10) |
| /help | 200 | 17 | 119 | 1 | 0 | self | index, follow | Organization | 49 / 29 | 276 | 0 | 0 | 0 | — | — |
| /help/what-an-audit-measures | 200 | 50 | 78 | 1 | 0 | self | index, follow | Organization | 1 / 18 | 155 | 0 | 0 | 0 | — | crawlmouse (17) |
| /help/how-grades-are-calculated | 200 | 43 | 91 | 1 | 0 | self | index, follow | Organization | 3 / 17 | 230 | 0 | 0 | 0 | — | — |
| /help/crawler-shown-as-blocked | 200 | 80 | 97 | 1 | 0 | self | index, follow | Organization | 2 / 18 | 283 | 0 | 0 | 0 | — | — |
| /help/fix-still-open | 200 | 54 | 87 | 1 | 0 | self | index, follow | Organization | 1 / 17 | 183 | 0 | 0 | 0 | — | — |
| /help/audit-expired | 200 | 57 | 64 | 1 | 0 | self | index, follow | Organization | 1 / 17 | 125 | 0 | 0 | 0 | — | — |
| /help/sign-in-email | 200 | 44 | 75 | 1 | 0 | self | index, follow | Organization | 1 / 17 | 83 | 0 | 0 | 0 | — | — |
| /help/trials | 200 | 67 | 77 | 1 | 0 | self | index, follow | Organization | 3 / 18 | 178 | 0 | 0 | 0 | — | — |
| /help/cancel-and-refunds | 200 | 45 | 65 | 1 | 0 | self | index, follow | Organization | 2 / 18 | 141 | 0 | 0 | 0 | — | — |
| /help/other-tools-scores | 200 | 75 | 70 | 1 | 0 | self | index, follow | Organization | 1 / 18 | 94 | 0 | 0 | 0 | — | — |
| /help/how-we-crawl | 200 | 79 | 84 | 1 | 0 | self | index, follow | Organization | 2 / 18 | 182 | 0 | 0 | 0 | — | crawlmouse (17) |
| /help/plans | 200 | 45 | 83 | 1 | 0 | self | index, follow | Organization | 1 / 18 | 208 | 0 | 0 | 0 | — | — |
| /help/delete-account | 200 | 49 | 72 | 1 | 0 | self | index, follow | Organization | 1 / 17 | 198 | 0 | 0 | 0 | — | — |
| /privacy | 200 | 27 | 153 | 1 | 0 | self | index, follow | Organization | 49 / 17 | 1410 | 0 | 19 | 0 | 2.58 | — |
| /terms | 200 | 29 | 153 | 1 | 0 | self | index, follow | Organization | 49 / 18 | 1612 | 0 | 0 | 0 | — | — |
| /aup | 200 | 27 | 153 | 1 | 0 | self | index, follow | Organization | 49 / 18 | 331 | 0 | 17 | 0 | 2.35 | — |
| /subprocessors | 200 | 26 | 153 | 1 | 0 | self | index, follow | Organization | 49 / 17 | 198 | 0 | 6 | 0 | 22.33 | — |
| /takedown | 200 | 29 | 153 | 1 | 0 | self | index, follow | Organization | 2 / 17 | 22 | 0 | 2 | 0 | 10 | — |
| /blog/ai-crawler-access-test-2026 | 200 | 77 | 148 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList | 3 / 20 | 2988 | 0 | 0 | 0 | — | block ai bots robots txt (45); ai crawlers robots.txt (20); robots.txt ai bots (18) |
| /blog/cloudflare-ai-crawler-defaults-september-15 | 200 | 117 | 152 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList, FAQPage | 20 / 18 | 1730 | 0 | 123 | 0 | 9.27 | ai crawler blocking (57); block ai crawlers (47); block ai training bots (7) |
| /blog/screaming-frog-vs-lumar-deepcrawl | 200 | 72 | 158 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList, FAQPage | 3 / 21 | 1375 | 0 | 449 | 1 | 20.06 | screaming frog alternative (828); screaming frog vs deepcrawl (297); deepcrawl vs screaming frog (90) |
| /blog/find-orphan-pages-squarespace | 200 | 66 | 161 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList, FAQPage | 4 / 24 | 1484 | 0 | 25 | 0 | 43.16 | how to find orphan pages (5); orphan page (3); what is an orphan page (1) |
| /blog/block-ai-crawlers-robots-txt | 200 | 76 | 157 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList, FAQPage | 49 / 19 | 1571 | 0 | 1030 | 0 | 74.63 | gptbot robots.txt (57); block ai crawlers (47); block ai bots robots txt (45) |
| /blog/sitebulb-vs-jetoctopus-vs-oncrawl | 200 | 62 | 159 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList, FAQPage | 5 / 21 | 1681 | 0 | 153 | 0 | 22.14 | sitebulb alternative (344); sitebulb vs oncrawl (89); sitebulb vs jetoctopus (32) |
| /blog/can-ai-crawlers-see-javascript | 200 | 56 | 163 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList, FAQPage | 49 / 21 | 2192 | 0 | 1088 | 6 | 23.94 | can ai crawlers execute javascript (87); ai search javascript rendering (32); do ai crawlers render javascript (23) |
| /blog/sitebulb-vs-screaming-frog | 200 | 61 | 158 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList, FAQPage | 4 / 22 | 1831 | 0 | 466 | 0 | 31.25 | sitebulb vs screaming frog (289); screaming frog vs sitebulb (112); sitebulb pricing (17) |
| /blog/find-orphan-pages-webflow | 200 | 50 | 151 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList, FAQPage | 3 / 22 | 1197 | 0 | 8 | 0 | 17.75 | how to find orphan pages (5); orphan page (3); what is an orphan page (1) |
| /blog/sitebulb-alternative | 200 | 70 | 145 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList, FAQPage | 4 / 23 | 1817 | 0 | 535 | 0 | 47.02 | sitebulb alternative (344); sitebulb pricing (17); sitebulb (1) |
| /blog/discovered-currently-not-indexed | 200 | 68 | 157 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList, FAQPage | 4 / 21 | 1509 | 0 | 592 | 0 | 81.67 | discovered currently not indexed (208); discovered - currently not indexed (148); fix+discovered+currently+not+indexed (8) |
| /blog/find-orphan-pages-shopify | 200 | 57 | 155 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList, FAQPage | 4 / 22 | 1327 | 0 | 7 | 0 | 5.71 | how to find orphan pages (5); orphan page (3); what is an orphan page (1) |
| /blog/find-orphan-pages-wordpress | 200 | 62 | 155 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList, FAQPage | 6 / 20 | 1314 | 0 | 12 | 0 | 35.33 | how to find orphan pages (5); orphan page (3); what is an orphan page (1) |
| /blog/screaming-frog-alternative | 200 | 67 | 161 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList, FAQPage | 8 / 19 | 1361 | 0 | 1658 | 3 | 56.96 | screaming frog alternative (828); sitebulb alternative (344); sitebulb vs screaming frog (289) |
| /blog/how-deep-is-too-deep-crawl-depth | 200 | 68 | 152 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList | 4 / 20 | 1452 | 0 | 594 | 1 | 65.39 | crawl depth (113); crawl depth seo (105); deep crawl (24) |
| /blog/free-internal-link-audit | 200 | 67 | 162 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList, FAQPage | 6 / 21 | 1129 | 0 | 4 | 0 | 48.75 | — |
| /blog/orphan-pages | 200 | 59 | 154 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList, FAQPage | 11 / 21 | 1728 | 0 | 4 | 0 | 73.5 | how to find orphan pages (5); orphan page (3); what is an orphan page (1) |
| /blog/crawl-depth-site-architecture | 200 | 65 | 149 | 1 | 0 | self | index, follow | Organization, Article, BreadcrumbList | 12 / 20 | 1100 | 0 | 1 | 0 | 85 | crawl depth (113); crawl depth seo (105); what is crawl depth (20) |
| /blog/research | 200 | 21 | 127 | 1 | 0 | self | index, follow | Organization, BreadcrumbList | 49 / 18 | 83 | 0 | 3 | 0 | 3 | — |
| /authors/udaay-sikder | 200 | 25 | 77 | 1 | 0 | self | index, follow | Organization, Person | 1 / 18 | 64 | 0 | 2 | 0 | 8 | — |

### Titles, descriptions and H1s, flags on

| Page | Title | Meta description | H1 |
| --- | --- | --- | --- |
| / | Crawlmouse — Grade your site's internal linking | Free, no-install internal-linking grader for any website. Find orphan pages, weak hubs, and pages buried too deep — and get a clear A–F grade in seconds. | Can ChatGPT, Claude and Google actually read your site? |
| /pricing | — | Every audit is free and complete. Pro is $19 a month for every fix the audit finds, on up to 5 sites; Agency is $99 a month for 25 client sites. | Every audit is free. Pay when you want it watched. |
| /ai-readiness-checker | Free AI Readiness Checker — Whole-Site Test · Crawlmouse | Check whether ChatGPT, Claude, and Perplexity can find and read your website. A free, whole-site AI readiness score with the exact reasons and fixes. | AI Readiness Checker |
| /blog | Internal Linking & Site Structure — The Crawlmouse Blog | Practical, no-fluff guides to internal linking, orphan pages, crawl depth, and the site structure that actually ranks — from the team behind Crawlmouse. | The Crawlmouse blog |
| /guides | Guides — Internal Linking, Crawl Depth & Getting Found · Crawlmouse | Practical guides to internal linking, orphan pages, crawl depth, and getting your pages crawled and indexed — free tools and honest, no-hype advice. | Guides |
| /developers | Developers · Crawlmouse | A read-only API for your Crawlmouse audits is planned for Pro: the latest audit of each of your sites as JSON. See the response it will return, what comes after it, and join the developer list. | A read-only API for your audits, then the audit as a tool your agent can call. |
| /bot | CrawlmouseBot — about our crawler · Crawlmouse | What CrawlmouseBot is, how it crawls, and how to block it or request a report takedown. We respect robots.txt and crawl gently. | CrawlmouseBot |
| /status | — | Free, no-install internal-linking grader for any website. Find orphan pages, weak hubs, and pages buried too deep — and get a clear A–F grade in seconds. | Crawlmouse status |
| /agencies | For agencies · Crawlmouse | Audit a prospect’s site free before the first call. Agency is $99 a month for 25 client sites, with a 14-day trial; branded client reports are coming. | Audit a prospect’s site before the first call. |
| /check/gptbot | Is GPTBot blocked? A free AI visibility check · Crawlmouse | Find out whether GPTBot, OAI-SearchBot and ChatGPT-User can reach your site, and which of them your AI visibility depends on. Free, about two minutes, nothing to install. | Is GPTBot blocked on your site? |
| /check/javascript | Can AI crawlers read your JavaScript? A free AI visibility check · Crawlmouse | Most AI crawlers read only the HTML your server sends. See how much of each page is left without JavaScript, page by page. Free, about two minutes, nothing to install. | Can AI crawlers read your site without JavaScript? |
| /check/robots-ai | robots.txt for AI crawlers: a free AI visibility check · Crawlmouse | What your robots.txt tells GPTBot, OAI-SearchBot, ClaudeBot and PerplexityBot, and what it cannot stop. Free, about two minutes, nothing to install. | What does your robots.txt tell AI crawlers? |
| /help | Help · Crawlmouse | Answers to the questions people ask about Crawlmouse: audits and grades, crawlers, sign-in, trials, plans and accounts. | Help |
| /help/what-an-audit-measures | What does a Crawlmouse audit measure? · Crawlmouse | The two grades an audit gives, the sections of its result, and what is scored. | What does a Crawlmouse audit measure? |
| /help/how-grades-are-calculated | How are the grades calculated? · Crawlmouse | The parts of AI readability and Technical SEO, their weights, and when a grade is withheld. | How are the grades calculated? |
| /help/crawler-shown-as-blocked | Your audit says a crawler is blocked, but we never blocked it. Why? · Crawlmouse | What the audit sent as each AI crawler, what “blocked” means in it, and how to check it yourself. | Your audit says a crawler is blocked, but we never blocked it. Why? |
| /help/fix-still-open | I marked a fix done and it is still open. · Crawlmouse | What marking a fix done starts, what the re-check decides, and why a fix can stay open. | I marked a fix done and it is still open. |
| /help/audit-expired | Where is my audit? The link says it expired. · Crawlmouse | How long an audit nobody keeps can be read, and how to keep one. | Where is my audit? The link says it expired. |
| /help/sign-in-email | I didn’t get the sign-in email. · Crawlmouse | Where the sign-in link comes from, how long it works, and how to ask again. | I didn’t get the sign-in email. |
| /help/trials | Does the trial need a card? What happens when it ends? · Crawlmouse | The Pro and Agency trials, what each asks for, and what happens at their end. | Does the trial need a card? What happens when it ends? |
| /help/cancel-and-refunds | How do I cancel or get a refund? · Crawlmouse | Where cancelling is, when it takes effect, and the refund policy. | How do I cancel or get a refund? |
| /help/other-tools-scores | Why does your score differ from Lighthouse, Semrush or Ahrefs? · Crawlmouse | Each tool grades its own question; what the Crawlmouse grades measure. | Why does your score differ from Lighthouse, Semrush or Ahrefs? |
| /help/how-we-crawl | How does Crawlmouse crawl my site, and how do I allow or block it? · Crawlmouse | The user agents an audit sends, the robots.txt groups it obeys, and how to block it. | How does Crawlmouse crawl my site, and how do I allow or block it? |
| /help/plans | What is in Free, Pro and Agency? · Crawlmouse | What each plan includes, from the limits the product enforces, and what each costs. | What is in Free, Pro and Agency? |
| /help/delete-account | How do I delete my account and data? · Crawlmouse | Where deleting is, the days in which it can be undone, and what is kept. | How do I delete my account and data? |
| /privacy | Privacy Policy · Crawlmouse | Free, no-install internal-linking grader for any website. Find orphan pages, weak hubs, and pages buried too deep — and get a clear A–F grade in seconds. | Privacy Policy |
| /terms | Terms of Service · Crawlmouse | Free, no-install internal-linking grader for any website. Find orphan pages, weak hubs, and pages buried too deep — and get a clear A–F grade in seconds. | Terms of Service |
| /aup | Acceptable Use · Crawlmouse | Free, no-install internal-linking grader for any website. Find orphan pages, weak hubs, and pages buried too deep — and get a clear A–F grade in seconds. | Acceptable Use |
| /subprocessors | Subprocessors · Crawlmouse | Free, no-install internal-linking grader for any website. Find orphan pages, weak hubs, and pages buried too deep — and get a clear A–F grade in seconds. | Subprocessors |
| /takedown | Takedown request · Crawlmouse | Free, no-install internal-linking grader for any website. Find orphan pages, weak hubs, and pages buried too deep — and get a clear A–F grade in seconds. | Takedown request |
| /blog/ai-crawler-access-test-2026 | We fetched 96 websites as AI crawlers. The answer depended on who was asking. | We fetched 96 websites as AI crawlers in October 2026. From two cloud networks, the same crawler names got different answers on three of five sites. | We fetched 96 websites as AI crawlers. The answer depended on who was asking. |
| /blog/cloudflare-ai-crawler-defaults-september-15 | Cloudflare Starts Blocking AI Crawlers by Default on September 15. Here's Who It Affects — and How to Check Your Site | From September 15, 2026, Cloudflare blocks Training and Agent crawlers by default on ad pages. What changes, who's affected, and how to check your site. | Cloudflare Starts Blocking AI Crawlers by Default on September 15. Here's Who It Affects — and How to Check Your Site |
| /blog/screaming-frog-vs-lumar-deepcrawl | Screaming Frog vs Lumar (DeepCrawl): Desktop Tool vs Enterprise Platform | Screaming Frog and Lumar (formerly DeepCrawl) solve different problems at very different prices. An honest August 2026 comparison — and when you need neither. | Screaming Frog vs Lumar (DeepCrawl): Desktop Tool vs Enterprise Platform |
| /blog/find-orphan-pages-squarespace | How to Find Orphan Pages on Squarespace (Free, Nothing to Install) | Squarespace's Not Linked section quietly creates orphan pages. Here is how to find every orphan on your Squarespace site for free — and fix the ones that matter. | How to Find Orphan Pages on Squarespace (Free, Nothing to Install) |
| /blog/block-ai-crawlers-robots-txt | Should You Block AI Crawlers? A robots.txt Guide for GPTBot, ClaudeBot & Co. | Should you block GPTBot, ClaudeBot, and other AI crawlers? A practical 2026 robots.txt guide — what each bot does, what blocking costs, and copy-paste rules. | Should You Block AI Crawlers? A robots.txt Guide for GPTBot, ClaudeBot & Co. |
| /blog/sitebulb-vs-jetoctopus-vs-oncrawl | Sitebulb vs JetOctopus vs Oncrawl: Cloud SEO Crawlers Compared | Sitebulb Cloud, JetOctopus, and Oncrawl are the main cloud SEO crawlers. An honest July 2026 comparison of pricing, log analysis, and which one fits your site. | Sitebulb vs JetOctopus vs Oncrawl: Cloud SEO Crawlers Compared |
| /blog/can-ai-crawlers-see-javascript | Can AI Crawlers See Your JavaScript Site? (How to Check) | AI crawlers like GPTBot and ClaudeBot don't run JavaScript, so a JS site can rank on Google yet be invisible to ChatGPT. Here's how to check what yours shows them. | Can AI Crawlers See Your JavaScript Site? (How to Check) |
| /blog/sitebulb-vs-screaming-frog | Sitebulb vs Screaming Frog: Which SEO Crawler Should You Use? | Sitebulb and Screaming Frog are the two big SEO crawlers. Here's an honest comparison of features, pricing, and which to pick — plus a free no-install option. | Sitebulb vs Screaming Frog: Which SEO Crawler Should You Use? |
| /blog/find-orphan-pages-webflow | How to Find Orphan Pages on Webflow (Free, No App) | Webflow orphans pages when you limit CMS Collection Lists or skip navigation links. Here's how to find every orphan page on your Webflow site for free. | How to Find Orphan Pages on Webflow (Free, No App) |
| /blog/sitebulb-alternative | Sitebulb Alternatives (2026): Free and Paid Options, Honestly Compared | Six real Sitebulb alternatives compared with August 2026 pricing — free, paid, and open source. Includes when Sitebulb is still the right choice. | Sitebulb Alternatives (2026): Free and Paid Options, Honestly Compared |
| /blog/discovered-currently-not-indexed | Discovered – Currently Not Indexed: Why It Happens and How to Fix It | Discovered - currently not indexed means Google found your page but hasn't crawled it yet. Here's why it happens, and how stronger internal linking fixes it. | Discovered – Currently Not Indexed: Why It Happens and How to Fix It |
| /blog/find-orphan-pages-shopify | How to Find Orphan Pages on Shopify (Free, No App Needed) | Shopify orphans your canonical product URLs by default, so they rarely get crawled or indexed. Here's how to find every orphan page on your store for free. | How to Find Orphan Pages on Shopify (Free, No App Needed) |
| /blog/find-orphan-pages-wordpress | How to Find Orphan Pages in WordPress (Free, No Plugin Needed) | Orphan pages pile up fast in WordPress. Here's how to find every orphaned post and page for free — no extra plugin needed — and fix the ones worth keeping. | How to Find Orphan Pages in WordPress (Free, No Plugin Needed) |
| /blog/screaming-frog-alternative | Screaming Frog Alternatives in 2026: Six Options, Compared Honestly | Six real Screaming Frog alternatives compared — free, browser-based, cloud, and open source — plus the honest cases where Screaming Frog is still the right tool. | Screaming Frog Alternatives in 2026: Six Options, Compared Honestly |
| /blog/how-deep-is-too-deep-crawl-depth | How Deep Is Too Deep? Crawl Depth Limits and How to Fix Buried Pages | How many clicks from your homepage is too many? A practical, site-size-aware guide to crawl depth limits — and exactly how to pull buried pages back up. | How Deep Is Too Deep? Crawl Depth Limits and How to Fix Buried Pages |
| /blog/free-internal-link-audit | Internal Link Checker: How to Audit Your Site's Internal Links Free | Check your internal links without installing software. Here's how to run a free internal-link audit — orphan pages, weak hubs, and buried pages — in your browser. | Internal Link Checker: How to Audit Your Site's Internal Links Free |
| /blog/orphan-pages | How to Find Orphan Pages on Your Website (Free, No Install) | Orphan pages have no internal links, so search engines rarely rank them. Here's how to find every orphan page free — no Screaming Frog or Semrush install. | How to Find Orphan Pages on Your Website (Free, No Install) |
| /blog/crawl-depth-site-architecture | Crawl Depth & Site Architecture: Why Click-Depth Affects Rankings | Click depth — how far a page sits from your homepage — shapes how often search engines crawl it and how much authority it gets. Here's how to fix it. | Crawl Depth & Site Architecture: Why Click-Depth Affects Rankings |
| /blog/research | Research · Crawlmouse | Research from the Crawlmouse team: live tests of how real websites answer AI crawlers, with the source data behind the numbers. | Research |
| /authors/udaay-sikder | Udaay Sikder · Crawlmouse | Posts by Udaay Sikder, Co-founder, Nahl Technologies, on the Crawlmouse blog. | Udaay Sikder |
