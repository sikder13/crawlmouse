# SPEC 04 — Viral Loop, Client-Ready Reports & The Wait (Phase 3)

> **Read `00-crawlmouse-master-build-plan.md`, `PROJECT_OVERVIEW.md`, and `CLAUDE.md` first.** This spec
> serves the conversion spine (SPEC 00 §2) at three points: **ACTIVATION** (the wait — the moment we lose
> first-time users today), **THE WOW → SHARE** (the artifact-led viral loop), and **THE WALL** (white-label
> as the first paid agency lever inside the $19 Pro tier). It is built on an explicit evidence base
> (research synthesis, 2026-07): realistic virality for a single-player audit tool is **K < 1** — the loop
> is an *amplifier* of SEO and word-of-mouth, never a self-sustaining engine. Every mechanic below is the
> honest version: public-by-default artifacts + attribution riding on proud normal use. **Never** auto-post,
> never force un-removable branding, never fake progress or urgency.
>
> **Status:** Phase 3. Runs on **Terminal 1** (branch `viral/spec-04-loop`, own worktree off a clean
> `origin/main`). SPEC 05 (AI-readiness) runs later on Terminal 2 — see §0 coordination rules.
>
> **Owner decisions locked into this spec:** (1) free users get the professional client-ready report
> **with Crawlmouse branding** (the viral vector); (2) **$19 Pro unlocks a white-label toggle** (their own
> name/logo on the same report) — no agency tier yet, this validates the agency thesis on Pro; (3) the
> **2–4-minute wait is in scope as a first-class activation surface**, not a polish item.
>
> **Implementer note (mandatory, per CLAUDE.md §3):** verify every file/function/table/column name against
> the live repo before editing. References below were read from `main` @ `ba2918a` (2026-06-30); re-confirm
> in-code and flag mismatches before writing implementation. **Do not assume.**

---

## 0. What this spec delivers, and the coordination rules

**Delivers, in spine order:**
1. **The honest wait** (§2) — operational transparency during the crawl: live activity feed, determinate
   progress, early streamed findings, time-to-first-value < 10s, an email-me-when-done escape valve.
   The highest-leverage single build in this spec (activation is upstream of everything viral).
2. **Frictionless mint with guardrails** (§3) — remove signup + domain-verification from public-report
   minting (the current 403 `verification_required` wall in `apps/web/app/api/reports/mint/route.ts:64-73`),
   paired with the non-negotiable guardrail trio: unlisted/noindex-by-default, automated-analysis
   disclaimers + timestamp + dispute path, and a claim/takedown flow.
3. **The professional client-ready report** (§4) — executive summary, plain-language findings, prioritized
   action list, methodology + confidence note; print-stylesheet PDF export. Deterministic, no LLM (D3).
4. **White-label on Pro** (§5) — brand name + logo replace Crawlmouse branding on the report + PDF.
   An **approved entitlement change**: `canWhiteLabel` becomes true for `pro` (was agency-only).
5. **The share moment + OG cards** (§6) — grade-adaptive share intents fired at the grade-reveal peak
   (extends the existing `share-intents.ts`); dynamic per-report OG cards verified/upgraded.
6. **SEO-safe badge + indexing policy** (§7–§8) — the iframe badge stays compliant; `/r/` indexing becomes
   **claim-gated** (claimed → indexed + sitemapped; unclaimed → noindex + unlisted) to protect the domain
   from Google's scaled-content-abuse enforcement while keeping the flywheel.
7. **Claim flow** (§9) — "claim this report" (signup + existing domain verification) unlocks listing,
   indexing, leaderboard opt-in, the badge, and (if Pro) white-label. The moderation backbone AND the
   conversion hook.

**Terminal / parallel rules:**
- **Branch:** `viral/spec-04-loop` in its own git worktree off a **fresh `origin/main`** (not a stale local
  `main`). `nvm use 22`. This terminal holds **only SPEC 04** in context.
- **SPEC 05 coordination (forward seam):** SPEC 05 will add an AI-readiness section to the report surface.
  SPEC 04 must therefore build the report page (§4) with a **section-slot layout** (an ordered list of
  self-contained report sections) so SPEC 05 can add its section additively without touching SPEC 04's
  components. SPEC 04 does **not** build any AI-readiness content (no score, no llms.txt/robots-AI checks —
  that is SPEC 05). Types added to `packages/types` are additive only.
- **File ownership:** SPEC 04 owns the share/report/embed/leaderboard/compare surfaces
  (`apps/web/app/r/**`, `compare/**`, `top/**`, `embed/**`, `components/share/**`), the mint/claim/report
  APIs, the wait-experience components (`components/audit/AuditProgress.tsx` + new wait components), the
  OG images, `lib/reports.ts`, `lib/entitlement.ts` (the one approved change), and its own migrations.
  It must **not** modify `packages/engine/src/**` grading/crawling logic (worker progress *emission* is the
  one allowed engine-adjacent touch, see §2), and must not touch SPEC 02's projection gating semantics.

---

## 1. SHARED DATA CONTRACT (additive; lives in `packages/types/src/`)

Additive types only — nothing existing changes shape. Verify names against `packages/types/src/audit.ts`.

```ts
// ── Public-report visibility & white-label (§3, §5, §8, §9) ──
export interface WhiteLabelConfig {
  brandName: string;                 // replaces "Crawlmouse" wordmark on the report + PDF (≤ 60 chars)
  logoPath: string | null;           // Supabase-storage path of the validated uploaded logo; null = text-only
}

export interface PublicReportMeta {
  slug: string;
  domain: string;
  mintedAt: string;                  // ISO — rendered on the report ("as of …") and the disclaimer
  claimed: boolean;                  // true after the owner completes domain verification (§9)
  listed: boolean;                   // appears on browse/leaderboard surfaces; claim-gated, default false
  indexable: boolean;                // page-level robots index; claim-gated, default false (§8)
  hiddenAt: string | null;           // self-service hide (§3); hidden reports 404 publicly
  whiteLabel: WhiteLabelConfig | null; // Pro owner only; null = Crawlmouse-branded (the viral default)
}

// ── Mint (§3). POST /api/reports/mint — auth NO LONGER required. ──
export interface MintRequest {
  auditId: string;                   // possession of the capability URL = permission to mint
  turnstileToken?: string;           // required when the abuse gate demands it (same pattern as audits/start)
}
export interface MintResponse { slug: string }

// ── Wait experience (§2): additive SSE `activity` events alongside the existing `progress` event ──
export type CrawlActivityKind =
  | 'fetch_ok' | 'fetch_blocked' | 'fetch_dead'
  | 'sitemap_seeded' | 'cms_detected'
  | 'finding_preview'               // an early, streamed finding headline (see §2 honesty rules)
  | 'phase';                        // 'crawling' | 'analyzing' | 'grading' (real pipeline phases only)
export interface CrawlActivityEvent {
  kind: CrawlActivityKind;
  at: string;                       // ISO
  label: string;                    // pre-escaped, plain-language line for the activity feed
  pagesFetched?: number;            // drives the determinate progress ("N / cap" or "N of ~M")
  estimatedTotal?: number | null;   // sitemap-derived when available (reuse ConfidenceBand.basis semantics)
}
```

**Gating summary:** minting, viewing, sharing, and OG cards are **free and auth-less**. `claimed`,
`listed`, `indexable`, leaderboard opt-in, and the badge require the **claim** (§9). `whiteLabel` requires
claim **+ Pro** (`entitlement.canWhiteLabel` — changed to `paid` in this spec, §5). All gates are enforced
server-side, exactly like SPEC 02 §11 — UI hiding is never gating.

---

## 2. The honest wait — activation is the gate  *(highest-leverage build; ship first)*

**The problem (measured in code).** During a 2–4-minute crawl, `AuditProgress.tsx` shows a status word and
the literal string "Crawling your site…" — `page_count` is only persisted when the crawl **finishes** (see
the comment at `AuditProgress.tsx:6`), and the SSE wiring (`lib/audit-stream-wiring.ts`) carries one coarse
`progress` event. First-time users watch minutes of near-silence and bounce. Activation today is ~3–5%
against SPEC 00's ≥30% target; nothing viral matters until this is fixed.

**The evidence.** Buell & Norton (2011, *Management Science*): operational transparency — visibly showing
the work — increases perceived value and willingness to wait, even preferring a *longer* transparent wait
over an instant result. NN/g: determinate, always-forward progress beats spinners; a stalled bar destroys
trust. Streamed partial results are what Semrush/Ahrefs audits and AI research tools use to hold attention
across minutes.

**Build:**
1. **Real incremental progress from the worker.** The Inngest `auditFn` (crawl+persist in one durable step)
   emits lightweight, **batched** progress during the crawl — e.g. update an `audits` progress column /
   emit activity rows every N pages or every ~5s, **never per-page** (cost ceiling ≤18% MRR;
   `maxDuration=300` unchanged). The SSE stream route projects these as `CrawlActivityEvent`s. The
   mechanism (column poll vs. sidecar table) is an implementation choice — pick the lower-risk one and
   justify it in the plan. **This is the one allowed engine-adjacent change**; grading/crawl logic,
   politeness, budgets, and SSRF guard are untouched (§12).
2. **Determinate progress.** "Crawled **N** pages" always; "of ~**M**" only when honestly derivable
   (sitemap-seeded — same honesty rule as `ConfidenceBand.basis.method`); otherwise "N pages so far / cap
   C". The bar only advances on **real events**. **Never** attach progress to a timer. A stall shows an
   honest state ("waiting politely — this site rate-limits crawlers") rather than fake motion.
3. **Live activity feed.** A compact, auto-scrolling feed of real crawl lines: "✓ /pricing", "sitemap found
   — 214 URLs", "Shopify detected", "⚠ 3 pages responding slowly". All strings escaped
   (`lib/html-escape.ts`) — URLs/titles are attacker-controlled crawled content.
4. **Early findings, honestly framed.** Stream `finding_preview` headlines as analysis-safe facts emerge
   ("2 pages so far have no internal links pointing to them — verifying…"). Previews are explicitly
   provisional in copy; the grade **never** appears before the engine finishes (no fake suspense, no early
   verdicts). Reuse/extend `DripFeedFindings`.
5. **Time-to-first-value < 10s.** Within seconds of submit the user must see: homepage fetched ✓, platform
   detected, sitemap status, first pages appearing in the live graph (`LinkGraphSlot` already streams — make
   its first nodes appear as early as the pipeline allows).
6. **"Email me when it's done" escape valve.** A calm input during the crawl: capture email → on completion
   send a "your report for {domain} is ready" email (existing Resend infra) linking the capability URL,
   with a soft "claim this report" CTA (§9). Abuse limits: per-IP and per-email daily caps via the existing
   `rate_limits` pattern; neutral, non-customizable content; an "ignore if you didn't request this" line.
   Fires the existing `email-captured` analytics event.
7. **Educational micro-cards** rotating during the wait (what orphan pages are, why depth matters) — static
   content, doubles as onboarding. **Skeleton** report layout (extend `GradeCardSkeleton`) so structure is
   visible before data.

**Honesty discipline (non-negotiable):** every element reflects real pipeline state. If users ever catch a
faked progress signal, the trust the entire spine depends on is gone (locked-truth #1).

## 3. Frictionless mint — with the guardrail trio  *(never ship one without the other)*

**Current state:** `POST /api/reports/mint` requires auth (401), audit ownership (404), **and** verified
domain ownership (403 `verification_required`) — `mint/route.ts:44-73`. The viral loop's core artifact sits
behind the highest-friction step in the product. Industry norm is the opposite: PageSpeed, GTmetrix,
SSL Labs, SecurityHeaders all produce public results for any URL, no login.

**The change:** anyone in possession of a completed audit's capability URL may mint. Auth optional;
verification not required to *mint* (it becomes the *claim*, §9).

**The guardrail trio (required in the same release — shipping open minting without these is the actual
mistake):**
1. **Unlisted + noindex by default.** An unclaimed report renders publicly at its slug (shareable) but is
   `robots: noindex`, appears on no browse/leaderboard/sitemap surface, and carries an "unverified —
   automated report" label. (§8 has the full indexing policy; this changes `/r/[slug]/page.tsx`'s current
   unconditional `robots: { index: true }` at line ~20.)
2. **Disclaimers + timestamp + fresh-run.** Every report footer (claimed or not): "Automated, deterministic
   analysis of publicly served HTML, as of {mintedAt}. Results are a point-in-time snapshot —
   [run a fresh audit]. Methodology: {link}." Plus a **dispute/hide link**. (Modeled on Sucuri/SSL
   Labs/Similarweb framing; risk *reduction*, not immunity — the existing takedown flow remains the formal
   channel.)
3. **Hide + claim + takedown.** Self-service hide for the minter (session/capability-scoped); the existing
   takedown flow (`app/api/takedown`) preserved and linked from every report; the claim flow (§9) as the
   owner's control path.

**Abuse limits:** minting goes through Turnstile (same on-demand gate as `audits/start`) + per-IP daily
caps (extend the `rate_limits` pattern; keep `MINT_REPORTS_PER_DAY = 20` for authed users, add a lower
anonymous per-IP cap — propose the constant in the plan). The `insertReportWithRetry` idempotency
(one report per audit) is preserved.

**Badge integrity under open minting (regression to prevent):** the embed badge currently serves the
**latest** report for a domain (`embed/[domain]/route.ts` — `order created_at desc limit 1`). With open
minting, a third party could mint a fresh partial-crawl report and silently change what a site's badge
shows. **Fix: the badge (and compare/leaderboard surfaces) resolve only CLAIMED reports.** Today all
existing reports are verified, so this is behavior-preserving at cutover.

## 4. The client-ready report — the artifact IS the marketing  *(deterministic, D3)*

Free users' report carries Crawlmouse branding — the viral vector (HubSpot Website Grader precedent:
~4M sites graded, 40k+ backlinks). It must therefore be genuinely **client-ready**, matching what agencies
actually send (AgencyAnalytics/SEOptimer/Semrush patterns):

- **Executive summary** — 3–5 deterministic template sentences assembled from real data (grade, score,
  page counts, top issue categories, confidence). Template-based, no LLM (D3); same audit → same summary.
- **Plain-language findings** — each finding category gets a one-paragraph "what this means / why it
  matters" explanation a non-technical site owner understands. Static copy per category, data interpolated.
- **Prioritized action list** — renders the existing free `projectedGrade.ledger` (`FixDiagnosis[]`,
  sorted by `marginalDelta` — never summed, disclaimer rendered; SPEC 02 §3 discipline unchanged). Cures
  stay gated exactly as today (`prescriptions` never serialized to free viewers — SPEC 02 §11).
- **Methodology + confidence** — the crawl-health/`ConfidenceBand` rendered honestly ("based on N of ~M
  pages — {confidence}"), the §3 disclaimer footer, and the mint timestamp.
- **Section-slot layout** — the report body is an ordered array of self-contained sections (summary,
  grade, graph, findings, actions, methodology) so SPEC 05 adds its AI-readiness section additively.
- **PDF = print stylesheet.** A dedicated `@media print` design (page breaks, header/footer with branding)
  and a "Download PDF" affordance using the browser print path. **No server-side PDF rendering in v1**
  (COGS ceiling); revisit only with metering if agencies demand pixel-perfect exports.
- **XSS:** every crawled string (titles, URLs, anchors) escaped at render; no `dangerouslySetInnerHTML`
  with crawled content (SPEC 03 §10 discipline).

Public reports remain **immutable snapshots** of their audit (non-regression #6): the report renders the
minted audit's data forever; "re-audit for a fresh report" is the refresh path, never in-place mutation.
**Clarification codified by this spec:** immutability covers the *audit snapshot* (grade, score, findings,
graph). *Visibility & presentation metadata* (`listed`, `indexable`, `hiddenAt`, `whiteLabel`) are
owner-mutable — flipping the white-label toggle or claiming a report is not a snapshot mutation.

## 5. White-label on Pro — the first paid agency lever  *(approved entitlement change)*

- **What it does:** a claimed report owned by a Pro user gets a branding toggle — `WhiteLabelConfig`
  replaces the Crawlmouse wordmark/branding with `brandName` (+ optional logo) on the report page **and**
  the print/PDF output **and** that report's OG card. Free/unclaimed reports always carry Crawlmouse
  branding — that asymmetry IS the business model (Calendly/Typeform pattern).
- **Honest limits, stated in-product:** the URL remains `crawlmouse.com/r/…` (custom domains are the
  future agency-tier lever, out of scope). White-label reports default to **unlisted + noindex** — they are
  client deliverables, not viral artifacts; the owner may still list/index them explicitly.
- **The entitlement change (the one approved contract edit):** `entitlementFor` in
  `apps/web/lib/entitlement.ts` changes `canWhiteLabel` from `tier === 'agency'` to `paid` (pro or agency).
  Update the type's doc comment in `packages/types/src/audit.ts` and the C11-adjacent tests. Server-side
  enforcement only; the toggle API verifies claim + entitlement on every write.
- **Logo upload (tight v1):** PNG/JPEG/WebP only, ≤ 200 KB, server-side magic-byte + decode validation
  (**no SVG — XSS**), stored in Supabase storage under a service-role-only bucket, served via our domain
  with immutable cache headers. Upload is claim+Pro-gated, so the abuse surface is a paying, identified
  customer. Rate-limit uploads.
- **Market calibration (for the record):** white-label at $19 sits at the floor of the market (SEOptimer
  $19–39; most suites $49–239). Deliberate penetration pricing; the agency tier stays in reserve — measure
  adoption (§13/§14) before pricing moves.

## 6. The share moment & OG cards  *(amplify the peak; change little)*

- **Timing:** share affordances surface at the **grade-reveal peak** (SPEC 03's choreography beat 2), plus
  on the minted report. The existing grade-adaptive copy in `share-intents.ts` (`PROUD_THRESHOLD = 70`;
  brag frame vs. curiosity frame) is the right mechanic — keep it; add a "mint + share" one-step path so
  the reveal moment can produce a clean `/r/` link (not the private capability URL) in one action.
- **Share text stays engine-data-only** (grade/score — never crawled content) — an existing safety property
  to preserve.
- **OG cards:** verify/upgrade `r/[slug]/opengraph-image.tsx` — 1200×630, grade + domain + score + brand
  (or white-label brand) on the card, CDN-cached, deterministic per report. Confirm the OG route is
  fetchable by social crawlers despite noindex pages (noindex ≠ no unfurl) and that it cannot be abused as
  a free image-rendering endpoint (slug-scoped only, cache headers). Attribution `?ref=` params on all
  shared/embedded links for K measurement (§13).

## 7. The SEO-safe badge  *(compliance as a trust feature)*

- The current badge is an **iframe** route (`embed/[domain]/route.ts`) with `x-robots-tag: noindex` — an
  `<iframe src>` is not a link, so the embedder takes **no link-scheme risk**. Preserve this architecture.
- If any anchor-based embed variant (static image + `<a>`) is added, it MUST ship `rel="nofollow ugc"`
  with a brand-name anchor ("Graded by Crawlmouse" — never keyword-rich). Google's 2016 widget-link rule;
  both the widget maker and embedder are exposed otherwise. **Never** offer a dofollow badge as a perk.
- Market it honestly: "SEO-safe badge — embedding this cannot hurt your rankings." Compliance becomes a
  differentiator consistent with honesty-first positioning.
- Badge resolution becomes **claimed-reports-only** (§3). The `increment_embed_view` counter and CDN cache
  behavior are preserved (cost ceiling).

## 8. Indexing policy & the flywheel  *(claim-gated indexing; conservative by design)*

The programmatic-SEO flywheel is real (Zapier/NerdWallet class), but Google's 2024+ **scaled content
abuse** enforcement makes "index every minted page" the dangerous path for a domain our size. Policy:

- **Unclaimed reports: `noindex`, unlisted, not in the sitemap.** Fully shareable and unfurl-able.
- **Claimed reports: indexable + listed** (owner can opt out), and **added to a `/r/` sitemap section**
  (closing the existing gap — `app/sitemap.ts` currently contains no `/r/` URLs). Claimed reports carry
  unique per-site data + an invested owner — exactly the "valuable programmatic page" profile.
- **Leaderboards (`/top/[platform]`)**: stay **opt-in** (`opt_in_leaderboard`) and become **claim-gated**;
  ISR caching (`revalidate = 300`, `LEADERBOARD_SIZE = 50`) unchanged. Leaderboards are a supporting
  flourish, not the engine — no further investment beyond claim-gating this phase.
- **Compare (`/compare/[a]/[b]`)**: the curiosity share surface — invest here over leaderboards. Indexable
  only when **both** sides are claimed; otherwise noindex but shareable.
- **Monitoring:** watch Search Console coverage; if "crawled – not indexed" piles up on report pages or any
  manual-action signal appears, tighten the threshold (this is a one-flag policy change by design).

## 9. The claim flow — moderation backbone + conversion hook

- **"Claim this report"** on every unclaimed report: signup (existing magic-link/`token_hash` auth) +
  the **existing** domain-verification flow (`app/api/verify/*` — reuse, don't rebuild) → sets `claimed`,
  links ownership, unlocks: listing, indexing opt-in, leaderboard opt-in, badge resolution, and (if Pro)
  the white-label toggle. Claiming is the natural Pro-upsell moment ("make it yours — add your brand").
- Anonymous audits already claim on signup (`lib/anon-session.ts` + claim flow — preserve); report-claim
  composes with it, never replaces it.
- **Dispute/hide:** the minter can hide their own mint; a site owner who won't sign up still has the
  takedown path (preserved, linked in the footer). Hidden reports 404 publicly; slugs are never reused.

## 10. Data model & migrations  *(additive, RLS-correct)*

Additive migrations in `infra/supabase/migrations/` (timestamped, nullable, backfilled), applied via the
Supabase Management API/MCP **by the owner** (runbook, not autonomous execution):

- **`public_reports`**: add `claimed_at timestamptz null`, `listed boolean not null default false`,
  `indexable boolean not null default false`, `hidden_at timestamptz null`, `white_label jsonb null`,
  `minted_by uuid null` (nullable — anonymous mints). **Backfill:** existing rows (all verified today)
  get `claimed_at = created_at`, `listed = true`, `indexable = true` — cutover is behavior-preserving.
- **Snapshot columns stay immutable** (non-regression #6); only the visibility/presentation columns above
  are owner-mutable, via server routes that verify claim + entitlement (never direct PostgREST writes —
  service-role pattern like `fixes`).
- **RLS deny-by-default** on every touched surface; public report reads continue through the existing
  admin/capability read paths; no `user_id` on the wire.
- **Storage:** a `report-logos` bucket, service-role write, public read via our CDN path only.
- **Progress emission (§2):** the lower-risk of (a) nullable progress columns on `audits` updated in
  batches, or (b) a sidecar activity table with TTL cleanup. Decide in the plan; either is additive.

## 11. Security requirements  *(non-negotiable)*

- **XSS:** crawled strings on reports, activity feed, OG cards, and exec summaries are attacker-controlled;
  escape at render (`lib/html-escape.ts`); no `dangerouslySetInnerHTML` with crawled content.
- **SSRF / safe-fetch unchanged** — this spec adds **no new outbound fetch path**. Logo upload is inbound
  only, validated (magic bytes, decode, size, type allowlist, no SVG).
- **Server-side gating:** white-label writes verify claim + `canWhiteLabel`; visibility writes verify
  claim; mint verifies Turnstile + rate limits; nothing trusts client-asserted state.
- **Abuse:** anonymous mint per-IP caps; email-when-done per-IP/per-email caps + neutral content; OG route
  slug-scoped + cached; badge remains CDN-cached (`global:audits:day` fail-closed untouched).
- **Privacy:** no emails or `user_id`s ever surface on public reports; `minted_by` never serialized.

## 12. Non-regression contract  *(MUST NOT change without explicit sign-off — CLAUDE.md §5)*

1. **SSRF guard / `safe-fetch`** — no new unguarded fetch path.
2. **RLS deny-by-default + capability-URL admin reads**; anon-audit + claim-on-signup flow.
3. **Four grade components & weights + A–F / 0–100** — reports render engine output; never re-derive.
4. **SPEC 01 R1 determinism** — grade, ledger, OG card, exec summary all deterministic per audit.
5. **Minted snapshot immutability** (as clarified in §4 — visibility metadata excluded by definition).
6. **JS/SPA detector + orphan suppression** (SPEC 05's seam) — untouched.
7. **Turnstile + per-IP/domain/global rate limits**; `global:audits:day` fail-closed.
8. **Crawlee memory hint + direct-`crawlee` dependency**; `maxDuration=300`; Inngest concurrency env-driven.
9. **Existing takedown flow**; **`PASSING_SCORE = 60` untouched**; share text stays engine-data-only.
10. **SPEC 02 cure gating** (`prescriptions`/`monitoring` never serialized to free viewers) — reports obey
    the same projection discipline.

## 13. Observability  *(measure the loop honestly — SPEC 00 §4)*

Extend `lib/analytics-events.ts` (coordinate names; one funnel): `report_minted`, `report_claimed`,
`report_hidden`, `whitelabel_enabled`, `report_pdf_printed`, `share_completed` (channel prop, extends
`public-share-clicked`), `compare_viewed`, `leaderboard_opt_in`, `wait_email_captured` (or reuse
`email-captured` with a source prop), `activity_feed_first_event` (time-to-first-value), plus attribution:
`?ref=` on shared/badge/report links → landing captures referral source. **K is measured, not assumed:**
K = new audits attributed to shared artifacts ÷ audits whose owners shared; report it in the §14 readout.
PostHog sampling + geo-gated consent preserved. Sentry breadcrumbs on mint/claim/upload paths.

## 14. Definition of success  *(the achieved state — what "done and working" means)*

**Ship-complete** = all §15 tests pass, deployed, events firing. **Success** = the following, read out in
PostHog over the 2–3 weeks post-ship (baselines: activation ~3–5%, share ≈ 0, mint ≈ 0 anonymous):

| Metric | Baseline | Target | Owning section |
|---|---|---|---|
| Audit-submitted → grade-revealed completion (wait survival) | unmeasured (bounce complaints) | **≥ 85%** | §2 |
| Time-to-first-value (submit → first activity/graph node) | minutes | **< 10s p75** | §2 |
| Landing → audit-completed (activation, SPEC 00) | ~3–5% | **≥ 30%** (trend toward) | §2 |
| Audit-completed → share action | ~0 | **≥ 15%** | §6 |
| Completed audits that mint a report | ~0 (verified-only) | **≥ 25%** | §3 |
| Mint → claim rate | n/a | **≥ 10%** | §9 |
| Measured K (attributed new audits per sharing user) | unmeasured | **reported honestly; 0.15–0.4 = healthy** | §13 |
| Pro users enabling white-label | n/a | **≥ 30% of active Pro** (validates the agency thesis) | §5 |
| Search Console: no scaled-content/manual-action signals on `/r/` | clean | **stays clean** | §8 |

Misses trigger investigation of the owning section, not silent target edits. The K readout explicitly
frames the loop as an amplifier (K < 1 expected) — no self-sustaining-growth claims.

## 15. Testing & acceptance criteria  *(TDD — failing tests first, per CLAUDE.md §3)*

Co-located vitest/component tests per repo convention; `pnpm test` / `typecheck` / `lint`; all existing
guards (blog-guard, seo-jsonld-guard, positioning-and-honesty-guard, seo-robots-sitemap-guard) green; live
smoke **on the deployed function**; 3×-reviewer adversarial gate (≥9 all four lenses, 0 blocking).

| # | Test | Pass condition | Covers |
|---|---|---|---|
| V1 | Honest progress | Progress/activity advance ONLY on real pipeline events (fixture: stalled crawl → honest stall state, no timer motion); grade never renders before engine completion | §2 |
| V2 | Activity feed XSS (SECURITY) | Malicious crawled titles/URLs render escaped in feed, report, OG, exec summary | §2, §11 |
| V3 | Email-when-done abuse | Per-IP + per-email caps enforced; neutral content; event fires | §2, §11 |
| V4 | Anonymous mint | Unauthed mint with capability URL succeeds; Turnstile + per-IP caps enforced; idempotent per audit | §3 |
| V5 | Guardrail trio | Unclaimed report = noindex + unlisted + disclaimer/timestamp/dispute rendered; hidden report 404s | §3, §8 |
| V6 | Badge integrity | Badge/compare/leaderboard resolve CLAIMED reports only; a fresh unclaimed third-party mint does NOT change a domain's badge | §3, §7 |
| V7 | Client-ready report | Exec summary + plain-language findings + prioritized ledger + methodology render deterministically; same audit → byte-identical summary; ledger never summed | §4 |
| V8 | Print/PDF | Print stylesheet produces a complete branded (or white-labeled) document; no gated cure content leaks into free print output | §4, §5 |
| V9 | White-label gating (SECURITY) | Toggle write requires claim + Pro server-side; free/unclaimed attempts rejected; `canWhiteLabel` true for pro + agency, false for free; branding swaps on page/PDF/OG | §5 |
| V10 | Logo upload (SECURITY) | Rejects SVG/oversize/spoofed magic bytes; accepts valid PNG/JPEG/WebP; stored + served per §10 | §5, §11 |
| V11 | Mint+share at reveal | One-step mint+share yields a `/r/` URL (never the capability URL) with correct grade-adaptive text; `?ref=` attribution present | §6, §13 |
| V12 | OG card | 1200×630, grade+domain+score (+white-label brand when set), deterministic, cached, slug-scoped | §6 |
| V13 | Indexing policy | Claimed → `index:true` + in sitemap `/r/` section; unclaimed → noindex + absent from sitemap; compare indexable only when both claimed; existing rows backfilled claimed/listed/indexable | §8, §10 |
| V14 | Claim flow | Claim via existing verification sets `claimed_at`, unlocks listing/leaderboard/badge/white-label; anon-audit claim-on-signup still works | §9 |
| V15 | Migrations + RLS (SECURITY) | Additive columns backfill; new bucket/table deny-by-default; visibility writes only via claim-verified server routes; snapshot columns immutable | §10 |
| V16 | Non-regression suite | §12 intact; all existing tests + guards green; Turnstile/rate-limit/takedown flows unchanged | §12 |
| V17 | Stress: mint/OG flood | Scripted burst of anon mints + OG fetches → rate limits hold, no cost blowout (CDN cache hit ratio verified), `global:audits:day` fail-closed intact | §3, §11 |
| V18 | Live smoke (deployed) | Full loop on the deployed function: submit → honest wait (activity < 10s) → grade → mint (no auth) → share URL unfurls → claim → white-label (Pro) → badge shows claimed report. On static + throttling-WP + JS/SPA sites | DoD |

## 16. Out of scope for SPEC 04
Agency tier, team seats, custom report domains. Server-side PDF rendering. Referral incentive programs.
Auto-posting of any kind (never). AI-readiness score/content (SPEC 05). Scheduled monitoring + email deltas
(SPEC 06). Engine/grading changes, JS rendering, LLM calls (D2/D3 hold). Crawl *speed* optimization (the
politeness/budget model of SPEC 01 §5 is untouched — this spec fixes the *experienced* wait).

## 17. Build sequence & STOP gates  *(plan-mode; STOP for approval per CLAUDE.md §3)*

1. **Restate scope + plan** against the real repo (verify every reference; flag mismatches, incl. the
   §2 progress-emission mechanism choice and the anonymous-mint cap constant). **STOP for plan approval.**
2. **Stage A — §2 the wait** (worker emission → SSE → UI feed/progress/email-valve) → V1–V3.
   **STOP: owner reviews the live wait experience on a real slow site before proceeding.**
3. **Stage B — §3 mint + §4 report + §10 migrations** (migrations run by owner via runbook) → V4–V8, V13
   partial, V15. **STOP: owner reviews an unclaimed public report end-to-end (disclaimers, noindex).**
4. **Stage C — §9 claim + §8 indexing/sitemap + §7 badge integrity** → V6, V13, V14.
5. **Stage D — §5 white-label (entitlement change + toggle + logo + PDF/OG branding)** → V9, V10.
   **STOP: owner reviews the white-labeled report as a Pro user.**
6. **Stage E — §6 share/OG polish + §13 events + V17 stress + full suite + live smoke (deployed) + 3×
   adversarial gate.** Open the PR. **STOP — no merge to `main` without owner approval.**

## 18. Git / workflow
- Branch `viral/spec-04-loop` in its own worktree off a fresh `origin/main`; Terminal 1 only; small
  conventional commits; PR; **never self-merge; never push without the review gate + live smoke + owner
  go.** Show the full diff before any push.
- **No AI references anywhere** in commits/PRs/code/comments; strip any `Co-Authored-By` (CLAUDE.md §7).
- `nvm use 22`; `turbo.json build.env` lists every new build-time env var; route-segment exports static.
- MCPs for reading real data (Supabase schema, PostHog funnel, Sentry, Vercel logs). **All
  production-touching actions (migrations, env vars, flags, storage buckets) go to the owner as runbooks.**
- Report progress with real `file:line` references; surface spec/code mismatches — and any contract-type
  change — **before** acting.
