# Shared facts for every Crawlmouse v2 screen: PROPOSED regeneration (v2)

Status: proposed 26 Oct 2026. It replaces `context/FACTS.md` once UD approves it; `FACTS.md` is not edited. Authority order for every line below: master plan (`CRAWLMOUSE-V2-MASTER-PLAN-v1.md`), then `docs/DECISION-LOG-v1.md` Part 3 > Part 2 > Part 1, then the reviews. Sources are cited by decision id (I6, K10 and so on).

**ENGINE-DERIVED** means the number cannot be written by hand. It comes from running the engine (ENGINE-GAP, with the ground-truth corpus, I1/I8 and B5 of the log) against the frozen `example-outfitter.com` fixture, and it is regenerated in one pass at CC-19 ("FACTS regeneration"). Where the old value is shown it is shown only so the change is mechanical. Nothing marked ENGINE-DERIVED has been estimated here.

Scored crawlers (I6, which overrides R7's B8 strings): OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-SearchBot. Shown but unscored ("blocking these is your choice"): GPTBot, ClaudeBot. Robots.txt, control and Search Console only, never a live verdict: Googlebot, Bingbot.

Verdict vocabulary (I2), eleven states: `allowed`, `allowed_thin`, `disallowed_by_robots`, `blocked_by_ua_rule`, `challenged_ua`, `refused_unverified`, `rate_limited`, `payment_required`, `edge_blocks_automation`, `redirected_away`, `not_measured`. The word "blocked" is used only for `disallowed_by_robots` and `blocked_by_ua_rule`. `challenged_ua` and `refused_unverified` read "challenged: the real crawler may pass" with the ○ glyph.

---

## Part 1. The facts

Sample site: example-outfitter.com · 214 pages (home 1, collections 42, products 158, blog 13) · 779 internal links · 7 orphan pages · 5 pages reachable only through JavaScript · 4 hubs carry 61% of PageRank · average click depth 2.4 · 38% generic anchors (these are crawl counts of the fixture; the structure counts are unchanged because the discovery crawl still reads all 214 pages; confirm at regeneration).

Audit: 25 Oct 2026, 02:34 UTC · crawl 2 min 11 s (ENGINE-DERIVED: wall time changes with the sample design) · tested at 02:33 UTC · **crawled all 214 pages for structure; tested as 6 AI crawlers on a sample of ENGINE-DERIVED (at most 50) pages across every template = ENGINE-DERIVED responses kept as evidence (6 × 50 = 300 at the full sample)** (was "6 crawlers × 214 pages = 1,284 responses", I1) · visible for 24 hours (until 26 Oct 2026, 02:34 UTC), purged at 30 days; the emailed link is read-only for 30 days and does not sign anyone in (J7).

Grades: Technical SEO B · 79 / 100 (ENGINE-DERIVED: re-weighted structure 60 / crawlability+meta 40) · Site-structure component 74 / 100 (ENGINE-DERIVED) · **AI readability** D · 41 / 100 (ENGINE-DERIVED under Access 40 / Readable 30 / Quotable 20 / Signals 10 and the scored set above; was "AI visibility", K7 keeps "AI visibility" only as the search term on `/check/*` titles and meta) · Content an answer engine can quote 58 / 100 (ENGINE-DERIVED) · Agent-readiness signals 2 of 7 present. The AI readability grade is withheld, with the Access component shown as a range, whenever fewer than two scored crawlers were measured (I4); the Technical SEO grade still shows.

Crawler matrix (eight crawlers, three groups, I6): Search engines: Googlebot and Bingbot, allowed by robots.txt, not fetched, 100% by their own JavaScript rendering, verified bots not testable from outside. AI search and answers (scored): OAI-SearchBot `allowed_thin` (200 but product pages are an empty shell, 31% text; ENGINE-DERIVED) · ChatGPT-User ENGINE-DERIVED · PerplexityBot `challenged_ua` (challenge on every sampled page, Bot Fight Mode, ○) · Claude-SearchBot ENGINE-DERIVED. AI training (unscored): GPTBot `blocked_by_ua_rule` (403 on every sampled page, Cloudflare firewall rule, error 1020) · ClaudeBot ENGINE-DERIVED (was "same as OAI-SearchBot, 31%"; on the dashboard sample it is also blocked in robots.txt from Thu 29 Oct 19:40). The headline "2 of 6 blocked" is ENGINE-DERIVED: under the new vocabulary a challenge is not "blocked".

Readable without JavaScript: site 31% · / 94% · /collections/tents 88% · /products/ridge-2p 12% (1,120 words rendered, 134 raw) · /products/alpine-stove 11% · /blog/winter-camping 97% · 158 product pages share the template (the rendered pages are the stratified sample; the per-page figures are ENGINE-DERIVED at regeneration).

Fixes: **13 total (ENGINE-DERIVED; was 14: Web Bot Auth left the fix list, I10)** · 3 open free (1 Let the AI crawlers through Cloudflare, effect ENGINE-DERIVED (was "+24 AI", about 10 minutes; its title may no longer name GPTBot because GPTBot is unscored) · 2 Server-render the product template, effect ENGINE-DERIVED (was +22 AI) · 3 Link the 7 orphan pages from their collections +4 SEO) · 10 on Pro (generic anchor text 6 pages +2 SEO · 3 pages deeper than three clicks +1 SEO · eight more +5 SEO) · per door: crawler access 1 open 1 Pro · without JS 1 open · structure 1 open 7 Pro · content 3 Pro · signals none (all door counts ENGINE-DERIVED) · projected together Technical SEO B → A-, AI readability 41 → ENGINE-DERIVED (was 65) after fix 1. The three Content fixes carry +1 Technical SEO each (I11); their AI readability effect is computed only after fixes 1 and 2 close.

Signals: schema.org present · Content Signals present · Web Bot Auth absent, shown as a Signals row worded "Cloudflare can verify signed crawlers; we cannot test this from outside yet" (not a fix, I10) · llms.txt absent (no measured lift) · MCP server card absent · markdown negotiation no · agent skills index absent. Effect on the AI readability grade: Signals is worth 10 of 100; schema and Content Signals count (five points each), the other five change nothing yet (B5).

Account & email: one email, magic link, no password · creates a free account and starts 14 days of Pro · **half of new sign-ups are shown the card-required Pro trial instead (U3, a 50/50 flag from the first sign-up; the card-required copy is a design-round item)** · three kinds of email from us and no others: a sign-in link (works once, 15 minutes, resend replaces it), a note when a re-check finds a change, and **one reminder three days before the 14 days end** (annual subscribers also get renewal reminders at 45 and 20 days, L6) · **if you pay, Stripe sends the receipts** · sign-in from signin@crawlmouse.com · alerts from alerts@crawlmouse.com · **the result email (crawl page) opens the audit read-only and keeps doing so for 30 days, well past the 24-hour expiry; it does not sign you in. Signing in always needs a link you request.**

Tiers: Free $0 one site, monthly re-check, email if changed, 3 fixes per audit, history kept · **Pro $19 a month ($190 a year), 5 sites, 2 seats, weekly checks, all fixes with packets, Slack alerts, 1 competitor per site, PDF/CSV/JSON export, staging/preview audits, Search Console, 10 full renders a month, read-only API** · **Agency $69 a month ($690 a year), 25 sites, 5 seats, $12 for each extra seat, $3 a month for each site from 26 to 50, reports on your domain with your logo (domain and sender steps optional on day 1), client one-pagers, 3 competitors per site, 30 full renders a month, 14-day trial card required** · Agency Plus anchor row on Pricing: 100 sites, 15 seats, from $249 a month, contact form only, nothing built (A3; R7's "SSO, API" is not in the master plan and is left out pending UD).

Trial end: **nothing you can see is deleted; evidence older than 90 days is condensed to headers and the parts of pages that changed (A6)**; the first site keeps monthly checks; other sites pause, including their history and change emails (K5), until Pro is chosen or they are removed.

Billing rules (master §3): 14-day full refund of the first charge; annual pro rata within 14 days (this clause and "full refund of the first annual charge" disagree: see Needs UD in the consistency report) · two clicks to cancel, no retention offer in the path · EU/UK checkout needs a validated VAT ID (K11) · past_due has a 7-day grace.

Retention (the single table lives in LEGAL §3, L7; this line only points to it): nothing you can see is deleted while the account is active · dormant accounts are warned at 23 months and deleted at 24 · anonymous audits are visible for 24 hours and purged at 30 days · evidence is condensed at 90 days · share links to report files expire at 30 days · account deletion has a 7-day grace that a sign-in link can undo.

Dashboard sample day: Fri 30 Oct 2026 · trial ends Sun 8 Nov 2026 (9 days left) · weekly check Fri around 06:00 · next Fri 6 Nov · ClaudeBot blocked detected Fri around 06:00, robots.txt changed Thu 19:40 · nahltech.com 3 orphans resolved Fri around 06:00 · 6 checks since 25 Oct, 4 run by the user · health mean 74, −2 since Thu (mean of ten grades; ENGINE-DERIVED) · checks ran daily 25–29 Oct (25 Oct the first audit, 26–29 run by the user), then Fri 30 Oct the first scheduled weekly check · chart x-axis: 25 Oct · 26 · 27 · 28 · Thu 29 · Fri 30 · **AI readability** 41 at checks 1–5, 22 at check 6 (ENGINE-DERIVED) · Technical SEO 79–80 throughout (ENGINE-DERIVED). **Trial-ending sample day moves to Thu 5 Nov (A8): the reminder fires Thu 5 Nov, three days before Sun 8 Nov.**

Competitor: summitgear.co · 6 of 6 crawlers full (ENGINE-DERIVED under the new vocabulary) · 96% text without JS · product schema yes · Technical SEO B- · 72.

Plan buttons: Free "Create a free account" (Includes 14 days of Pro) · Pro "Start with 14 days of Pro" (The same free account; $19 a month only if you keep Pro) · Agency "Start a 14-day trial" (Card required; nothing charged for 14 days). The Agency trial page takes the card with Stripe Elements on our page and records a consent checkbox (renewal, EU withdrawal, Terms) and a first-client-site field before the card is taken (J15, L6).

Glyphs: ● ok/full · ▲ warn/partial · ■ blocked/bad · **○ challenged or unverified (`challenged_ua`, `refused_unverified`; the fourth glyph, rule 7)** · deltas as mono numbers, no glyph · orange on one element per screen, the reader's action.

Stack detected (one story on every page): Next.js 14, pages router, from the asset paths · Shopify is the product backend (headless) · Cloudflare in front · verify commands name the crawler's UA string; the example uses ClaudeBot/1.0 because GPTBot is 403 until fix 1 lands (kept, ENGINE-DERIVED at regeneration) · JSON-LD Product schema is server-rendered in the head on all 158 product pages (name, price, a 24-word description); prose word counts exclude it. Per-framework packets exist for Next.js, Shopify (Liquid and Hydrogen), WordPress, Webflow and generic (I12).

Fix times (the only ones stated): fix 1 about 10 minutes · fix 2 one template, one deploy · fix 3 about 20 minutes.

Pro fixes, effects (must sum to the overview's +2 / +1 / +5 SEO): generic anchor text on 6 pages +2 SEO · 3 pages deeper than three clicks +1 SEO · eight more +5 SEO = three Content fixes at +1 SEO each (their AI readability effect is not estimated until fixes 1 and 2 land) + five more Structure fixes +2 SEO together. (Web Bot Auth is no longer in this list.)

Content measures: pages with a quotable opening 52 of 214 (home 1 · collections 9 of 42 · products 31 of 158 · blog 11 of 13) · spec tables as text 97 of 158 pass, 61 fail · headings as questions: home yes, collections 0 of 42, products 4 of 158, blog 12 of 13 · author and date 6 of 13 blog posts (all ENGINE-DERIVED; whether these are counted on the sample or on a census is decided at regeneration and the wording says which).

Caps and seats: pages per audit Free 500 · Pro 2,000 · Agency 2,000 · **seats Free 1 · Pro 2 · Agency 5, $12 a seat a month beyond; Agency sites 26–50 $3 a month each** · full renders a month Pro 10 · Agency 30 · manual re-checks per site per day Free 2 · Pro 10 · Agency 10 · annual Pro $190 · Agency $690.

Dashboard setup items (Pro): Slack alerts · one competitor · Search Console connection that lays Google's impressions and clicks by page over the audit, and its AI-feature breakdown when its API exposes it (H6) · staging URL audited on each deploy · **observed crawler activity: connect Cloudflare Analytics or a Vercel Drain to see what the AI crawlers actually fetched (CC-36b, U4)**.

Orange convention: one orange element per screen = the reader's best action; on a section with an open free fix it is the fix's copy button; on a section with no free fix it is the Next button (Content, Signals) or the keep bar button (Changes) or the fix link (Link map).

Phone maps: below 760px the link map scrolls horizontally at a minimum width of 720px rather than shrinking to illegibility.

Visitors with no audit: Pricing and For agencies send Free/Pro to the Sign-up page (email only, 14 days of Pro) and Agency to the Agency trial page (email + card; nothing charged for 14 days); the "Keep this audit" page is only reached from an audit.

Wording fixed by the locked pages, revised: "two of six crawlers never get in" → ENGINE-DERIVED (the new vocabulary distinguishes blocked from challenged, so the count and the verb are regenerated) · product template "11–12% text without JavaScript on the two product pages measured; all 158 share the template" (kept, ENGINE-DERIVED) · "Top 25 pages measured without JavaScript; all 214 with Pro" → "ENGINE-DERIVED pages (at most 50), chosen across every template, measured without JavaScript; every page with Pro (10 full renders a month; Agency 30)" (derived from I1 and K9; not in R7).

Robots change on the dashboard sample: Thu 29 Oct 19:40, "User-agent: ClaudeBot / Disallow: /" added to robots.txt (ClaudeBot only); fix 0 "Remove the ClaudeBot block from robots.txt" +19 AI (ENGINE-DERIVED; the effect depends on whether ClaudeBot is scored, and under I6 it is not), closed Sat 31 Oct in the trial-end sample. This is a decision for the fixture owner: with ClaudeBot unscored, fix 0 may carry no AI readability points (Needs UD in the consistency report).

Free three after a re-check: Free shows the three largest open fixes of the latest check, so a new fix outranks an old one; fix 0 closed Sat 31 Oct, so at trial end the free three are fixes 1, 2, 3 · receipts are sent by Stripe from Stripe's sender and linked from Settings › Plan (three kinds from us holds).

Agency sample clients (12): example-outfitter.com, holicfoods.com, nahltech.com, ridgelineoutdoors.com, redbirdaviation.com, drivepei.ca, bluebirdclinic.com, maplerowbakery.ca, northfieldlegal.com, harborviewdental.com, cedarpointcabins.com, lumenstudio.design · summitgear.co is a competitor only, never a client · monthly reports go on the first Monday.

Check-email copy variants (one artboard shows the named-site branch with acme-outdoors.com): no site named → "The link opens your dashboard with one field: the site to audit." · Agency trial → headline "Opening the link creates your agency account and starts the 14-day trial." · card paragraph "The same link signs you in; your card was checked, not charged. Branding is the first stop: your domain, logo and sender address." · closing note "The link opens your client matrix, empty until you add the first site."

Authors of Crawlmouse blog and research content (U2): Udaay Sikder (https://www.linkedin.com/in/udaaysikder/) and Samia Zaman (https://www.linkedin.com/in/samiazaman/), split between the two; LinkedIn author links on every piece, Person schema and a visible byline.

---

## Part 2. Every R7 copy change, old string to new string

Source: `reviews/R7-product-coherence.md` §2, with the corrections of the decision log applied. Where R7's string conflicts with a later decision the row says so and gives the later decision's string. "All pages" means every occurrence on that page. Numbers marked ENGINE-DERIVED are regenerated at CC-19 and are not typed by hand.

### A1: "AI visibility" → "AI readability" (K7: `/check/*` titles and meta keep "AI visibility" as the search term)

| Page | Old | New |
|---|---|---|
| Home, Public, Overview (+dark), Account, Dashboard day 0, Dashboard, Site, Ag-Matrix, Ag-Client, Ag-Branding (preview ×2) | label `AI visibility` | `AI readability` |
| For agencies (one-pager preview) | `AI visibility` | `AI readability` |
| Overview | `AI visibility 41 → 65, estimated` | `AI readability 41 → ENGINE-DERIVED, estimated` |
| Segment: Crawler access | `+24 AI visibility, estimated · about 10 minutes` | `+ENGINE-DERIVED AI readability, estimated · about 10 minutes` |
| Readable without JS | `+22AI visibility, estimated · one template, one deploy` | `+ENGINE-DERIVED AI readability, estimated · one template, one deploy` |
| Content | `Their effect on AI visibility is not estimated yet` | `Their effect on AI readability is not estimated yet` |
| Signals (competitor table) | `AI visibility \| D · 41 \| with Pro` | `AI readability \| D · 41 \| with Pro` (grade ENGINE-DERIVED) |
| Changes (audit) | `First audit · Technical SEO B · 79 · AI visibility D · 41` | `First audit · Technical SEO B · 79 · AI readability D · 41` (ENGINE-DERIVED) |
| Fix detail | `+22 AI visibility, estimated` | `+ENGINE-DERIVED AI readability, estimated` |
| Dashboard | aria-label `… AI visibility 41 at every check …` | `… AI readability 41 at every check …` |
| Dashboard | chart label `AI visibility · 41 since the first audit` | `AI readability · 41 since the first audit` |
| Dashboard | `AI visibility D → F` | `AI readability D → F` |
| Alerts | `■ grade moved AI visibility D 41 → F 22` | `■ grade moved AI readability D 41 → F 22` |
| Trial ending | `robots.txt, Sat 31 Oct · AI visibility F 22 → D 41` | `robots.txt, Sat 31 Oct · AI readability F 22 → D 41` |
| Ag-Branding | `AI visibility fell from D to F.` | `AI readability fell from D to F.` |
| Developers | `"ai_visibility": 22` | `"ai_readability": 22` |
| Developers | `"effect": { "ai_visibility": 19 }` | `"effect": { "ai_readability": 19 }` |
| All pages | shorthand `+24 AI`, `+22 AI`, `+19 AI` | unchanged (AI = AI readability); the numbers are ENGINE-DERIVED |

### A2: Pro = 2 seats

| Page | Old | New |
|---|---|---|
| Pricing | `Freelancers and in-house developers watching up to 5 sites. One seat.` | `Freelancers and in-house developers watching up to 5 sites. Two seats.` |
| For agencies (Agency against Pro) | `Seats \| 1 \| 5` | `Seats \| 2 \| 5` |
| FACTS line 21 | `seats Pro 1` | `seats Pro 2` (done in Part 1) |

### A3: Agency Plus anchoring row (Pricing only, new element)

| Old | New |
|---|---|
| (none) | `Agency Plus · 100 sites, 15 seats · from $249 a month · Talk to us`, a single-line table row under the three plan columns, no orange, linking to a contact form (MASTER §3: contact form only; R7 specified a `mailto:support@crawlmouse.com` link with subject `Agency Plus` and the words "SSO, API", neither of which the master plan carries: Needs UD) |

### A4: read API and MCP (Developers). Largely superseded by J13 and K8.

| Old | New |
|---|---|
| `GET https://api.crawlmouse.com/v1/sites/example-outfitter.com/latest` | **No change.** J13: the Developers page shape wins; ARCH-2 v1.1 serves `https://api.crawlmouse.com/v1/sites/{host}/latest` |
| `Authorization: Bearer cm_ro_…` | **No change.** J13: `cm_ro_` prefix, 60 requests a minute, Pro-gated; an OpenAPI file is published with the page |
| Roadmap row `MCP server, so Claude Code, Cursor and agents can audit and fix in one loop \| building` | **No change.** K8 reverses R7's split: the MCP server ships flagged after beta exit and is not announced before then, so no "shipping with the read API" row is added |
| Intro `The write side — start an audit, mark a fix done, re-check — and an MCP server, a CLI and a GitHub check are being built.` | **No change** (same reason) |
| Settings › Connected | **Do not add** the `MCP server \| read-only, the same key \| Set-up` row (K8) |

### A5: "estimated" on first appearance per page

| Page | Old | New |
|---|---|---|
| Public report (fix table header) | `The three fixes with the largest effect11 more in the full audit` | `The three fixes with the largest estimated effect · 11 more in the full audit` (the "11" is ENGINE-DERIVED: 10 after Web Bot Auth leaves the list) |
| For agencies (one-pager) | table caption `Three fixes` | `Three fixes, effects estimated`; add to the one-pager footer: `Effects are estimates from the audit's formula.` |
| Dashboard day 0 | `Start with the fix that pays most` | `Start with the fix that pays most, estimated` |
| Site page | column header `Effect` | `Effect, estimated` |
| Ag-Client | `Open fixes · 4 to raise` | `Open fixes · 4 · effects estimated` |
| Ag-Matrix / Dashboard | no effect numbers | nothing to add |
| Crawl page | `How the grade is calculated` | keeps its text; needs a destination page (R7 §4) |

### A6: "Nothing is deleted" → "Nothing you can see is deleted". Long form: `Nothing you can see is deleted. Evidence older than 90 days is condensed to headers and the parts of pages that changed.` Short form: `Nothing you can see is deleted.`

| Page | Old | New |
|---|---|---|
| Home | `When that ends, nothing is deleted.` | `When that ends, nothing you can see is deleted.` |
| Pricing | section lead `Nothing is deleted. We email you two days before.` | `Nothing you can see is deleted. Evidence older than 90 days is condensed to headers and the parts of pages that changed. We email you three days before.` |
| Pricing FAQ | `The account goes back to Free; nothing is deleted.` | `The account goes back to Free; nothing you can see is deleted.` |
| Overview | `Keeping this audit starts 14 days of it; nothing is deleted after.` | `Keeping this audit starts 14 days of it; nothing you can see is deleted after.` |
| Sign-up, Keep this audit | `nothing is charged, and nothing is deleted when the 14 days end.` | `nothing is charged, and nothing you can see is deleted when the 14 days end.` |
| Agency trial | `canceling puts the account on Free with nothing deleted.` | `canceling puts the account on Free; nothing you can see is deleted.` |
| Dashboard day 0 | `When it ends, this site stays on Free with monthly checks. Nothing is deleted.` | `When it ends, this site stays on Free with monthly checks. Nothing you can see is deleted.` |
| Dashboard, Site, Alerts, Reports, Settings (trial banner) | `Nothing is deleted. We'll email you two days before.` | `Nothing you can see is deleted. We'll email you three days before.` |
| Settings › Plan | `one click, effective at the end of the paid month, nothing deleted.` | `two clicks, effective at the end of the paid month. Nothing you can see is deleted; evidence older than 90 days is condensed to headers and the parts of pages that changed.` |
| Trial ending | `no checks; history kept, nothing deleted` | `no checks; history kept, nothing you can see deleted` |
| Trial ending | `the account goes back to Free, nothing is deleted.` | `the account goes back to Free. Nothing you can see is deleted; evidence older than 90 days is condensed to headers and the parts of pages that changed.` |

### A7: "client portal" → "client report page" (the column name `portal_domain` stays)

| Page | Old | New |
|---|---|---|
| For agencies | `Full audit with evidence, on your client portal: audits.summitdigital.co/example-outfitter` | `Full audit with evidence, on your client report page: audits.summitdigital.co/example-outfitter` |
| For agencies | `Reports and portal on your domain, your logo` | `Reports and client report pages on your domain, your logo` |
| Agency trial | `Reports and client portal on your domain, your logo` | `Reports and client report pages on your domain, your logo` |
| Ag-Client | `Client portal \| audits.summitdigital.co/example-outfitter` | `Client report page \| audits.summitdigital.co/example-outfitter` |
| Ag-Branding | `Reports, portals and emails under your name` | `Reports, client report pages and emails under your name` |
| Ag-Branding | `shown at 22px on reports and portals` | `shown at 22px on reports and client report pages` |
| Ag-Branding | preview tab `Portal` | `Report page` |
| Ag-Branding | `Email and portal both use this` | `Email and report page both use this` |
| ARCH-2 §5 | row label `Client portal` | `Client report page` (done in ARCH-2 v1.1) |

### A8: reminder three days before (the Trial-ending sample day moves to Thu 5 Nov)

| Page | Old | New |
|---|---|---|
| Pricing | `We email you two days before.` | `We email you three days before.` |
| Pricing | `one reminder two days before the 14 days end.` | `one reminder three days before the 14 days end.` |
| Sign-up, Keep this audit | `one reminder two days before the 14 days end.` | `one reminder three days before the 14 days end.` |
| Agency trial | `We email you two days before, as with every trial.` | `We email you three days before, as with every trial.` |
| Agency trial | `the reminder two days before the trial ends.` | `the reminder three days before the trial ends.` |
| Dashboard day 0 | `one reminder on Fri 6 Nov, two days before the trial ends.` | `one reminder on Thu 5 Nov, three days before the trial ends.` |
| Dashboard, Site, Alerts, Reports, Settings banner | `We'll email you two days before.` | `We'll email you three days before.` |
| Settings › Email | `One reminder two days before the 14 days end \| Fri 6 Nov` | `One reminder three days before the 14 days end \| Thu 5 Nov` |
| Trial ending | title `Pro ends in two days` | `Pro ends in three days` |
| Trial ending | `2 days left` | `3 days left` |
| Trial ending | `Two days of Pro left` | `Three days of Pro left` |
| Trial ending | `Fri 6 Nov · 5 sites · last check today 06:00` | `Thu 5 Nov · 5 sites · last check Sat 31 Oct` (counts ENGINE-DERIVED) |
| Trial ending | `What Pro did for you in 12 days` | `What Pro did for you in 11 days` |
| Trial ending | `Sun 25 Oct to Fri 6 Nov` | `Sun 25 Oct to Thu 5 Nov` |
| Trial ending | `Checks run \| 21 \| 8 on example-outfitter.com: 25–29 Oct daily, Fri 30, the re-check Sat 31 after fix 0, and today · 13 across the other four sites` | `Checks run \| ENGINE-DERIVED (was 21; R7 computes 20) \| 7 on example-outfitter.com: 25–29 Oct daily, Fri 30, and the re-check Sat 31 after fix 0 · 13 across the other four sites` (verify against the regenerated fixture) |
| FACTS line 10 | `one reminder two days before the 14 days end` | `one reminder three days before the 14 days end` (done in Part 1) |
| ARCH-2 §3.2 | `trial.reminder (Inngest, trial_ends_at − 2d)` | `− 3d` (done in ARCH-2 v1.1) |

### A9: Stripe sends the receipts

| Page | Old | New |
|---|---|---|
| Pricing FAQ | `Three kinds and no others: a sign-in link, a note when a check finds a change, and one reminder three days before the 14 days end.` | same, then append ` If you pay, Stripe sends the receipts.` |
| Sign-up, Keep this audit | `Three kinds of email, and no others: … three days before the 14 days end.` | append ` If you pay, Stripe sends the receipts.` |
| Agency trial | `Three kinds of email and no others: sign-in links, a note when a check finds a change, and the reminder three days before the trial ends.` | append ` Stripe sends the receipts.` |
| Dashboard day 0 | `You will hear from us three ways and no others: …` | append ` If you keep Pro, Stripe sends the receipts.` |
| Settings › Email | `Those are the three kinds. There is no newsletter and no product-update mail to unsubscribe from.` | `Those are the three kinds from us. If you pay, Stripe sends the receipts. There is no newsletter and no product-update mail to unsubscribe from.` |
| Settings › Plan | `Receipts \| Listed here once there is a charge` | `Receipts \| Emailed by Stripe after each charge, and listed in the billing portal from here` |
| Trial ending | `Receipts are in Settings › Plan, not emailed.` | `Stripe emails the receipts; they are also in Settings › Plan.` |
| Developers | `Your account's three kinds of email are unchanged by this` | unchanged |
| FACTS line 28 | `receipts live in Settings › Plan and are not emailed (three kinds of email holds)` | done in Part 1 |
| ARCH-2 §5 Settings › Plan | `receipts are in the Stripe portal (FACTS: not emailed)` | done in ARCH-2 v1.1 |

### B2 / B3 / B8: crawler cells, counts and vocabulary (rewritten to I6: four scored, two unscored, two by robots.txt)

R7's strings name four scored crawlers GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot. I6 changed the set, so the strings below replace R7's.

| Page | Old | New |
|---|---|---|
| Segment: Crawler access | tiles `Crawlers tested 6 · Pages requested per crawler 214 · Responses kept as evidence 1,284` | `AI crawlers tested 6 (4 scored) · Pages fetched per crawler ENGINE-DERIVED (at most 50) of 214, every template · Responses kept as evidence ENGINE-DERIVED (300 at the full sample)` |
| Segment | rows `Googlebot \| ● 200 \| ● 200 \| ● 200 \| ● 200 \| 100% \| —` and the `Bingbot` row | `Googlebot \| ● allowed by robots.txt \| (cell spans the four sections) \| 100%* \| verified-bot response not testable from outside`; `Bingbot` likewise; footnote `* Google and Bing render JavaScript; the text share is what a browser renders. Connect Search Console to see Google's own fetches.` |
| Segment | sub-head `Select a cell to see the raw request and response. Tested by user agent; your CDN may treat signed bots differently.` | the D1 text below |
| Overview | door `6 crawlers × 214 pages · 1 fix open · 1 on Pro` | `6 AI crawlers on ENGINE-DERIVED sampled pages (4 scored), 2 search engines by robots.txt · 1 fix open · 1 on Pro` |
| Crawl page | step `Fetching each page as 6 crawlers` | `Fetching a sample of pages as each AI crawler` |
| Home | row `Googlebot \| ● 200 \| ● 200 \| 100% \| nothing, it renders JavaScript` | `Googlebot \| ● allowed \| ● allowed \| 100% \| nothing: robots.txt allows it and it renders JavaScript` |
| Public report | `Googlebot \| ● full access \| 100% \| —` and the `Bingbot` row | `● allowed by robots.txt \| 100% \| verified bot, not fetched` |
| Dashboard "Crawler access now" | `Googlebot \| ● full` and `Bingbot \| ● full` | `● allowed by robots` |
| Site page crawler-by-check | Googlebot / Bingbot rows, `Cause now —` | `allowed by robots.txt; verified bot, not fetched`; aria-labels `Googlebot: full access at all six checks` → `Googlebot: allowed by robots.txt at all six checks` |
| Link map | `Googlebot, Bingbot \| ● 200, 1,120 words` | `Googlebot, Bingbot \| ● allowed by robots.txt · renders 1,120 words` |
| Fix detail | footnote `* 6 of 6 once the Cloudflare rule in Crawler access is also fixed.` | same, then append ` Google and Bing are counted by robots.txt and their JavaScript rendering, not by a fetch.` (the "6 of 6" is ENGINE-DERIVED) |
| Pricing | `Every plan audits as the same six crawlers: Googlebot, Bingbot, GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot.` | `Every plan tests the same AI crawlers on a sample of your pages: OAI-SearchBot, ChatGPT-User, PerplexityBot and Claude-SearchBot count towards your grade; GPTBot and ClaudeBot are shown, and blocking them is your choice. Googlebot and Bingbot are shown by robots.txt. Pro also lists the crawlers it has seen on your site (observed activity).` |
| Developers JSON | `{ "ua": "GPTBot", "status": 403, "pages": 214, "cause": "cloudflare_1020" }` | `{ "ua": "GPTBot", "verdict": "blocked_by_ua_rule", "status": 403, "pages_measured": ENGINE-DERIVED, "cause": "cloudflare_1020" }` |
| Developers JSON | `{ "ua": "ClaudeBot", "status": "robots", "pages": 214 }` | `{ "ua": "ClaudeBot", "verdict": "disallowed_by_robots", "pages_measured": 214 }` (robots.txt is read once for the site; confirm the figure at regeneration) |
| All crawler tables | the word `blocked` | used only for `disallowed_by_robots` and `blocked_by_ua_rule`. `■ challenge` is replaced by the ○ glyph for `challenged_ua` and `refused_unverified` (I2), not `■`: R7's "the verdict is `blocked_by_ua_rule` with cause `bot-fight`" is superseded. `rate_limited`, `payment_required`, `redirected_away` and `not_measured` need glyph and copy in the new-states design item (R7 §4). |

### B5: pinned formula consequences

| Page | Old | New |
|---|---|---|
| Signals | tile `Effect on the grade \| none` | `Effect on the grade \| 10 of 100` |
| Signals | prose `so this section does not change your grade and does not add fixes.` | `Two of them, schema and Content Signals, are worth five points each of the AI readability grade; the other five change nothing yet and add no fixes.` |
| Overview Signals door | `Weighted by what engines actually use.` | `Schema and Content Signals count; the other five do not yet.` |
| Overview Content door | `Blog posts answer their titles in the first paragraph; product pages don't. Headings skip levels on 41 pages. Schema is present on products.` | `Blog posts answer their titles in the first paragraph; product pages don't. Few headings are phrased as questions. Schema is present on products.` |
| Content | `each carries only its Technical SEO point for now` | kept: I11 decides the three content fixes carry +1 Technical SEO each and no AI readability points until fixes 1 and 2 close |

### D1: tagged user agents, disclosed (own UA string: see the consistency report, Needs UD; this table uses the D1/master string `Crawlmouse/2.0 (+https://crawlmouse.com/bot)`)

| Page | Old | New |
|---|---|---|
| Segment: Crawler access | the CDN sentence | `Each page was requested with the crawler's own user agent, tagged "Crawlmouse/2.0 (+https://crawlmouse.com/bot)", from our published IPs. Rules that match the whole string exactly will not fire on the tagged version, so a block can be under-reported here. Verify this site in Settings and we test with the exact strings.` Verified variant: `Each page was requested with the crawler's exact user agent from our published IPs; this site is verified.` L5 correction: the sentence must also say that rendering requests come from Cloudflare Browser Rendering and that one untagged browser-identity control fetch per sampled page is part of the method. |
| Segment evidence block | `User-Agent: Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot` | the same string followed by ` Crawlmouse/2.0 (+https://crawlmouse.com/bot)`, plus the line `From: bot@crawlmouse.com` |
| Readable without JS, Fix detail (verify blocks) | after `curl -sA "ClaudeBot/1.0" …` | add `# we run the same request with a tagged user agent; your result and ours can differ only if a rule matches the exact string` |
| Home, Public, Dashboard, Site, Link map (every crawler table) | (none) | one line under the table: `Tested with tagged user agents from published IPs — crawlmouse.com/bot.` |

### H6: Search Console

| Page | Old | New |
|---|---|---|
| Dashboard day 0 | `Connect Search Console to lay Google's AI-feature impressions over these pages` | `Connect Search Console to lay Google's impressions and clicks by page over the audit, and its AI-feature breakdown when its API exposes it` |
| Dashboard | same row | same new text |
| Settings › Connected | `Search Console \| AI-feature impressions by page` | `Search Console \| Google's impressions and clicks by page; AI-feature breakdown when its API exposes it` |
| FACTS line 22 | `Search Console connection that lays Google's AI-feature impressions by page over the audit` | done in Part 1 |

### Other copy changes named by R7 (the decisions they implement)

| Item | Page | Old | New |
|---|---|---|---|
| D5 two-click cancel | Pricing | `one click, from Settings, any day` | `from Settings, any day, two clicks, no call` |
| D5 | Agency trial | `cancel from Settings, one click, any day before` | `cancel from Settings any day before, two clicks` |
| L6 annual reminder (supersedes R7's 30 days) | Pricing | `Annual: Pro $190, Agency $690 — two months free, from Settings.` | append ` We email you 45 and 20 days before an annual renewal.` (R7 said "30 days before"; L6 moved it to 45 and 20) |
| C4 | Ag-Branding | DNS table | add row `TXT _crawlmouse \| ● found` above CNAME; add under the table `Until both records are found the host returns 404. The host is released the day Agency ends.` (J11/K6: the CNAME and sender steps are optional on day 1, so the sentence says which records are required for the host to resolve) |
| C4 | For agencies | `Emails from your address \| — \| SPF and DKIM, verified in Settings` | `SPF, DKIM and a DMARC record, verified in Settings` |
| D6 | Ag-Branding preview footer | `Sent by Summit Digital · reports@summitdigital.co · reply to reach Priya` | `Sent by Summit Digital, 12 Example St, Indianapolis IN 46204 · reports@summitdigital.co · reply to reach Priya · Pause these reports` |
| E6 | Settings › Danger | `Takes effect after a confirmation link; nothing is kept.` | `Takes effect after a confirmation link. For seven days the sign-in email can undo it; after that nothing is kept.` |
| H4 / ARCH-2 §2.5 | Dashboard day 0, Dashboard, Site, Alerts | `Fri 30 Oct 06:00` | `Fri 30 Oct around 06:00` |
| H4 | Site settings | `weekly, Fri 06:00 UTC` | `weekly, Fri around 06:00, America/Indiana/Indianapolis` (account timezone) |
| H4 | Dashboard | `(now Fri 06:00)` | `(now Fri around 06:00)` |
| ARCH-2 q12 | Ag-Seats | (none) | add under the table: `An invitation is the sign-in email with one extra line; nothing else is sent.` |

### Copy changes that come from the decision log and are not in R7 §2

| Decision | Page | Old | New |
|---|---|---|---|
| K10 | Pricing | `5 seats, $9 a seat beyond` | `5 seats, $12 a seat beyond; $3 a month for each site from 26 to 50` (K10 says the seat price appears on four pages; only Pricing is identifiable from the files in this tree, the artboards that hold the other three are not here) |
| K10 | FACTS line 21 | `$9 a seat a month beyond` | `$12 a seat a month beyond` (done in Part 1) |
| K9 | Readable without JS, Pricing, Pro dashboard | `all 214 with Pro` | `every page with Pro (10 full renders a month; Agency 30)` |
| I1 | Nine pages that print the response count | `6 crawlers × 214 pages = 1,284 responses` | `6 AI crawlers × ENGINE-DERIVED sampled pages across every template = ENGINE-DERIVED responses; all 214 pages crawled for structure` |
| I10 | Fix counts on every page that prints one | `14` (Pro `11`) | ENGINE-DERIVED (13 and 10 on the fixture if Web Bot Auth is the only removal) |
| I10 | Signals row | `Web Bot Auth` row worded as a missing item to fix | `Cloudflare can verify signed crawlers; we cannot test this from outside yet` |
| J7 | Crawl page "email me the result", result email | wording that the link signs you in | `This link opens your audit for 30 days. To keep it and watch it, sign in with a link we email you.` (wording derived from J7; not in R7) |
| U3 | Sign-up, Pricing (card-required variant) | (none) | variant copy for the card-required trial: a design-round item, not written here |
