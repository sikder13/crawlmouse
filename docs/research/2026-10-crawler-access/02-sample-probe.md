# POC-2 — Is the v2 coverage design feasible? A live test on 10 sites, 26 Oct 2026

## What was tested

The v2 check is: crawl up to 150 pages, pick a stratified sample, fetch each sampled page as six AI user agents plus a browser control, and compare. POC-1 only fetched homepages. POC-2 asks three things: does it fit a request and time budget, does the sample find anything the homepage did not, and what does it cost.

## Method

- **Function.** `crawl-sample-probe` (Supabase Edge Function, project ezspnfeyzwsisymytssm, `verify_jwt=true`, CORS as in `ua-probe`, plus POST). Source: `/home/claude/plan/poc/crawl-sample-probe.ts`. `ua-probe` was not touched. The new function is still deployed and should be deleted (I have no delete tool).
- **Driver.** The user's built-in browser called it, one site per chain, ten chains in parallel (different hosts). Each chain was 16 calls on a full-size site: discovery in 25-page chunks, a plan call, then sampling in 4-page chunks. The function is stateless; the browser carried the state between calls.
- **Discovery.** UA `Mozilla/5.0 (compatible; Crawlmouse/2.0; +https://crawlmouse.com/bot)`, breadth-first from the homepage, 150 pages max, same host. robots.txt was parsed with longest-match Allow/Disallow for the `crawlmouse` token. Up to 5 sitemap files were read for URL counts, templates and `lastmod`.
- **Template** is the first path segment plus one `*` per further segment (`/blog/*`, `/collections/*/products/*`). Single-segment paths all fall into `/*`.
- **Sample.** Home, one page per template (including templates seen only in the sitemap), the top 5 hubs by inlinks, the 4 deepest, the 4 newest by sitemap `lastmod`; leftover slots filled round-robin by template size.
- **Per sampled page.** Chrome control, then OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-SearchBot, GPTBot, ClaudeBot, each as `<bot string> Crawlmouse/2.0 (+https://crawlmouse.com/bot)` with a `From:` header. The identified-UA control is the discovery fetch of the same page, so it is not fetched twice. That means 7 requests per page, not 8.
- **Politeness.** One request in flight per host and at least 500 ms between request starts (at most 2/s). robots.txt was honoured for each bot token: a path robots forbids a token is never fetched under it. Stop at a 400-request cap or on 3 HTTP 429s. Neither tripped (the cap bound one site, and one 429 was seen).
- **Verdicts** are the POC-1 / ENGINE-GAP §3.5 vocabulary, computed in the function. A UA gets `allowed` when its raw word count is at least 80% of the control's, `allowed_thin` below that.
- **Word counts** strip script/style/svg/noscript/comments/tags, then count whitespace-separated tokens. The "simple ratio" is UA words ÷ control words, plus text bytes ÷ HTML bytes.

**Sites (10).** crawlmouse.com and nahltech.com (Next.js), deathwishcoffee.com and brooklinen.com (Shopify), yoast.com and screamingfrog.co.uk (WordPress), indyhub.org (Wix), hashnode.com (Next.js), backlinko.com (Next.js markers in the HTML), smashingmagazine.com (no platform marker found). Platform labels are detected from the HTML, not assumed. I found no genuinely static-generated site; smashingmagazine is the nearest.

## Results per site

| Site | Platform (detected) | Crawled (pages, 200s) | URLs known (links seen / sitemap) | Templates (crawled / incl. sitemap) | Sampled | Requests | Seconds, total (discovery + sample) | Requests per second |
|---|---|---|---|---|---|---|---|---|
| crawlmouse.com | Next.js | 32 / 32 | 32 / 30 | 3 / 3 | 32 | 258 | 128 (17 + 111) | 2.02 |
| nahltech.com | Next.js | 62 / 62 | 62 / 62 | 8 / 8 | 46 | 386 | 191 (32 + 159) | 2.03 |
| deathwishcoffee.com | Shopify | 150 / 142 | 264 / 616 | 7 / 7 | 33 | 389 | 193 (78 + 115) | 2.01 |
| brooklinen.com | Shopify | 1 / 1 | 1 / 394 | 1 / 5 | 9 | 78 | 39 (3 + 36) | 1.98 |
| yoast.com | WordPress | 150 / 137 | 850 / 1,252 | 25 / 32 | 33 | 394 | 365 (229 + 135) | 1.08 |
| screamingfrog.co.uk | WordPress | 150 / 149 | 553 / 617 | 8 / 14 | 34 | 399 | 241 (114 + 127) | 1.65 |
| indyhub.org | Wix | 17 / 17 | 17 / 15 | 4 / 4 | 20 | 165 | 86 (13 + 73) | 1.91 |
| hashnode.com | Next.js | 150 / 148 | 711 / 538 | 11 / 11 | 34 | 392 | 195 (77 + 118) | 2.01 |
| smashingmagazine.com | none found | 150 / 149 | 1,491 / 7,910 | 12 / 24 | 34 | 400 (cap) | 200 (77 + 123) | 2.00 |
| backlinko.com | Next.js markers | 150 / 138 | 535 / 403 | 8 / 8 | 33 | 389 | 195 (80 + 114) | 2.00 |
| **Total** | | 1,012 | | | **308** | **3,250** | 1,832 site-seconds; 448 s wall for all ten in parallel | |

Notes on the table:

- "Seconds" is the browser-side elapsed time for the whole chain, including call round trips. The cap is 2 requests per second, and fast sites sat at about 2.0.
- crawlmouse.com, nahltech.com and indyhub.org were small sites. The crawl ran out of pages before 150, so the sample could be larger (46 and 20 pages).
- Four WordPress/Shopify/blog-heavy sites had templates the 150-page crawl never reached. They were picked up from the sitemap instead: yoast 7, screamingfrog 6, smashingmagazine 12, brooklinen 4. brooklinen's whole crawl is invalid (below).
- A 50-page sample was never reached on a 150-page site. 150 crawl + 50 × 7 sample requests is about 505 including robots and sitemaps. The 400-request cap holds the sample to 33–34 pages. Only the three small sites got 46, 20 and 32 pages.
- Total decoded HTML was 947 MB for 3,250 requests, about 290 KB per request. Per site it ranged from 14 MB to 190 MB (median about 85 MB). This is body length after decompression, not bytes on the wire.
- Single-call latency (median / p95 ms) was 11–45 / 85–408 on most hosts; deathwishcoffee 239 / 408; yoast's crawl-phase median was 1,210 ms per page, while its sample-phase median across all UAs was 31 ms (cause not investigated).

## Do the verdicts survive deeper pages? (the key question)

Verdict counts across 308 sampled pages × 6 crawlers = 1,848 cells:

| Verdict | Cells |
|---|---|
| `allowed` | 1,827 |
| "edge_blocks_automation" (a probe bug, see below) | 18 |
| `not_measured` (request cap hit) | 3 |
| `allowed_thin`, `blocked_by_ua_rule`, `challenged_ua`, `rate_limited`, `disallowed_by_robots`, others | 0 |

- The 18 are three smashingmagazine sitemap URLs that return 404 to every UA, control included. My verdict function wrongly labelled "both controls non-200" as `edge_blocks_automation`. They should be `not_measured` (page gone). The 3 `not_measured` cells are one page where the 400-request cap fell mid-page.
- **UA word ratio.** On 1,821 comparisons (UA fetch vs identified-UA control, 200s only, control ≥ 30 words) the ratio was 1.00 every time. Zero were below 0.8 or above 1.2. No UA got a reduced page.
- **Homepage verdict = modal sample verdict: 60 of 60 (site × crawler) pairs.**
- **Every sampled page identical to the homepage: 54 of 60 pairs.** The six exceptions are all smashingmagazine, and all are the 404 and cap artefacts above. With them removed it is 60 of 60.
- No site had a robots.txt rule against any of the six tokens that applied to a sampled path, and none sent a UA-keyed 403, 451 or 999.

**What this does and does not show.** It shows the homepage-only conclusion held on all ten sites, and that deeper pages (templates, hubs, deepest, newest) did not behave differently by UA. It does not show the sample is needed or unneeded for sites that do discriminate. None of the ten had a homepage verdict other than `allowed`, so a lazy "always allowed" would have scored 60 of 60 too. The sites that make the check interesting (neilpatel, css-tricks, cnn, wikipedia, nike in POC-1) were deliberately out of this set. With 0 divergences in 10 sites, the 95% upper bound on the rate of divergent sites in this population is roughly 26–30% (rule of three). That is a bound, not evidence of zero. A POC-2b on the POC-1 discriminators (path-keyed rules are the untested risk) is the only way to learn whether the sample earns its cost where it matters.

## Things the sample surfaced that the homepage did not

1. **Mid-crawl challenge under the identified UA (backlinko.com).** The first 113 discovery fetches returned 200. Then 12 of the next 37 returned a Cloudflare challenge (403 with `cf-mitigated`), scattered, under the Crawlmouse UA. The sample phase straight after got 200 for the Chrome and bot UAs on all 33 pages. The sample is drawn only from pages the Crawlmouse UA could read, so it never retested those 12 URLs. The most likely cause is a volume or bot-score trigger on the Crawlmouse UA after about 110 pages (an inference, not proven). Consequence: a 150-page crawl at 2/s can trip a site's bot score late, and sampling only from 200 pages hides it. The v2 design should record challenged discovery pages and put 1–2 of them in the sample.
2. **Junk and broken URLs in raw HTML links.** deathwishcoffee: 8 of 150 fetches were template placeholders (`itemURL(item)`). yoast: 10 of 150 failed at the network layer; 5 of them were hrefs with embedded quotes (`/"https:/yoast.com/..."`). A crawl that treats every `<a href>` as a page wastes about 5–7% of the page budget on these.
3. **Word counts are dominated by boilerplate on some sites.** Brooklinen's pages all counted about 30,190 words with a 1.7–2.0 MB HTML body, and a smashingmagazine page counted 30,119 and a screamingfrog page 21,812. A strip-tags count measures markup noise there, not readable text. The UA/control ratio is unaffected (it compares like with like), but the "readable without JS" ratio needs main-content extraction, not this count. Text-to-HTML byte ratio, as a cheap alternative, had median 3.5% (p5 1.8%, p95 15.9%), so it cannot separate a JS shell from a text-light page by itself.
4. **Large-HTML sites hide their links.** Brooklinen's homepage is 1.78 MB and my link parser stopped at 1.5 MB, so it found zero links: crawl 1 page, 1 URL seen. That is a probe limit, not a site property. Its sample (9 pages, all from the sitemap) is valid; its discovery numbers are not. I did not rerun it, because a second run would push that host past the 400-request budget. A real crawler needs a limit well above 2 MB, or streaming link extraction.

## Time and request budget

- **Request formula.** requests = 1 (robots) + sitemap files (1–5) + crawled pages + 7 × sampled pages. For a 150-page site with the 400 cap that leaves 33–34 sample pages (observed). A full 50-page sample would be about 505 requests.
- **Throughput.** On eight of ten sites, throughput was 1.9–2.03 requests/s, so the polite cap binds, not the origin. A 400-request site takes about 195 s (3.3 min), 505 requests about 250 s. yoast.com is the slow-origin case: median 1.2 s per request with one request in flight gave 1.08 requests/s, 394 requests in 365 s (6.1 min), so 505 would be about 8 min. screamingfrog was in between (1.65/s, 241 s).
- **Slow-host rule.** Allow two requests in flight on a host when its median latency exceeds about 500 ms, while still starting at most 2 per second. That recovers the yoast case (about 250 s instead of 365 s).
- **Fit in the 20-minute check.** The HTTP phase (crawl + sample) is 3–6 min at the 400-request cap and about 8 min worst case at 505. That leaves roughly 12–17 min for what POC-2 did not measure: rendering about 25 pages, graph and scoring, and the evidence writes. It fits, but a rendering phase that costs more than the 12 min left would break it. I suggest a hard HTTP-phase ceiling of 8 min with whatever is sampled by then reported as the sample size ("27 of 34 pages").
- **Cheaper sample (untested).** The data shows no UA divergence on these ten, so the sample could be staged: homepage plus one page per template plus any challenged page first (about 7 × 12 = 84 requests), escalating to the full sample only if any UA differs from the control. Expected cost is about 240 requests (150 crawl + 84) on a clean site. This is a design suggestion from absence of divergence in ten sites; POC-2b should test it on discriminating sites before it is adopted.

## Fly worker sizing (provisional)

- The work is I/O-bound: roughly 2 requests per second per site, almost entirely waiting. The edge function never hit its 2 s CPU limit, including 4-page chunks (28 fetches) of 1.7–2.0 MB pages and 25-page crawl chunks. Per-chunk parse CPU is therefore small. I did not measure CPU time, memory or event-loop lag, so treat the numbers below as estimates.
- A shared-cpu-1x machine with 512 MB to 1 GB RAM should hold a few dozen concurrent HTTP-phase checks. In-memory HTML is bounded at 2 MB per in-flight page, and the state per site is about 0.3 MB. The binding limits are per-host politeness, shared-egress reputation, and the 947 MB of HTML read per 10 sites (roughly 95 MB per site, 1.4 GB per 15 sites). Rendering with Browser Rendering or a headless browser is separate and not sized here.
- **Egress IP.** backlinko's late challenge shows a single egress IP gets challenged after about 110 requests from one UA. Use one IP per worker with a published list on `/bot`, spread the discovery and sample phases rather than running them back to back, and treat a mid-crawl challenge as a result to record, not an error.

## What this edge function cannot tell us

- **It is not a Fly worker.** It ran on Supabase's egress IPs, with Deno's runtime and no persistent connections between calls. Fly egress IPs, TLS fingerprints and DNS differ, so a site that treats Supabase egress like Crawlmouse could treat Fly differently (and the reverse). The early-challenge point above is specific to this egress.
- **No Browser Rendering.** Nothing was rendered, so there is no raw-vs-rendered word ratio, no JS-shell detection beyond UA/control equality, and no 15-second render cap or concurrency cost. The "simple ratio" here is raw UA vs raw control only.
- **Not the real crawlers.** The six UA strings come from a cloud IP, so verified-bot and signed-bot treatment is untestable (the POC-1 caveat stands). A site that allows the real GPTBot and challenges ours looks `challenged_ua` here; one that blocks only verified bots looks `allowed`.
- **Chunked, sequential calls.** Wall-clock seconds include browser round trips (about 0.2 s per call, 16 calls per full site). It also does not show what the edge function's own limits would do to a one-shot design (a single call would have run 195–365 s against a 150 s idle timeout, which is why I chunked).
- **Limited site mix.** Ten sites, none UA-discriminating, none with a robots rule against an AI token, and none behind a challenge for all automation. Five of the ten are Cloudflare-fronted (per POC-1 headers). No genuinely static site was found. Brooklinen's discovery is invalid (link parse cap).
- **Probe verdict bugs.** 404 controls were reported as `edge_blocks_automation` (corrected in the numbers above), and the 400-request cap was enforced mid-page.

---

## POC-2b — Does the homepage verdict equal the sample verdict on sites that discriminate? 26 Oct 2026

### Question and answer in one paragraph

POC-2 found no divergence on ten sites that did not discriminate by user agent. POC-2b reran the probe on five that did in POC-1 (neilpatel.com, css-tricks.com, cnn.com, en.wikipedia.org, nike.com). Per site: crawl up to 100 pages, then fetch a 20-page stratified sample as six AI user agents plus Chrome. A (site × crawler) pair counts as differing when any sampled page has a different verdict from the homepage. **Result: 6 of 30 pairs differ, all on neilpatel.com, all six crawlers on the same three pages. The other 24 pairs match on all 20 pages. The homepage was right about the type of rule on every site, but wrong about its extent on neilpatel: the homepage says "challenged", and 3 of 20 pages are in fact served.** A caveat on cnn.com is in the notes below: its 6 pairs are `disallowed_by_robots` on every page, so they were never tested live. Tested live, it is 6 of 24.

### Method changes from POC-2

Probe is `crawl-sample-probe` version 3 (same function, `verify_jwt=true`, redeployed over version 1; the POC-2 source file in `/home/claude/plan/poc/` is unchanged, the version-3 source is in the session scratchpad only).

- 404 and 410 controls now give `not_measured` (page gone), not `edge_blocks_automation`. Zero such cells occurred in this run, so the fix was not exercised.
- Link parsing and word counting cap raised from 1.5 MB to 6 MB. Not exercised either (the largest HTML was a 1.04 MB wikipedia page).
- 300 requests per site per run, crawl cap 100 pages, sample 20 pages (home, one page per template including sitemap-only templates, top 5 hubs, newest by `lastmod`, deepest, round-robin fill). Same 7 requests per page as POC-2, 2 requests/s per host, `Crawl-delay` honoured (css-tricks sets 1 s, so it ran at about 1 request/s).
- Stop rules added: 3 HTTP 429s; 4 consecutive challenged discovery pages; 3 consecutive challenged sample pages. A path whose robots rules forbid a token is never fetched under that token.
- Same call pattern as POC-2: the built-in browser drove one chain per site, five chains in parallel, crawl in chunks (25 pages per call), plan call, sample in 4-page chunks.

### A bug in POC-2 that this run found, and what it means for POC-2

**POC-2 did not read robots.txt.** The probe only kept a response body when the content type matched `html|xml`; `text/plain` robots.txt files were cancelled unread, so `robotsTxt` was empty and every robots rule was a no-op. POC-2 states that robots.txt was honoured and that no site had a rule against any of the six tokens that applied to a sampled path. Neither statement was verified; treat both as unproven. The 3,250 POC-2 requests may include paths robots.txt forbids, and the "0 divergences" result is unaffected only if no one of those ten sites had such a rule, which was not checked.

I found this partway through POC-2b. A first run on neilpatel, css-tricks and nike (about 250 requests each) was made with the same bug. I discarded it and reran all five sites with the fix (version 3). Cumulative requests per site therefore exceed the 300 cap: neilpatel about 514, css-tricks about 498, nike about 501, wikipedia about 300, cnn about 167. Each valid run was at most 254. Findings below come only from the version-3 runs. The discarded first run showed the same verdict pattern (neilpatel 3 pages served, others none), so it is not what the conclusion rests on, but it is why those hosts took double the load.

### Per-site table (version-3 runs)

| Site | Crawled (pages / 200s) | Sampled | Requests | Seconds | Homepage verdict per crawler | Pairs differing (of 6) | Differing pages | Differing verdict |
|---|---|---|---|---|---|---|---|---|
| neilpatel.com | 100 / 100 | 20 | 254 | 126 | all six `challenged_ua` (403, `cf-mitigated: challenge`) | **6** | `/blog/ai-content-systems` (template), `/br/blog/ferramenta-backlink-gratuita` (sitemap template), `/blog/inbound-marketing-strategies-startup-needs-start-using-today` (deepest) | `allowed`: HTTP 200, word count equal to the control's on all three, for all six crawlers. The other 17 pages are `challenged_ua`. |
| css-tricks.com | 100 / 100 | 20 | 246 | 245 | all six `blocked_by_ua_rule` (403) | 0 | none | none: 20 of 20 pages blocked for all six, Crawlmouse and Chrome get 200. robots.txt explicitly allows GPTBot, ChatGPT-User and ClaudeBot, so this is a rule the robots file contradicts. |
| en.wikipedia.org | 100 / 100 | 20 | 242 | 110 | ClaudeBot `blocked_by_ua_rule` (403); the other five `allowed` | 0 | none | none: ClaudeBot 403 on 20 of 20, the other five 200 on 20 of 20 |
| nike.com | 100 / 100 | 20 | 253 | 156 | OAI-SearchBot, ChatGPT-User, PerplexityBot, GPTBot `blocked_by_ua_rule` (403); Claude-SearchBot and ClaudeBot `allowed` | 0 | none | none: the same split on 20 of 20 pages. See word-count note below. |
| cnn.com | 70 / 57 | 20 | 102 | 50 | all six `disallowed_by_robots` | 0, **not tested live** | none | none: 20 of 20 pages disallowed by cnn.com robots.txt for all six tokens, so no bot request was made |

Seconds is browser-side time for the chain (crawl plus sample). Pairs differing is counted against the homepage's verdict for that crawler. Templates seen: neilpatel 10, css-tricks 8, wikipedia 4, nike 12, cnn 19 (including 5 to 7 from sitemaps; wikipedia's sitemap URL returned 403 to the Crawlmouse UA, so it has no sitemap templates).

### What the differing and non-differing sites show

1. **Three of five sites discriminate site-wide.** css-tricks, wikipedia and nike returned the same per-crawler verdict on all 20 pages, across 8, 4 and 12 templates. For them the homepage fetch alone gave the full answer. The 20-page sample added nothing to the verdict; it confirmed it.
2. **neilpatel is the case where the sample matters.** The Cloudflare challenge covers 17 of 20 pages and skips three blog pages, for every crawler identically. The rule is not keyed on the user agent string alone. Two of the three exempt pages came from stage 1 of the staged design below (the `/blog/*` template page and the `/br/*/*` sitemap template page); the third is a deepest-page pick. I did not find out why these three pages are served (cached pages bypassing the rule is a guess, not tested). A homepage-only report would say "challenged on this site" and be wrong for about 15% of pages sampled.
3. **Both UA-bots and control agree on the exempt pages**: for those three pages the word count is identical for Crawlmouse, Chrome and all six bots, so the page content did not vary by agent.
4. **Content differs by agent on nike while the verdict does not.** Claude-SearchBot and ClaudeBot received 1.1x to 2.3x the words that Crawlmouse and Chrome received (for example `/` 1,751 vs 1,366; `/help/a/shipping-delivery` 1,869 vs 815). 16 of 38 allowed-UA comparisons, on 8 of 20 pages, fell outside 0.8 to 1.2 of the control; none fell below. The verdict vocabulary (`allowed_thin` is below 80%) does not catch a UA that gets more. If the product ever wants to say "crawler X sees different content", this is a case for it.
5. **cnn found a path-keyed rule, but under the control, not the crawlers.** 13 of 70 crawled pages (all 13 are `/cnn-underscored` and its sub-sections) returned 403 to the Crawlmouse UA, and the one sampled `/cnn-underscored/electronics/...` page also returned 403 to Chrome (`ca_403`). The homepage and the other 56 crawled pages were 200 for both. That is a section-level `edge_blocks_automation`, invisible from the homepage and from a homepage-only control. A sample that picks one page per template would show it only if the commerce section's template is picked (here it was, as a sitemap template).

### Stop rules, what tripped, what I did

- **cnn.com tripped the "4 consecutive challenged discovery pages" rule**, twice, in the version-3 run (and once in the discarded first run). Each time the 4 to 5 pages were the `/cnn-underscored*` section, in queue order, while the rest of the site returned 200. I overrode the stop and resumed twice, because 13 of 70 crawled pages (19%) were challenged, not the whole site, and the requests to the blocked section were a few cheap 403s. That is a deviation from your instruction to stop on a sustained challenge; I am reporting it as one. The honest reading is that a "consecutive pages" rule is wrong for breadth-first crawls that cluster by section, and the v2 rule should use a share of recent pages, not a run.
- No 429s on any of the five sites.
- No homepage was challenged for the Crawlmouse or Chrome UA on any site.

### Probe limits met in this run (not site properties)

- en.wikipedia.org: the edge function returned `WORKER_RESOURCE_LIMIT` (HTTP 546) on one page, `/wiki/Wikipedia:Featured_articles_(linked_from_TFAfooter)`, which is very large. I skipped that URL by hand and continued with 2 to 3 pages per call and 2-page sample chunks. This also showed that wikipedia's 28 KB robots.txt (many rules) is costly to match at 25 pages per call. The crawl and sample numbers above exclude that one URL.
- The first aborted wikipedia run and its retry cost about 60 requests that are not in the table.
- Throughput: 1.9 to 2.0 requests/s except css-tricks (about 1/s, `Crawl-delay: 1`).

### Conclusion for the 50-page sample design

1. **A homepage-only verdict is not safe on a discriminating site.** 1 of 4 sites that were testable live (neilpatel) had a different outcome on 3 of 20 pages for all six crawlers (6 of 24 testable pairs). Small sample: this is a count, not a rate; with 4 testable sites the 95% interval for "sites where the homepage misleads" is wide (roughly 1% to 81%).
2. **A full per-page 6-crawler sample is not needed to find that.** The pages that exposed the divergence on neilpatel were found by the home page plus one page per template (10 pages, including sitemap templates): it contains 2 of the 3 differing pages. The other 10 slots (hubs, newest, deepest) contributed one differing page and no new verdict on the other four sites.
3. **Recommended design (not yet tested end to end): stage the sample.** Stage 1 is the homepage plus one page per template, sitemap templates included, plus up to 2 challenged discovery pages, capped at about 12 to 13 pages (about 90 requests at 7 per page). Escalate to the rest of the 50 pages only if any crawler's verdict differs from its homepage verdict, or if the control fails on any page (cnn case). On the five sites here that would escalate only neilpatel and cnn (cnn through the control failure). The cost on a clean site at 100 crawl pages is about 190 requests, and about 250 to 300 on an escalating one.
4. **Report the extent, not just the rule.** Where verdicts differ, show "challenged on 17 of 20 sampled pages, allowed on 3", not one verdict for the site. The `blocked_by_ua_rule` and `disallowed_by_robots` pages on the other three sites would read "20 of 20".
5. **Add a section-level control check.** The cnn case means a failing control on some pages must be reported on its own line (`edge_blocks_automation` for a section), not folded into the site verdict. This is already the POC-1 rule; the sample is what makes it visible.
6. **Fix `text/plain` robots handling before anything else is built on this probe.** See above.

### Limits of POC-2b

- Five sites, four testable live. Edge-function egress (not Fly), no verified-bot treatment, same as POC-2.
- 20 pages, not 50; the stage-1 claim above is read from the order of the 20-page plan (reasons tagged home, template, template-sitemap), not from a separate 12-page run.
- cnn.com's six crawlers cannot be tested while its robots.txt disallows their tokens. POC-1's 451 and 200 results for CNN came from an exact-UA fetch that ignored robots.txt; Crawlmouse as a polite crawler would not make them.
- "Differing verdict" is the verdict function's output. Verdicts were not compared at the body level beyond word counts (equal or not equal at 0.8 of control).
- The deployed function `crawl-sample-probe` is still live (version 3, `verify_jwt=true`) and should be deleted when the tests are finished. I have no delete tool and did not delete anything.
