# POC-1 — Can we honestly say "crawler X is blocked on your site"? A live test, 25 Oct 2026

## Why this test existed

Everything the product sells starts with a line like "GPTBot is refused on every page." Our crawler sends GPTBot's user-agent string from an ordinary cloud IP; the real GPTBot comes from OpenAI's published IP ranges and, on Cloudflare, is a *verified bot*. If sites treat those two differently, our headline verdict could be wrong in both directions. No document could settle this, so we ran it.

## Method

A throwaway Supabase Edge Function (`ua-probe`, project ezspnfeyzwsisymytssm — delete it when done) fetched `https://{site}/` from Supabase's cloud egress with eight user-agent strings — plain Chrome (control), Googlebot, Bingbot, GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, and an identified `Crawlmouse/2.0` — plus `robots.txt`, recording status, `server`, `cf-ray`, `cf-mitigated`, body size, word count and challenge-page markers. Two sets of 48 sites: (A) large consumer/media/platform sites with enterprise bot management; (B) the sites our buyers actually run or resemble — Shopify stores, agencies, SEO vendors, WordPress/Webflow/Squarespace properties, SaaS marketing sites, local Indiana organisations. 768 live fetches. Raw tables are at the end.

## Results

| | Set A: large sites (48) | Set B: our market (48) |
|---|---|---|
| Control (Chrome UA) itself challenged or blocked → per-crawler access **not testable from outside** | **21 (44%)** — DataDome, Cloudflare managed challenge, Akamai, PerimeterX, CloudFront WAF | **4 (8%)** — godaddy, bluehost, convertkit, one DNS failure |
| Control fine, one or more AI crawler UAs refused → a **real, UA-keyed rule we can report** | 8 — cnn (HTTP 451 to AI bots), guardian/verge (403 ClaudeBot + PerplexityBot), linkedin (999 GPTBot), crunchbase (429), nike, wikipedia | 2 — neilpatel.com (403 to all four AI UAs), css-tricks.com (403 to all four) |
| Control fine, no UA rule, but robots.txt disallows AI crawlers → **paper block** | 4 — bbc, amazon, techcrunch, wired | 0 |
| Everything allowed | 15 | 42 (88%) |
| Googlebot/Bingbot *spoof* refused while Chrome passes (site verifies by IP) | 5 — wikipedia, cnn, notion, nike, walmart | 1 — neilpatel |

Three things the numbers prove:

1. **In our market the test works.** 88% of the sites our customers run returned the same page to every UA; the two that discriminate did so with a clean 403 keyed on the AI user-agent string — exactly the finding we sell, and exactly what Cloudflare's "block AI bots" / WAF managed rules produce (they key on the declared UA, not the IP, so our fetch sees what the real bot sees).
2. **On enterprise-protected sites the test is often impossible from outside, and we must say so.** When the plain-browser control is challenged, a 403 to "GPTBot" tells us nothing about GPTBot; it tells us the site challenges datacenter traffic. Reporting that as "blocked" would be false. Set A shows this is nearly half of large sites. Our buyers rarely run those sites, but agencies audit prospects who might.
3. **We can never assert "Googlebot blocked" from a spoofed fetch.** Sites that verify Googlebot by reverse DNS correctly refuse our impersonation (wikipedia, notion, nike, cnn). A fake Googlebot being refused is the site behaving well. The pages currently show "Googlebot ● full 100%" from a live fetch; that column must come from robots.txt plus the control fetch, with the explicit note that verified-bot access is not testable from outside (and, when Search Console is connected, from Google's own crawl stats).

Two more observations worth designing for: differential rules cut both ways (bluehost challenged Chrome but served all four AI UAs; Vercel-hosted bombas returned 429 to Chrome and Googlebot but 200 to GPTBot and OAI-SearchBot — platform rules now *favour* declared AI crawlers), and the identified `Crawlmouse/2.0` UA was treated like Chrome everywhere except crunchbase (429), so it is a sound politeness UA for the discovery crawl.

## Decisions this forces (adopted)

- **Every check runs a control fetch** (Chrome UA and the identified Crawlmouse UA) before any crawler UA, per page sampled. The verdict vocabulary is: `allowed` · `allowed_thin` (200 but <30% of the control's words) · `disallowed_by_robots` · `blocked_by_ua_rule` (control 200, this UA 4xx/451/999) · `rate_limited` (429) · `edge_blocks_automation` (control itself challenged — reported once for the site, never attributed to a crawler, never scored) · `not_measured`. "Blocked" in the UI maps only to `disallowed_by_robots` and `blocked_by_ua_rule`.
- **Googlebot and Bingbot rows are robots.txt + control**, labelled "server response to verified Googlebot is not testable from outside; robots.txt allows / disallows; Search Console confirms" — never a live-fetch verdict.
- **Challenge detection uses headers first** (`cf-mitigated`, Cloudflare 1020/1015/1010 bodies, DataDome/Akamai/PerimeterX signatures), then status + low word count; body-string matching alone produced false positives in this test (allbirds' "captcha" string on a normal page).
- **The Signals page's "Web Bot Auth" row is accurate and now matters more**: it is the route by which a *signed* Crawlmouse fetch could one day be verified by Cloudflare, which would turn `edge_blocks_automation` sites testable. Held for the OG phase.
- **The Crawler-access segment page and FACTS get a new sample state**: one site in the sample set must show `edge_blocks_automation` so the copy for that case is designed, not improvised. Added to the design backlog as a page state, not a new page.
- **Scoring**: `edge_blocks_automation` and `not_measured` carry no points either way; the access component is computed over measured crawlers only and says "3 of 4 measured".

## Raw data

### Set A (large sites) — columns: site | robots.txt status | robots per token (go/bi/gp/oa/cl/pe/cr = al allow · pa partial · di disallow-all · no none) | server | CF | chrome | googlebot | bingbot | gptbot | oai-search | claudebot | perplexity | crawlmouse (status[/cf:mitigated|/chl]:words)

```
allbirds.com | 200 | go=pa bi=pa gp=pa oa=pa cl=pa pe=pa cr=pa | cloudflare | CF | 200:15041 | 200:15041 | 200:15041 | 200:15041 | 200:15041 | 200:15041 | 200:15041 | 200:15041
gymshark.com | 200 | all pa | cloudflare | CF | 200:1 (JS shell) ×8
bombas.com | 429 |  | Vercel |  | 429:27 | 429:27 | 429:27 | 200:1603 | 200:1146 | 429:27 | 429:27 | 429:27
nytimes.com | 200 | go=pa bi=pa gp=di oa=di cl=di pe=di cr=pa | DataDome |  | 403 ×8
reddit.com | 200 | all di | snooserv |  | 403 ×7, 429 claudebot
medium.com | 200 | gp=di cl=di others pa | cloudflare | CF | 403 cf:challenge ×8
quora.com | 200 | bi/gp/oa/cl/pe/cr=di | cloudflare | CF | 403 cf:challenge ×8
stackoverflow.com | 403 |  | cloudflare | CF | 403 cf:challenge ×8
github.com | 200 | all pa | github.com |  | 200:1148 ×8
en.wikipedia.org | 200 | all pa | mw-web |  | 200:2069 | 403:10 | 403:10 | 200:2069 | 200:2069 | 403:9 | 200:2069 | 200:2069
bbc.com | 200 | gp/oa/cl/pe=di | BBC-GTM |  | 200:2824 ×8
cnn.com | 200 | gp/oa/cl/pe=di |  |  | 200:1442 | 403:15 | 403:15 | 451:5 | 200:1442 | 451:5 | 451:5 | 200:1442
theguardian.com | 200 | cl/pe=di |  |  | 200:3260 ×5 | 403:69 claudebot | 403:69 perplexity | 200:3260
amazon.com | 200 | gp/oa/cl/pe=di | Server |  | 200 ×8 (522–763 words)
shopify.com | 200 | all pa | cloudflare | CF | 200:1138 ×8
cloudflare.com | 200 | all al | cloudflare | CF | 200:1249 ×8
substack.com | 200 | all pa | cloudflare | CF | 200:381 ×8
notion.so | 200 | all pa | cloudflare | CF | 200:436 | 403:127 | 403:127 | 200:436 ×5
linkedin.com | 200 | none | cloudflare | CF | 200:760 | 200:737 | 200:737 | 999:42 gptbot | 200:737 ×4
yelp.com | 200 |  | DataDome |  | 403 ×8
tripadvisor.com | 200 | gp/cl=di | DataDome |  | 403 ×7, 200:899 oai-search
indeed.com | 200 | all pa | cloudflare | CF | 403 cf:challenge ×7, 200:1294 perplexity
glassdoor.com | 200 | gp/cl=di | cloudflare | CF | 403 cf:challenge ×8
zillow.com | 200 | all pa | CloudFront |  | 403 ×7, 200:1278 crawlmouse
crunchbase.com | 200 | gp/cl=di oa/pe=al | cloudflare | CF | 200:1051 ×5 | 429 claudebot | 429 perplexity | 429 crawlmouse
g2.com | 200 | all pa | cloudflare | CF | 403 ×8
producthunt.com | 403 |  | cloudflare | CF | 403 cf:challenge ×8
hubspot.com | 200 | all pa | cloudflare | CF | 200:2315–2351 ×8
etsy.com | 200 | all pa | DataDome |  | 403 ×6, 429 googlebot/bingbot
ebay.com | 200 | gp/cl/pe=di | AkamaiGHost |  | 403:26 | ERR ×4 | 200:1484 claudebot | ERR | 403:26
walmart.com | 200 | all pa |  |  | 200:154 ×8 (JS shell)
target.com | 200 | all pa |  |  | 200:457 | 200:2670 ×6 | 200:453
nike.com | 200 | all pa | unified-edge-router |  | 200:1366 | 403:16 ×4 | 200:1751 claudebot | 403:16 | 200:1366
apple.com | 200 | all pa | Apple |  | 200:12096 ×8
openai.com | 200 | all pa | cloudflare | CF | 403 cf:challenge ×8
anthropic.com | 200 | all al | cloudflare | CF | 200:349 ×8
perplexity.ai | 200 | all pa | cloudflare | CF | 403 cf:challenge ×8
vercel.com | 200 | all pa | Vercel |  | 200:546 ×8
webflow.com | 0 |  |  | CF | 200:2803 ×8
wordpress.org | 200 | gp/cl/pe=al | nginx |  | 200:539 ×8
techcrunch.com | 200 | gp/cl=di | cloudflare | CF | 200:1960 ×8
theverge.com | 200 | cl/pe=di gp=al |  |  | 200:2985 ×5 | 403:1 claudebot | 403:1 perplexity | 200:2985
wired.com | 200 | cl/pe=di | cloudflare | CF | 200:1404 ×8
forbes.com | 200 | gp/cl/pe=di oa=al | DataDome |  | 403 ×7, 200:3232 googlebot
bloomberg.com | 200 | gp/oa/cl/pe=di | Varnish |  | 403:108 ×8
reuters.com | 200 | gp/cl/pe/cr=di | CloudFront |  | 401 ×8
nahltech.com | 200 | all pa | Vercel |  | 200:652 ×8
crawlmouse.com | 200 | bi/gp/oa/cl/pe=al | Vercel |  | 200:630 ×8
```

### Set B (our market)

```
deathwishcoffee.com | 200 | all pa | cloudflare | CF | 200:1696 ×8
beardbrand.com | 200 | all pa | cloudflare | CF | 200:1618 ×8
chubbiesshorts.com | 200 | all pa | cloudflare | CF | 200:1120 ×8
mvmt.com | 200 | all pa | cloudflare | CF | 200:4237 ×8
puravidabracelets.com | 200 | all pa | cloudflare | CF | 200:3463 ×8
brooklinen.com | 200 | all pa | cloudflare | CF | 200:692 ×8
ruggable.com | 200 | all pa | cloudflare | CF | 200:643 ×8
kyliecosmetics.com | 200 | all pa | cloudflare | CF | 200:898 ×8
backlinko.com | 200 | go=al others pa | Netlify |  | 200:1687 ×8
neilpatel.com | 200 | all pa | cloudflare | CF | 200:6645 | 403 cf:challenge ×6 (all bot UAs) | 200:6645 crawlmouse
webfx.com | 200 | all pa | cloudflare | CF | 200:2166 ×8
ahrefs.com | 200 | all pa | cloudflare | CF | 200:1993 ×8
semrush.com | 200 | all pa | nginx |  | 200:1312 ×8
screamingfrog.co.uk | 200 | all pa | cloudflare | CF | 200:1517 ×8
sitebulb.com | 200 | all pa | cloudflare | CF | 200:1113 ×8
moz.com | 200 | all pa | cloudflare | CF | 200:2654 ×8
yoast.com | 200 | all pa | cloudflare | CF | 200:1534 ×8
elementor.com | 200 | all al | cloudflare | CF | 200:2609 ×8
wpbeginner.com | 200 | all pa | cloudflare | CF | 200:2610 ×8
smashingmagazine.com | 200 | all pa | Netlify |  | 200:1449 ×8
css-tricks.com | 200 | all al | cloudflare | CF | 200:981 ×3 | 403:5 ×4 (AI UAs) | 200:981
dev.to | 200 | all pa | Heroku |  | 200:1646 ×8
hashnode.com | 200 | all pa | Vercel |  | 200:2050 ×8
ghost.org | 200 | all pa | Netlify |  | 200:921 ×8
squarespace.com | 200 | all pa | Squarespace |  | 200:3979 ×8
wix.com | 200 | all pa | Pepyaka |  | 200:2890 ×8
godaddy.com | 403 |  | AkamaiGHost |  | 403:16 ×5 | 200:2571 claudebot | 403 ×2
bluehost.com | 403 |  | cloudflare | CF | 403 cf:challenge ×3 (chrome, googlebot, bingbot) | 200:4076 ×4 (AI UAs) | 403 crawlmouse
kinsta.com | 200 | all pa | cloudflare | CF | 200:1475 ×8
wpengine.com | 200 | all pa | cloudflare | CF | 200:1050 ×8
netlify.com | 200 | all al | Netlify |  | 200:1578 ×8
render.com | 200 | all pa | cloudflare | CF | 200:751 ×8
basecamp.com | 200 | all pa | cloudflare | CF | 200:2455 ×8
37signals.com | 404 |  | cloudflare | CF | 200:181 ×8
buffer.com | 200 | all pa | cloudflare | CF | 200:1289 ×8
zapier.com | 200 | gp/oa/cl/pe=al | Vercel |  | 200:1826 ×8
calendly.com | 200 | all pa | cloudflare | CF | 200:1602 ×8
typeform.com | 200 | all pa | cloudflare | CF | 200:1046 ×8
mailchimp.com | 200 | all al | istio-envoy |  | 200:2824 ×8
convertkit.com | 200 | all pa | cloudflare | CF | 403 cf:challenge ×7 | 200:2548 googlebot
indyhub.org | 200 | all pa | cloudflare | CF | 200:594 ×8
visitindy.com | 200 | all pa | nginx-rc |  | 200:2264 ×8
iuhealth.org | 0 |  |  |  | ERR ×7 (IPv6 egress failure) | 200:351 claudebot
purdue.edu | 200 | all pa |  |  | 200:239 | 200:208 ×2 | 200:843 ×4 | ERR
eskenazihealth.edu | 200 | all pa | IIS/10.0 |  | 200:2219 ×8
indianapolismotorspeedway.com | 404 |  |  |  | 200:2890 ×8
pacers.com | 404 |  |  |  | 200:153 | ERR ×4 | 200:153 | ERR | 200:153
colts.com | 200 | all pa | istio-envoy |  | 200:2403 ×8
```

Probe source: /home/claude/plan/poc/ua-probe.ts and ua-probe-smb.ts.

## Addendum, 25 Oct 23:10 — tagged user-agent strings and the search-vs-training split (16 sites × 15 UAs)

Re-run on the 16 sites that discriminated in the first pass, sending each crawler string twice: exact, and tagged with ` Crawlmouse/2.0 (+https://crawlmouse.com/bot)` plus a `From: bot@crawlmouse.com` header; plus two search-side agents not in the first run (ChatGPT-User, Claude-SearchBot).

**Result 1 — tagging changes nothing.** On all 16 sites every tagged/exact pair returned the identical status and word count (neilpatel 403/cf both, css-tricks 403 both, cnn 451 both, guardian/verge 403 both, crunchbase 429 both, nike/linkedin/bluehost/convertkit/wikipedia/notion identical). Decision D1 (tagged strings by default) is now measured: the under-reporting risk from tagging is confined to exact-match rules, which none of these sites use.

**Result 2 — sites already distinguish training crawlers from search agents.** cnn.com: 451 to GPTBot, ChatGPT-User, ClaudeBot, PerplexityBot; 200 to OAI-SearchBot and Claude-SearchBot. en.wikipedia.org: 403 to ClaudeBot, 200 to Claude-SearchBot. nike.com: 200 to ClaudeBot and Claude-SearchBot, 403 to the OpenAI and Perplexity agents. This supports the engine review's point: a grade called "AI readability — what AI search can read" must score the search/answer agents (OAI-SearchBot, ChatGPT-User, Claude-SearchBot, PerplexityBot) and show the training crawlers (GPTBot, ClaudeBot) unscored, because blocking training is a legitimate owner choice the grade should not punish. Adopted as decision B8-revised.

```
site | chrome | googlebot | gpt | gpt_tag | oai | oai_tag | chatgpt-user | cgu_tag | claudebot | cb_tag | claude-search | cs_tag | pplx | pplx_tag
neilpatel.com | 200:6645 | 403/cf | 403/cf | 403/cf | 403/cf | 403/cf | 403/cf | 403/cf | 403/cf | 403/cf | 403/cf | 403/cf | 403/cf | 403/cf
css-tricks.com | 200:981 | 200 | 403 | 403 | 403 | 403 | 403 | 403 | 403 | 403 | 403 | 403 | 403 | 403
cnn.com | 200:1453 | 403 | 451 | 451 | 200 | 200 | 451 | 451 | 451 | 451 | 200 | 200 | 451 | 451
theguardian.com | 200:3249 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 403 | 403 | 403 | 403 | 403 | 403
theverge.com | 200:2985 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 403 | 403 | 403 | 403 | 403 | 403
crunchbase.com | 200:1051 | 200 | 200 | 200 | 429 | 429 | 429 | 429 | 429 | 429 | 429 | 429 | 429 | 429
nike.com | 200:1366 | 403 | 403 | 403 | 403 | 403 | 403 | 403 | 200 | 200 | 200 | 200 | 403 | 403
linkedin.com | 200:760 | 200 | 999 | 999 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200
bluehost.com | 403/cf | 403/cf | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200
convertkit.com | 200:2548 | 200 | 403/cf | 403/cf | 403/cf | 403/cf | 403/cf | 403/cf | 403/cf | 403/cf | 403/cf | 403/cf | 403/cf | 403/cf
en.wikipedia.org | 200:2069 | 403 | 200 | 200 | 200 | 200 | 200 | 200 | 403 | 403 | 200 | 200 | 200 | 200
notion.so | 200:436 | 403 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200
bbc.com, techcrunch.com, wired.com | 200 everywhere (robots-only blocks)
amazon.com | 200 everywhere (515–854 words; UA-dependent markup)
```
