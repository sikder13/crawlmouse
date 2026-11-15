# CC-40 — the public site's SEO, AEO and GEO, made launch-ready

v2 goes public by switching flags (`V2_CHECKS_PUBLIC`, `V2_BILLING`, with `V2_ACCOUNT_DOOR` and
`V2_PIPELINE`). This step makes what search and answer engines read about Crawlmouse true for v2 in that
build, keeps the flags-off build what main serves, and adds structure without moving anything that
earns impressions. The rule above every decision: no URL, title, H1, heading or canonical that earns
impressions changes without the owner (OPERATING-RULES §13).

## What differed from the brief, on main 66c58828

- 18 posts, not 19 (`grep -c '^    slug:' apps/web/lib/blog/posts.ts`); 14 of them mention a grade
  (`git grep -l -i grade apps/web/lib/blog/content | wc -l`).
- The Search Console export has no page × query table. Which queries a page earns is attributed by word
  match (`apps/web/lib/seo/attribution.ts`) and labelled "attributed" wherever it is shown.
- Two guards froze each pre-C-01 post's article markup and links (`__tests__/blog-existing-posts-*.test.tsx`).
  D4–D6 change those by design; the guards now require the baseline back after the listed additions are
  set aside and the D5 edits reversed (D4 below).
- The v2 home's plan card says Agency $69 (`apps/web/components/v2/screens/home/HomeScreen.tsx`);
  `apps/web/lib/billing/prices.ts` and `/pricing` say $99. D2's structured data follows prices.ts; the
  card is the owner's to correct before the flag turns on.

## Decisions

**D1 — Audit first, rendered, both builds.** `scripts/seo/audit.ts` (`pnpm seo:audit`) reads a running
production build's sitemap, fetches each listed URL and each app surface, and saves the run;
`--render` writes `docs/seo/page-audit.md` from saved runs (`docs/seo/audit-data/`). The analysis is in
`apps/web/lib/seo/`: `page-facts.ts` (what a crawler reads on a page), `schema-required.ts` (the
properties this site requires of each schema.org type; a type with none declared fails),
`search-console.ts` (the 2026-11-15 export as data), `attribution.ts`, `app-surfaces.ts` (every
`app/` route folder classified; `app-surfaces.test.ts` fails on one that is not), `audit-run.ts`,
`audit-report.ts`. The report shows, per build: status, title and description lengths, H1 count,
skipped heading levels, canonical, robots, JSON-LD types and missing properties, in/out internal links,
word count, images without alt, Search Console clicks/impressions/position and attributed top queries;
the posts not in Search Console's indexed list with the measured factors (canonical, noindex, in-links,
words, nearest post by 5-gram similarity) against the indexed posts' range, and Search Console's own
not-indexed reasons (counts only — the export lists no URL per reason); each app surface's answer in
both builds; and what `https://www.crawlmouse.com/` answers. Run before any page change (commit
`2cdd003d`) and on the final tree.

**D2 — v2 truth, keyed on the flags, v1 byte-identical.** With `V2_CHECKS_PUBLIC` on: the v2 home has
its own title, description, Open Graph and Twitter text (`app/v2-home/page.tsx`), so the root layout,
which v1's home and v1 /pricing and /developers inherit, is not touched; the root share card's words and
`alt` follow the flag (`app/opengraph-image.tsx`; the card is built with the site, so the flag is read
at build); `softwareApplicationLd()` describes v2 and offers Free at 0, Pro monthly and yearly, and —
while `V2_BILLING` sells it — Agency monthly and yearly, each price from `prices.ts`;
`organizationLd()` names Crawlmouse with `parentOrganization` Nahl Technologies Inc
(https://nahltech.com) and an address of locality, region and country only (Indianapolis, IN, US) and
no `sameAs` (no profile is known to exist); `/llms.txt` carries the v2 descriptor and lists each key
page with its own title and meta description read from the page's metadata (`lib/seo/llms-v2.ts`),
then every post with its description. The three owner strings are one constant each in
`lib/seo/site-copy.ts`; the options are in the step's notes (`copy-proposals.md`).
Flags off: `lib/seo/flags-off-v1.test.tsx` compares the root layout metadata, the share card (its PNG's
sha256), Organization, WebSite and SoftwareApplication, and `/llms.txt` with a capture from main 66c58828.

**D3 — Technical SEO on each public page, both builds, pinned by one test.** See subagent A's section
(below, completed at merge).

**D4 — Answer-engine structure, additive only.** `lib/blog/answers.ts` holds, per post, the summary and
the "Questions this answers" items, each with the body sentences it is drawn from;
`__tests__/blog-answers.test.tsx` requires those sentences in the post, each number of an addition in
its sources, and each word of three letters or more in the body. 13 posts already opened with a Quick
answer and 15 already ended with their own visible FAQ: those keep theirs (the Quick answer becomes the
Article `abstract`). A summary was added on 5 posts and "Questions this answers" on 3; `updatedAt` is
2026-11-15 on those 5. The research post carries `Dataset` structured data from its own body
(`lib/blog/datasets.ts`), with no licence claimed. The byline gains the author's role and LinkedIn where a
post names an author. One inline source was added where the source was read and states the figures.
Additions live in named containers (`p.post-summary`, `section.post-questions`, `.post-author-role`,
`sup.post-source`, `nav[aria-label="More on this topic"]`), which the two pinned guards set aside.

**D5 — Accurate for v2, smallest edits.** Each edit is data in `apps/web/lib/blog/v2-edits.ts`;
`__tests__/blog-v2-edits.test.ts` checks each `after` stands at its line and each `before` is gone, and the
existing-post guard reverses each one and requires the baseline markup. The table below is
`v2EditsMarkdown()`'s output; `__tests__/spec-40-d5-table.test.ts` fails when it differs.

<!-- prettier-ignore-start -->
<!-- d5-table:start -->
5 sentences changed (D5):

| Where | Before | After | Why |
| --- | --- | --- | --- |
| `apps/web/components/blog/ArticleLayout.tsx:113` | Crawlmouse crawls your site, maps every internal link, and gives you an A–F grade in under two minutes. Free, no install. | Crawlmouse crawls your site, maps every internal link, and grades what it finds. Free, no install. | An A–F internal-linking grade is v1’s result; v2 grades AI readability and Technical SEO, and gives its time as about two minutes. |
| `apps/web/lib/blog/content/screaming-frog-alternative.tsx:89` | get an A–F internal-linking grade and a 0–100 <a href="/ai-readiness-checker">AI-readiness score</a> for the whole site, with fixes | get grades for the whole site’s structure and for <a href="/ai-readiness-checker">how well AI crawlers can read it</a>, with fixes | The A–F internal-linking grade and the 0–100 AI-readiness score are v1’s; v2 grades AI readability and Technical SEO. |
| `apps/web/lib/blog/content/screaming-frog-alternative.tsx:109` | <strong>Price:</strong> free; Pro at $19/month for every fix, CSV export, and white-label reports. | <strong>Price:</strong> free; paid plans from $19/month. | In v2, white-label reports are on Agency, not Pro; Pro is still $19 a month in both builds. |
| `apps/web/lib/blog/content/free-internal-link-audit.tsx:98` | and returns a single A–F grade plus the specific problems | and returns a grade for its structure plus the specific problems | A single A–F internal-linking grade is v1’s result; v2 returns two grades. |
| `apps/web/lib/blog/content/sitebulb-alternative.tsx:161` | returns a single A–F grade plus the specific problems behind it | returns a grade for its structure plus the specific problems behind it | A single A–F internal-linking grade is v1’s result; v2 returns two grades. |
<!-- d5-table:end -->
<!-- prettier-ignore-end -->

**D6 — Keyword map, clusters and internal links.** See subagent A's section (below, completed at merge).

**D7 — Proof.** Lighthouse, the final D1 run and the §13 command set are recorded in the PR description.

## Rulings during the step

**Ruling 1 (CTO, 08:20 ET).** Plan accepted. The \$69 Agency card is corrected by CC-39; this step merges
it when it reaches main and the final audit compares each page's Offer prices with the prices it shows.

**Ruling 2 (owner, 08:26 ET).** The 17 posts with no author are Samia Zaman's (`author: 'samia-zaman'` in
`lib/blog/posts.ts`); her byline, author page (`/authors/samia-zaman`, now in the sitemap) and Person
markup follow from the data, and `updatedAt` did not move for it. D8, the banned-wording rule, is below.

**Ruling 3 (CTO, owner-delegated, 08:50 ET) — deliberate §13 changes.** The v2 home's title, description
and `/llms.txt` descriptor are the ruling's (`lib/seo/site-copy.ts`), with the plans and prices in
`/llms.txt` generated from `prices.ts`. A post may carry a `seoTitle`, which sets `<title>`, Open Graph
and Twitter only; the H1, the Article headline, the slug and every heading keep the post's `title`.
Each change is data in `apps/web/lib/blog/ruled-copy.ts`, with what it replaced and the Search Console
line it rests on; `lib/blog/ruled-copy.test.ts` checks each `before` against the pre-CC-40 baseline
fixture and each `after` against `posts.ts`, and the pinned existing-post guard applies them to its
baseline and must then match exactly. The table is `ruledChangesMarkdown()`'s output;
`__tests__/spec-40-d5-table.test.ts` fails when it differs. No slug or URL changed.

<!-- prettier-ignore-start -->
<!-- ruled-table:start -->
17 changes (ruling 3): 7 search-result titles, 10 meta descriptions.

| Post | Field | Before (chars) | After (chars) | Search Console, 3 months |
| --- | --- | --- | --- | --- |
| /blog/cloudflare-ai-crawler-defaults-september-15 | <title> | Cloudflare Starts Blocking AI Crawlers by Default on September 15. Here's Who It Affects — and How to Check Your Site (117) | Cloudflare Now Blocks AI Crawlers by Default: Check Your Site (61) | position 9.27, 123 impressions, 0 clicks; the 117-character title is cut in results |
| /blog/block-ai-crawlers-robots-txt | <title> | Should You Block AI Crawlers? A robots.txt Guide for GPTBot, ClaudeBot & Co. (76) | Block AI Crawlers in robots.txt: GPTBot, ClaudeBot & More (57) | position 74.63, 1,030 impressions; queries "gptbot robots.txt", "block ai crawlers" |
| /blog/screaming-frog-alternative | <title> | Screaming Frog Alternatives in 2026: Six Options, Compared Honestly (67) | Screaming Frog Alternatives (2026): 6 Options Compared (54) | position 56.96, 1,658 impressions; the title was 67 characters |
| /blog/sitebulb-alternative | <title> | Sitebulb Alternatives (2026): Free and Paid Options, Honestly Compared (70) | Sitebulb Alternatives (2026): Free and Paid Options Compared (60) | position 47.02, 535 impressions; the title was 70 characters |
| /blog/screaming-frog-vs-lumar-deepcrawl | <title> | Screaming Frog vs Lumar (DeepCrawl): Desktop Tool vs Enterprise Platform (72) | Screaming Frog vs DeepCrawl (Lumar): Which Crawler to Use? (58) | position 20.06, 449 impressions; queries "screaming frog vs deepcrawl" (297), "deepcrawl vs screaming frog" (90) |
| /blog/how-deep-is-too-deep-crawl-depth | <title> | How Deep Is Too Deep? Crawl Depth Limits and How to Fix Buried Pages (68) | Crawl Depth: How Many Clicks Is Too Deep, and How to Fix It (59) | position 65.39, 594 impressions; queries "crawl depth", "crawl depth seo" |
| /blog/discovered-currently-not-indexed | <title> | Discovered – Currently Not Indexed: Why It Happens and How to Fix It (68) | Discovered – Currently Not Indexed: Causes and Fixes (52) | position 81.67, 592 impressions; query "discovered currently not indexed" |
| /blog/screaming-frog-alternative | description | Six real Screaming Frog alternatives compared — free, browser-based, cloud, and open source — plus the honest cases where Screaming Frog is still the right tool. (161) | Screaming Frog alternatives compared: free, browser-based, cloud and open-source crawlers, with prices, limits, and when Screaming Frog is still the pick. (154) | 1,658 impressions, 3 clicks, CTR 0.18%, position 56.96 |
| /blog/can-ai-crawlers-see-javascript | description | AI crawlers like GPTBot and ClaudeBot don't run JavaScript, so a JS site can rank on Google yet be invisible to ChatGPT. Here's how to check what yours shows them. (163) | Can AI crawlers see JavaScript? GPTBot, ClaudeBot and PerplexityBot don't execute it, so a JS site can rank on Google yet show them nothing. How to check. (154) | 1,088 impressions, 6 clicks, CTR 0.55%, position 23.94 |
| /blog/block-ai-crawlers-robots-txt | description | Should you block GPTBot, ClaudeBot, and other AI crawlers? A practical 2026 robots.txt guide — what each bot does, what blocking costs, and copy-paste rules. (157) | Block AI crawlers in robots.txt? What GPTBot, ClaudeBot and other bots do, what blocking costs, and copy-paste rules for each choice. (133) | 1,030 impressions, 0 clicks, position 74.63 |
| /blog/how-deep-is-too-deep-crawl-depth | description | How many clicks from your homepage is too many? A practical, site-size-aware guide to crawl depth limits — and exactly how to pull buried pages back up. (152) | How deep is too deep? Crawl depth explained: how many clicks from the homepage is too many for your site's size, and how to pull buried pages back up. (150) | 594 impressions, 1 click, CTR 0.17%, position 65.39 |
| /blog/discovered-currently-not-indexed | description | Discovered - currently not indexed means Google found your page but hasn't crawled it yet. Here's why it happens, and how stronger internal linking fixes it. (157) | Discovered – currently not indexed: Google found the URL but has not crawled it. Why it happens, how to check, and how internal links get it crawled. (149) | 592 impressions, 0 clicks, position 81.67 |
| /blog/sitebulb-alternative | description | Six real Sitebulb alternatives compared with August 2026 pricing — free, paid, and open source. Includes when Sitebulb is still the right choice. (145) | Sitebulb alternatives with current pricing: free, paid and open-source crawlers compared honestly, and the cases where Sitebulb is still the right choice. (154) | 535 impressions, 0 clicks, position 47.02 |
| /blog/sitebulb-vs-screaming-frog | description | Sitebulb and Screaming Frog are the two big SEO crawlers. Here's an honest comparison of features, pricing, and which to pick — plus a free no-install option. (158) | Sitebulb vs Screaming Frog: features, pricing and reports of the two big SEO crawlers compared, which one fits your work, and a free no-install option. (151) | 466 impressions, 0 clicks, position 31.25 |
| /blog/screaming-frog-vs-lumar-deepcrawl | description | Screaming Frog and Lumar (formerly DeepCrawl) solve different problems at very different prices. An honest August 2026 comparison — and when you need neither. (158) | Screaming Frog vs DeepCrawl (now Lumar): desktop crawler vs enterprise platform — pricing, monitoring and CI/CD compared, and when you need neither. (148) | 449 impressions, 1 click, CTR 0.22%, position 20.06 |
| /blog/sitebulb-vs-jetoctopus-vs-oncrawl | description | Sitebulb Cloud, JetOctopus, and Oncrawl are the main cloud SEO crawlers. An honest July 2026 comparison of pricing, log analysis, and which one fits your site. (159) | Sitebulb vs JetOctopus vs Oncrawl: the cloud SEO crawlers compared on pricing, log-file analysis and scale, and which one fits your site. (137) | 153 impressions, 0 clicks, position 22.14 |
| /blog/cloudflare-ai-crawler-defaults-september-15 | description | From September 15, 2026, Cloudflare blocks Training and Agent crawlers by default on ad pages. What changes, who's affected, and how to check your site. (152) | Cloudflare blocks AI training and agent crawlers by default from September 15, 2026 on ad pages. Who is affected and how to check your own site's settings. (155) | 123 impressions, 0 clicks, position 9.27 |
<!-- ruled-table:end -->
<!-- prettier-ignore-end -->

**For the owner, four weeks after launch:** add each changed page's clicks, impressions, CTR and position
for the four weeks after the deploy beside its "before" line above, from the same Search Console report.

**D8 — No AI-cliché wording on public pages.** The phrases are `apps/web/lib/seo/banned-phrases.ts`, each a
case-insensitive pattern with its reason; `lib/seo/banned-phrases.test.ts` gives each a sentence it catches,
and the four narrowed ones (`leverage` as a verb, `robust` in prose, "best … tool" said of ourselves,
"100%" as a promise) and the negation rule ("guaranteed", "100%") sentences they must not catch.
`__tests__/seo-banned-phrases.test.tsx` reads every sitemap page of both builds through the D3 walk
(`__tests__/helpers/public-pages.ts`), plus the root layout's metadata and Organization block and
`/llms.txt`, and fails on a match not in `lib/seo/banned-phrase-exceptions.ts` or on an exception that
no longer fires; its header says what it cannot see. On this tree it finds no match in either build, so
the exception list is empty. "high-leverage" and "highest-leverage" (`free-internal-link-audit`,
`how-deep-is-too-deep-crawl-depth`) are the noun, not the verb, and are not changed.

The cloudflare post's "roughly one in three" figure is not in the repository's data, so the sentence
names no number now. Each such edit is data in `apps/web/lib/blog/copy-edits.ts`, reversed by the
existing-post guard like D5's; `__tests__/blog-copy-edits.test.ts` checks each and that the table
below is `copyEditsMarkdown()`'s output.

<!-- prettier-ignore-start -->
<!-- d8-table:start -->
3 sentences changed (D8 and the unsourced figure):

| Where | Reason | Before | After | Why |
| --- | --- | --- | --- | --- |
| `apps/web/lib/blog/content/cloudflare-ai-crawler-defaults-september-15.tsx:158` | unsourced-figure | This isn’t a rare setup. Across the sites audited on Crawlmouse, roughly one in three sits behind a detected edge or CDN layer whose rules can override whatever robots.txt declares. | This isn’t a rare setup: many sites sit behind an edge or CDN layer whose rules can override whatever robots.txt declares. | The repository holds no count behind it, and none can be made here without querying production: `audits.ai_readiness` records `accessMatrix.wafDetected` per audit, which counts recent audits (free audits expire after 30 days), not distinct sites. Owner: a measured number can replace "many". |
| `apps/web/lib/blog/content/how-deep-is-too-deep-crawl-depth.tsx:145` | banned-phrase | the cheapest, highest-leverage fix you have. | the cheapest, highest-impact fix you have. | Ruling 2 named this "leverage" for the plainest word that keeps the meaning. |
| `apps/web/lib/blog/content/free-internal-link-audit.tsx:107` | banned-phrase | <strong>Fix the cheap, high-leverage problems first.</strong> | <strong>Fix the cheap, high-impact problems first.</strong> | Ruling 2 named this "leverage" for the plainest word that keeps the meaning. |
<!-- d8-table:end -->
<!-- prettier-ignore-end -->

## Questions and smaller options taken

Q1–Q8 in the step's notes (`questions.md`): the pinned-guard rewrite (Q1), attributed queries (Q2), the
$69 card (Q3), pages outside this step's paths reported as exceptions (Q4), author box only where an
author is set (Q5), existing Quick answers and FAQs kept (Q6), one inline source (Q7), the CTA heading kept (Q8).
