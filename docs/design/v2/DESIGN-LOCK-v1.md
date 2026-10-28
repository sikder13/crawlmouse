# CRAWLMOUSE-DESIGN-LOCK v1 — the standard, the page map, and the first three locked screens

Status: 26 Oct 2026. All 33 artboards (26 screens + dark variants + the Agency set) LOCKED at 9/10 on every dimension by two independent blind reviewers, every lock backed by a headless-Chromium render at 1280/1000/390. Canvas version 37. Sections 6–7 record the rulings and the process changes made during the rounds; section 8 is the hand-off.

## 1. How a page reaches "locked"

1. Build on the shared base (tokens, buttons, tables, status pills, phone rules) — never from scratch.
2. Two independent reviewers (one product-design, one conversion-UX), blind to the designer's reasoning, score the raw artboard against the rubric below. Page score = lowest dimension.
3. Fix every defect on both lists. Re-review. Repeat until both reviewers return ≥9 on every dimension.
4. Human tests on the money pages before code: five-second test (5–10 people, ≥80% can say what the page is and what to do), first-click test (~30 people, >80% click the intended target within 15 s), preference test against the current site. If humans fail a page reviewers passed, humans win.

Rubric dimensions (each 1–10; 9 = a senior designer at Linear/Vercel/Stripe ships it with cosmetic notes):
Clarity · Conversion mechanics · Visual system (13 rules) · Accessibility · Copy · Responsiveness & performance.

Round history for the first three screens:
| Page | R1 | R2 | R3 | R4 | R5 |
|---|---|---|---|---|---|
| Homepage | 4 / 4 | 5 / 5 | 7 / 8 | 8 / 9 | **9 / 9** |
| Audit overview | 4 / 5 | 6 / 6 | 7 / 7 | 8 / 9 | **9 / 9** |
| Segment: Crawler access | 5 / 5 | 6 / 6 | 7 / 8 | 8 / 8 | **9 / 9** |
(Reviewer A / Reviewer B)

## 2. The 13 design rules (lint every screen)

1. Canvas: cool neutral. Light #F7F8FA / dark #0F1317. Never cream, never warm grey.
2. Depth = 1px hairline + a 2–3% surface step. No box shadows.
3. Orange #F2541B on exactly one element per screen: the primary action. Dark text (#13161B) on orange — 5.2:1. Never on text, labels or decoration. Logo mark is brand, not counted.
4. Type: IBM Plex Sans 400/500/600; Plex Mono only for real data (URLs, codes, numbers, logs). Paid swap: PP Neue Montreal Text + Mono (one-time licence).
5. Display weight 600, tracking −0.02em. No 700.
6. Numbers: tabular figures, right-aligned in tables.
7. Status = colour + shape: ● ok · ▲ warn · ■ blocked. Tinted pill (step-3 bg, step-11 text). Graph nodes: circle / triangle / square.
8. Lists of things are tables. Cards only for a single object (a site, a fix, a segment door).
9. Radii: controls 5px, surfaces 8px.
10. Forbidden: all-caps eyebrows, 01/02/03 numbering, one coloured word in a headline, arrows on links, count-ups, gradients, glass, emoji, pulsing dots, infinite motion, template chrome.
11. Headings are problems the reader has, not labels. Buttons say what happens. No Unlock/Supercharge/Get started/Learn more.
12. Mouse: logo only inside the product. One illustration per marketing surface. Never near billing or errors.
13. Motion only on state change (the crawl build runs once per session); cross-fade under reduced-motion.

Tokens (light): bg #F7F8FA · s1 #FFFFFF · s2 #F1F3F6 · line #E2E6EB · line2 #EDF0F3 · ctl #808996 (≥3:1 on all surfaces) · fg #13161B · fg2 #3D4654 · mut #5B6472 · acc #F2541B · acc2 #FF8352 · ok #10603F/#DDF3E8 · bad #9B2613/#FBE3DF · warn #7A4A00/#FCEBD2 · neu #3D4654/#E9ECF0.
Tokens (dark): bg #0F1317 · s1 #161B21 · s2 #1D232B · line #242B33 · line2 #222930 · ctl #6B7580 · fg #E6E9ED · fg2 #B5BCC6 · mut #97A1AD · ok #6FD49A/#15301F · bad #FF8F7A/#3A1A16 · warn #F2B857/#3A2A10 · neu #C3CAD3/#232A33.
Theme: three-state toggle System / Light / Dark, default System, light fallback.

## 3. Conversion rules that survived review

- Show the full verdict free; hold the cure (fix detail, persistence, history, exports, monitoring) behind one email.
- One account ask per page, one mechanism, stated plainly: "One email creates a free account and starts 14 days of Pro." The keep bar is scroll-gated on desktop (after 420px), in-flow on phones, dismissable to a one-line state that reads "Not kept. This page expires <timestamp>." Links to Pro reveal the bar.
- Expiry is a timestamp, never a countdown. Share and "Email this fix to my developer" carry the 24-hour note.
- Orange goes on the reader's action ("Open the fix", "Copy as a prompt"), never on the company's ask.
- Pro asks are contextual: "See with Pro" rows in the fix table, "See this fix with Pro" under the free fix, one panel beside the fixes. No modals, no walls.
- Counts must reconcile across every surface (doors = table = headline = 14).
- Evidence must match diagnosis (error 1020 = firewall rule; challenge = Bot Fight Mode). Fix packets verified against vendor docs (Cloudflare: WAF skip rules do not bypass Bot Fight Mode; IP access rules or Super Bot Fight Mode do).
- Plan buttons: "Create a free account" (Free), "Start with 14 days of Pro" (Pro, same account), "Start a 14-day trial" (Agency, card required).

## 4. Page map, v2 (26 screens; Sign-up and Agency trial added in section 6)

Public: Home ✅ · Pricing · For agencies · Developers (OG holding page) · Blog/guides (existing) · Public report /r/slug (= overview, read-only, branded if claimed)
Audit flow: Crawl in progress (first email ask) · Overview ✅ · Segments: Crawler access ✅ · Readable without JavaScript · Site structure (full link map) · Content an answer engine can quote · Agent-readiness signals · Changes · Fix detail · Link-map explorer
Account: Sign-up (no audit in hand) · Agency trial (card step) · Keep this audit (from an audit, magic link) · Check your email · First-run dashboard (empty state) · Dashboard home ("since last crawl") · Site page · Alerts · Changes log · Reports & exports · Settings (theme, notifications, billing) · Trial ending / downgrade state
Agency: Client matrix (home) · Client page · Branding (logo, CNAME domain, sender, live preview) · Prospect one-pager · Scheduled client reports · Seats

Every screen carries states: empty, loading, error, Free / Pro / Agency, light / dark, phone.

## 5. Where things live

- Design canvas: "Crawlmouse v2 Design Directions" (Claude Design), bottom row = LOCKED screens; rules note beside them.
- Research: CRAWLMOUSE-UX-RESEARCH-v1.md (this project).
- Review archive and rubric: review/RUBRIC.md, review-A1…A5.md, review-B1…B5.md; locked page source under review/locked-source/.

## 6. Rulings added on 25 Oct (batch 1–3 review rounds)

Locked so far (both reviewers ≥9): Home · Overview · Segment: Crawler access · Crawl in progress · Keep your audit (account) · Check your email · Dashboard home (day 9, dark).

Batch 1 round history: Crawl 7 → 8 → 8 → 7 → **9** · Dashboard 6/7 → 7 → 8 → 8 → 9/8 → **9**. Account and Check email locked at round 3.

Single source of truth: `gen/FACTS.md` — every number, date, tier limit, email kind and stack claim. A page that contradicts it is a Copy defect; reviewers receive it with every round. Rulings recorded there after the batch-2/3 rounds:

- One detected stack on every surface: Next.js 14 (pages router) front end, Shopify as the product backend, Cloudflare in front. Packets are written for that stack; the fix page keeps a framework switch.
- Verify commands use ClaudeBot/1.0, because GPTBot is 403 until fix 1 lands (a verify step that cannot pass is a defect).
- Pro fix effects must sum to the locked overview (+2 / +1 / +5 SEO). The three Content fixes carry +1 SEO each; their AI-visibility effect is not estimated until fixes 1 and 2 land, because the AI crawlers cannot yet read the pages they change. This is stated on the Content page rather than hidden.
- Email kinds: exactly three. The result email on the crawl page signs in for 30 days. Developer-updates email on the Developers page is a separate, opt-in list and says so.
- Orange convention: one per screen, the reader's best action. Section with an open free fix → the fix's copy button. No free fix → the Next button (Content, Signals), the keep bar (Changes), or the fix link (Link map). Dashboard day 0 → "Start with fix 1". Pricing → the Pro CTA. For agencies → the trial button.
- Visitors with no audit in hand go to **Sign-up** (email, optional first site, 14 days of Pro) or **Agency trial** (email + agency name + card, $0 authorisation, charged $69 on day 15 unless cancelled). "Keep this audit" is reached only from an audit. These two screens were missing from the v1 page map; the map is now 26 + dark variants.
- Phone rules added to the base: the section tab strip scrolls horizontally with the active tab centred on mount; link-map stages (`.scrollmap`) scroll at a 720px minimum width rather than shrinking to illegibility; the dashboard trial card collapses to a one-line tappable strip with the price link still visible.
- Chart history must agree with the audit it starts from (the dashboard's AI line is flat at 41 until the ClaudeBot block, not a story the overview never told).
- Never put an `aria-label` on a link that drops its visible text (WCAG 2.5.3).
- Wording fixed by the locked pages: "two of six crawlers never get in" · "the product template keeps 12% of its text without JavaScript; all 158 pages share it" · "Top 25 pages measured; all 214 with Pro".

## 7. What the later rounds taught (process rules, binding from here)

1. **Render, don't derive.** Two base defects (pages sizing to max-content on phones; orphan markers drawn as full-width bars) survived seven "locked" pages while reviewers read CSS. They fell the first time a reviewer rendered pixels in headless Chromium. Every lock now requires a browser render at 1280, 1000 and 390 with the mount hook run; the build step renders all 33 pages at 390 and refuses to publish a page wider than the viewport or a table wider than its parent outside a scroll wrapper.
2. **One source of truth beats cross-page vigilance.** `gen/FACTS.md` holds every number, date, tier limit, email kind, stack claim and sample-data ruling. Reviewers receive it with each round; a page that disagrees with it is a Copy defect by definition. Most first-round defects in every batch were facts drifting between pages, not design.
3. **Verify commands must be able to pass.** A packet whose check uses GPTBot cannot succeed while GPTBot is 403; packets use ClaudeBot/1.0 until fix 1 lands.
4. **Effects must sum.** Pro fix points reconcile to the overview (+2 / +1 / +5 SEO); where an effect cannot be estimated yet (Content fixes before the AI crawlers can read the pages), the page says so instead of inventing a number.
5. **Orange goes where the reader acts, never inside a scrolling table.** On phones an orange button inside a `.tw` lands off-screen; the one orange moves to the page header or the keep bar.
6. **No `aria-label` that drops visible text; no glyph-only cells without a label; toggles carry their full row text.**
7. **Tables of records scroll; tables of settings stack.** A three-column settings table on a phone becomes label-left / control-right / hint-under (Settings › Email); half-width tables collapse to one column at ≤1100 rather than scrolling inside a half card.
8. **Legends live in a band under a map, never over it;** overlays inside a horizontally scrolling stage are sticky-left so centring the scroll cannot push them off-screen.
9. **Pages the map was missing surface as routing failures.** Pricing's plan buttons all landing on "Keep this audit" revealed Sign-up and Agency trial; the Check-email promise revealed the day-zero dashboard and the no-audit Check-email state. Walk the flows, not just the pages.

Final board (26 Oct): 33 of 33 LOCKED by both reviewers. Rounds per batch — batch 1: 5–6 · batch 2: 4 + sign-off · batch 3: 4 · batch 4: 4 + sign-off. Review archive: 50 files under review/, plus FACTS.md, the generator source (locked-source/) and the built HTML of every locked page (locked-html/).

## 8. Hand-off

What exists: a design canvas with 33 locked artboards; `FACTS.md` (every number, date, tier rule, email kind, stack claim and sample-data ruling the pages use); a shared `base.css` with tokens, components and phone rules; one generator per batch that builds every page from templates, so the HTML is the spec; six human-test scripts on free tools (CRAWLMOUSE-HUMAN-TESTS-v1.md).

Next, in order:
1. Human tests on the money pages (Home preference test first, then the keep-bar first click). Humans win over reviewers; fixes go back through the two reviewers.
2. DESIGN.md for the repo (tokens, components, rules 1–13, the phone rules from §6–7) and the build spec in the repo's SPEC format: one spec per screen, sourced from the locked HTML and FACTS.md, with states (empty / loading / error / Free / Pro / Agency / light / dark / phone) listed per screen.
3. Architecture and phasing for the first upgrade (monitoring, alerts, Pro/Agency entitlements, branded portals, exports), written so nothing blocks the OG developer/agent surface.
4. Code.
5. The OG version: write API, MCP server, GitHub check, CLI, per-call pricing — designed with the same process.
