# SPEC 05 — AI / Agent-Readiness Score (Phase 4)

> **Read `00-crawlmouse-master-build-plan.md`, `PROJECT_OVERVIEW.md`, and `CLAUDE.md` first.** This spec
> serves the conversion spine (SPEC 00 §2) at THE WOW (a second headline score on the same crawl), THE GAP
> (per-page AI-blindness made visceral), and THE WALL (whole-site simulator + AI action packets + the
> llms.txt artifact on Pro). It is built on an explicit two-pass evidence base (technical research +
> commercial stress test, 2026-07): the major AI crawlers — GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot,
> Claude-SearchBot, PerplexityBot — fetch raw HTML and **do not execute JavaScript** (Vercel/MERJ log
> analysis, 500M+ fetches); llms.txt is **not consumed by any AI search engine** (Ahrefs 137K-domain study:
> 97% of files got zero requests; Google's Mueller/Illyes on record); schema evidence is **contested**
> (Microsoft confirms Copilot use; Ahrefs' controlled study found no citation uplift). Every component
> below scores only what is measurable, deterministic, and honestly claimable. **We sell discoverability
> and machine-legibility — never AI rankings.**
>
> **Status:** Phase 4. Runs on **Terminal 2** (branch `ai/spec-05-readiness`, own worktree off a fresh
> `origin/main`). SPEC 04 runs in parallel on Terminal 1 (`viral/spec-04-loop`, unmerged) — see §0
> coordination rules. The report-section mount (§10) happens ONLY after SPEC 04 merges.
>
> **Owner decisions locked into this spec:** (1) the AI Readiness Score is a **sibling 0–100 score** —
> the four-component A–F linking grade and its weights are untouched; (2) component weights
> **Access 25 / Content-Without-JS 40 / Machine Legibility 20 / Retrieval Path 15**; (3) llms.txt is
> **informational, zero weight**; the Pro tier ships an honest llms.txt **generator** artifact;
> (4) free = full diagnosis + homepage "What AI Sees"; Pro = whole-site simulator + AI action packets +
> generator + the AI section in the white-label client report; (5) **no AI-visibility rank tracking** —
> no LLM calls, no prompt-running (D2/D3 hold); (6) the score is **history-ready by construction**
> (persisted per audit, stable finding ids) but the history dashboard itself is SPEC 06.
>
> **Implementer note (mandatory, per CLAUDE.md §3):** verify every file/function/table/column name against
> the live repo before editing. References below were read from `main` @ `e15589d` and reconciled with the
> SPEC 04 Terminal-1 status (branch @ `9248201`); re-confirm in-code — especially anything SPEC 04 has
> since merged — and flag mismatches before writing implementation. **Do not assume.**

---

## 0. What this spec delivers, and the coordination rules

**Delivers, in spine order:**
1. **Per-page AI-legibility extraction at parse time** (§4) — main-content extraction + per-page
   readable/partial/js_blind/thin classification + a bounded "What AI Sees" excerpt, computed inside the
   existing single cheerio parse (`extractPage` already receives the parsed `$` — `crawler.ts:400`).
2. **The AI Crawler Access matrix** (§3) — per-bot, per-page robots.txt access ratios computed from the
   already-parsed `ParsedRobots` (zero new fetches), retrieval-class vs training-class distinguished,
   with the CDN/WAF blind-spot disclosure no competitor makes.
3. **Machine Legibility signals** (§5) — headings, landmarks, JSON-LD validity, metadata-in-raw-HTML,
   homepage entity check. All parse-time, all deterministic.
4. **Retrieval Path** (§6) — the moat cross: the existing link graph joined with per-page legibility
   ("AI-readable but orphaned", "readable but buried at depth 5").
5. **The AI Readiness Score** (§7) — 0–100 sibling score, crawl-health-caveated, deterministic (R1),
   with per-component breakdown and honest evidence labels.
6. **llms.txt check** (§8) — the one authorized new fetch; informational badge, zero weight.
7. **Free/Pro gating + Pro artifacts** (§9) — SPEC 02's wall inversion applied: full diagnosis free
   (incl. homepage What-AI-Sees); Pro gets the whole-site simulator, deterministic AI action packets,
   and the PageRank-ordered llms.txt generator.
8. **The report section** (§10) — mounts additively into SPEC 04's frozen section-slot layout,
   diagnostic-only, denormalized into the snapshot at mint.

**Terminal / parallel rules:**
- **Branch:** `ai/spec-05-readiness` in its own git worktree off a **fresh `origin/main`** (not a stale
  local `main`). `nvm use 22`. This terminal holds **only SPEC 05** in context.
- **SPEC 04 coordination:** SPEC 04 (`viral/spec-04-loop`) is unmerged and in active build on Terminal 1.
  Stages 1–5 of this spec (§17) touch nothing SPEC 04 owns and build off `main` independently. **Stage 6
  (the report section, §10) is gated on SPEC 04 merging to `main` first** — this branch then rebases onto
  updated `main` and mounts its section into the sections array of `apps/web/app/r/[slug]/page.tsx`
  **additively, with zero edits to SPEC 04's components**. If both specs need to land a change to the same
  file, STOP and raise it — never race Terminal 1.
- **File ownership — SPEC 05 owns and may edit/create:** `packages/engine/src/analysis/ai-readiness/**`
  (new), additive edits to `packages/engine/src/extract.ts`, `packages/engine/src/audit.ts`,
  `packages/engine/src/constants.ts`, `packages/types/src/**` (additive only),
  `apps/web/lib/ai-readiness*` (new), additive extension of `apps/web/lib/audit-stream-projection.ts`,
  new components under `apps/web/components/ai/**`, its own API routes (packet/generator), and its own
  migrations in `infra/supabase/migrations/**`. **Do not touch:** SPEC 04's surfaces (`app/r/**`,
  `compare/**`, `top/**`, `embed/**`, `components/share/**`, mint/claim routes, wait components) except
  the Stage-6 additive section mount; the crawler/politeness/budget logic in `crawler.ts`; `grade.ts`
  weights; `ssrf-guard.ts`/`safe-fetch.ts` internals; SPEC 02's projection gating semantics. If you
  believe you must, STOP and ask.
- **Engine discipline:** the additive `extractPage` signal extraction, the additive `audit.ts` assembly,
  and the **one** llms.txt fetch (§8) are the only authorized engine changes. Crawl frontier, politeness,
  budgets, SSRF guard, and the site-level JS detector's grade behavior are untouched (§13).

---

## 1. SHARED DATA CONTRACT (additive; lives in `packages/types/src/`)

Additive types only — nothing existing changes shape (the SPEC 04 rule holds). Verify names against
`packages/types/src/audit.ts` before adding.

```ts
// ── Per-page AI-legibility (§4). Extracted at parse time; persisted per page. ──
export type AiPageClass = 'readable' | 'partial' | 'js_blind' | 'thin';

export interface PageAiSignals {
  pageClass: AiPageClass;
  mainTextChars: number;            // extracted main-content text length AFTER density filtering
  excerpt: string;                  // bounded (§4.4) post-filter main-content text — the "What AI Sees" view
  csrSignals: string[];             // which affirmative CSR signals fired (annotation, e.g. 'empty_mount:__next')
  frameworkMarker: string | null;   // e.g. 'nextjs' | 'nuxt' | 'react' | null — EXPLANATION, never a verdict
  hasTitle: boolean;
  hasMetaDescription: boolean;
  h1Count: number;
  headingLevelsSkipped: boolean;
  hasMainLandmark: boolean;         // <main> | <article> | [role="main"]
  jsonLd: { present: boolean; valid: boolean; types: string[] };  // parse-validated @type list
}

// ── AI crawler access (§3). Computed from ParsedRobots we already hold. ──
export type AiBotClass = 'retrieval' | 'training' | 'opt_out_token';

export interface AiBotAccess {
  token: string;                    // e.g. 'GPTBot'
  operator: string;                 // e.g. 'OpenAI'
  botClass: AiBotClass;
  allowedPageRatio: number;         // 0..1 — fraction of eligible pages this token may fetch per robots
  fullyBlocked: boolean;            // wildcard/site-wide disallow
  note: string;                     // precise plain-language description (opt-out tokens described exactly)
}

export interface AiAccessMatrix {
  bots: AiBotAccess[];
  robotsTxtFound: boolean;          // absent robots ⇒ all allowed, noted
  wafDetected: boolean;             // Cloudflare/known-WAF headers seen — DISCLOSURE ONLY, never scored
  wafNote: string | null;           // "robots.txt allows these bots, but edge-level blocking may override…"
}

// ── llms.txt (§8). Informational, ZERO score weight. ──
export interface LlmsTxtStatus {
  present: boolean;
  parseable: boolean;               // basic markdown-spec shape check (H1 + link lists)
  note: string;                     // "Not consumed by AI search engines as of 2026; used by coding agents."
}

// ── AI findings (§7). Self-contained — NOT FindingCategory entries; zero risk to existing renderers. ──
export type AiFindingKind =
  | 'js_blind_page' | 'partial_js_page'
  | 'retrieval_bot_blocked' | 'training_bot_blocked'
  | 'readable_but_orphaned' | 'readable_but_deep'
  | 'missing_structured_data' | 'invalid_structured_data'
  | 'heading_structure' | 'missing_metadata' | 'missing_entity_link'
  | 'thin_page' | 'llms_txt_absent';
export interface AiFinding {
  id: string;                       // STABLE deterministic id: hash(kind + canonical target) — history-ready
  kind: AiFindingKind;
  severity: 'high' | 'medium' | 'info';
  targetUrl: string | null;         // null for site-level findings
  targetTitle: string | null;
  plainLanguage: string;            // client-explainable "what this means / why it matters" (escaped at render)
  evidence: 'strong' | 'moderate' | 'contested' | 'informational';  // the honesty label, rendered
}

// ── The score (§7). A SIBLING of the grade — never blended, never re-weighted into it. ──
export interface AiReadinessScore {
  score: number;                    // 0..100, deterministic
  band: 'ready' | 'partial' | 'at_risk';   // thresholds in constants (§7)
  components: {
    access: { score: number; weight: 25 };
    contentWithoutJs: { score: number; weight: 40 };
    machineLegibility: { score: number; weight: 20 };
    retrievalPath: { score: number; weight: 15 };
  };
  confidence: Confidence;           // mirrored from crawl-health; low/medium ⇒ estimate framing
  isEstimate: boolean;
  basis: { pagesAnalyzed: number; siteJsRendered: boolean; retrievalPathBasis: 'full' | 'depth_only' };
  findings: AiFinding[];            // the full ledger — FREE (diagnosis is never gated)
  accessMatrix: AiAccessMatrix;
  llmsTxt: LlmsTxtStatus;
  asOf: string;                     // ISO — evidence table snapshot date, rendered ("crawler behavior as of…")
}

// ── Client projection (additive on ClientAuditV2; gated fields server-side, SPEC 02 §11 discipline). ──
export interface WhatAiSeesPage { url: string; title: string | null; pageClass: AiPageClass; excerpt: string; mainTextChars: number; }
export interface AiReadinessClient {
  score: AiReadinessScore;                    // FREE — full diagnosis, full ledger, matrix, llms.txt status
  homepageView: WhatAiSeesPage | null;        // FREE — the wow: what AI sees on the homepage
  whatAiSees: WhatAiSeesPage[] | null;        // GATED (Pro owner): the whole-site simulator; null for free
  aiPackets: ActionPacket[] | null;           // GATED (Pro owner): deterministic AI-fix packets; null for free
  hasMoreAiPackets: boolean;                  // the wall's SHAPE without leaking the cure
}
// ClientAuditV2 gains ONE additive field:  aiReadiness: AiReadinessClient | null;
```

**Gating summary:** `score` (full ledger + matrix + llms.txt status) and `homepageView` are **free** —
the diagnosis is never capped (SPEC 02 §6 inversion). `whatAiSees` (all pages) and `aiPackets` are
**Pro-owner gated, never serialized to free viewers**. The public-report AI section (§10) is
**diagnostic-only**: packets/simulator never enter the snapshot (SPEC 04's structural cure-gating holds).

---

## 2. Evidence discipline & honesty rules (non-negotiable, renders in-product)

- Every component and finding carries an **evidence label** (`strong` / `moderate` / `contested` /
  `informational`) rendered in the UI and report. Access + Content-Without-JS are `strong` (direct log
  evidence); Legibility signals are `moderate` (JSON-LD `contested` — cite both Microsoft's confirmation
  and Ahrefs' null result in the methodology copy); llms.txt is `informational`.
- **Claims wording:** "machine-legibility", "discoverability", "what a non-rendering AI crawler can read".
  **Never** "AI rankings", "GEO score", "will be cited by ChatGPT". The positioning-and-honesty-guard
  should be extended to pin the banned phrases (test A16).
- **The WAF disclosure:** when Cloudflare/known-WAF response headers are detected, every access rendering
  carries: "robots.txt allows these bots, but edge/CDN-level blocking cannot be detected from static
  analysis and may override this." Detection is disclosure-only — it never moves the score.
- **Opt-out tokens described precisely:** Google-Extended and Applebot-Extended are *training/grounding
  opt-out tokens applied to the operator's main crawler*, not crawlers — the matrix says so.
- **The score is dated:** `asOf` renders ("crawler behavior verified as of {date}") — the JS-rendering
  table is a snapshot, and we say so.

## 3. Component 1 — AI Crawler Access (weight 25)  *(zero new fetches)*

`robots.ts` already parses **all** UA groups per RFC 9309 and `discoverSitemaps` returns the
`ParsedRobots` into `audit.ts` (~:186 — verify). This component interrogates rules we already hold.

- **Bot registry** (constants, single source): retrieval class — `OAI-SearchBot`, `ChatGPT-User`,
  `Claude-SearchBot`, `Claude-User`, `PerplexityBot`, `Perplexity-User`; training class — `GPTBot`,
  `ClaudeBot`, `CCBot`, `Meta-ExternalAgent`, `Bytespider`, `Amazonbot`; opt-out tokens —
  `Google-Extended`, `Applebot-Extended`.
- **Per-bot, per-page:** for each token, evaluate the existing robots matcher against every **eligible
  (200) node's** path → `allowedPageRatio`. This is the whole-site move no page-level checker can make
  ("GPTBot can access 71% of your pages"). O(rules × pages × bots) with the existing linear matcher —
  bounded and cheap; confirm matcher signature in `robots.ts` before wiring.
- **Scoring:** the component subscore = **mean `allowedPageRatio` over the retrieval class only.**
  Training-class blocks are a legitimate owner policy: reported in the matrix + an `info`/`medium`
  finding, **not scored**. Blocking OAI-SearchBot costs citations; blocking GPTBot is a choice.
- **No robots.txt** ⇒ all ratios 1.0, `robotsTxtFound: false`, noted plainly.
- **WAF detection:** homepage response headers (the CMS detector already consumes `headerPatterns` —
  reuse that capture path; verify in `cms-detection/`) matched against a high-precision allowlist
  (`server: cloudflare`, `cf-ray`, + a tested handful). Sets `wafDetected` — disclosure only (§2).

## 4. Component 2 — Content Without JavaScript (weight 40)  *(the flagship; per-page, parse-time)*

**Evidence:** Vercel/MERJ (500M+ GPTBot fetches): the major AI crawlers download JS but **never execute
it**. SSR'd Next/Nuxt pages ARE readable (content is in the initial HTML); the problem is CSR shells.
Today's detector (`analysis/js-detect.ts`) is site-level and binary; `jsOnly` in graph assembly is
derived (`siteJsRendered && inboundCount === 0`). This spec adds **per-page** classification — additive;
the site-level detector and its orphan suppression keep driving the grade exactly as today (§13).

### 4.1 Main-content extraction (deterministic, in-parse)
Runs inside `extractPage` on the `$` the crawler already passes (no second `cheerio.load` — the
double-parse was deliberately eliminated; preserve that):
1. **Structural strip:** remove `nav`, `footer`, `header`, `aside`, `script`, `style`, `noscript`,
   `[role="navigation"]`, plus the existing NON-CONTENT selector set (verify its name/location).
2. **CMP strip (high-precision allowlist, NO wildcards):** `#onetrust-consent-sdk`,
   `#CybotCookiebotDialog`, `.cc-window`, + a small tested list in `constants.ts`, fixture-pinned.
   Broad `[class*="banner"]`-style matches are **banned** (they strip hero content; repo signature
   philosophy: high-precision only). Note: most CMPs inject client-side and barely exist in static HTML.
3. **Block density scoring (Kohlschütter shallow features):** per candidate block, text length + link
   density; drop high-link-density boilerplate blocks; concatenate surviving text.
Output: `mainTextChars` + the filtered text stream. Cost O(page) inside the existing parse.

### 4.2 Per-page classification — the dual gate
**Extracted text is the verdict; framework markers are only the explanation.**
- `mainTextChars >= MIN_MAIN_TEXT_CHARS` (default **200**, constants, fixture-tuned) → **`readable`**
  (markers annotate: "Next.js detected — server-rendered, readable").
- Else, evaluate **affirmative per-page CSR signals** (per-page adaptation of the detector's three
  branches: known empty mount node `#root|#app|#__next|#__nuxt` with no text; noscript-JS notice;
  empty-shell-with-bundle): if signals fire → `mainTextChars < PARTIAL_FLOOR` (default **50**) ⇒
  **`js_blind`**, else **`partial`** (the `__NEXT_DATA__`-present-but-body-fetched-in-useEffect loophole
  lands here or in js_blind — the text gate catches it regardless of the marker).
- Else → **`thin`** — low text with **no** CSR evidence is a thin page, not a blind one (a contact page
  must never be called JS-blind). Conservative bias preserved.

### 4.3 Scoring
Subscore = mean over eligible nodes of: `readable` 1.0, `thin` 1.0 (no JS problem — separate `info`
finding), `partial` 0.5, `js_blind` 0. Findings: `js_blind_page` (high) / `partial_js_page` (medium)
per page, with the framework annotation in `plainLanguage`.

### 4.4 The excerpt ("What AI Sees")
First `EXCERPT_MAX_CHARS` (default **2000**) of the **post-density-filter** main-content text, truncated
at a word boundary, deterministic. **Never a raw-HTML slice.** ~1MB per 500-page audit — inside the cost
ceiling; excerpts ride the existing pages persistence + the 30-day free-audit TTL.

## 5. Component 3 — Machine Legibility (weight 20)

Per-page binary checks (all parse-time, from `PageAiSignals`): title present; meta description present;
exactly one H1; no skipped heading levels; `main`/`article`/`[role=main]` landmark; JSON-LD present AND
parse-valid (`JSON.parse` of every `script[type="application/ld+json"]`; collect `@type`s; malformed ⇒
`invalid_structured_data` finding). Page score = mean of checks; component = mean over pages, **excluding
`js_blind` pages from the denominator** (checking the legibility of an empty shell double-punishes).
Plus one site-level sub-signal: **homepage entity check** — `Organization` or `WebSite` JSON-LD with a
non-empty `sameAs` array (worded as entity connection, `moderate` evidence; `missing_entity_link` info
finding). Exact sub-weights proposed in the plan with these defaults; constants-pinned.

## 6. Component 4 — Retrieval Path (weight 15)  *(the moat cross)*

Pure join over data already computed — zero new crawling. Over pages classed `readable`/`thin`:
fraction that are **non-orphan AND depth ≤ 3**. Findings: `readable_but_orphaned` (high — "this page is
AI-readable but nothing links to it") and `readable_but_deep` (medium). **Interplay:** when the
site-level JS detector suppresses orphan marking (verify the suppression site in `audit.ts` ~:114),
orphan data is absent — the subscore computes on a **depth-only basis**, `basis.retrievalPathBasis =
'depth_only'`, honesty-noted in the UI. This is exactly the site that most needs the JS-blind message,
so the score must still compute.

## 7. The score — assembly, bands, caveats, history-readiness

- `score = 0.25·access + 0.40·contentWithoutJs + 0.20·legibility + 0.15·retrievalPath`, ×100, rounded
  half-up. Bands: `ready ≥ 80`, `partial 50–79`, `at_risk < 50` (constants).
- **Deterministic (R1):** same audit inputs → identical score, breakdown, findings, excerpt bytes.
- **Crawl-health caveat:** `confidence` mirrors the audit's crawl-health; `isEstimate = partial ||
  confidence !== 'high'` — rendered with the same estimate framing as the ConfidenceBand. Never a
  confident verdict on a poorly-reached crawl.
- **Sibling, never blended:** the A–F grade, its four components, and weights are untouched. The AI score
  renders beside the grade, never inside it.
- **History-ready by construction (SPEC 06 seam — build no dashboard):** the score + breakdown persist
  per audit (§11); `AiFinding.id` is stable/deterministic so resolved-vs-new diffing works across
  re-audits; the shape slots additively into `MonitoringDelta`/`DashboardSite.history` later. Zero
  monitoring UI in this spec.

## 8. llms.txt — the one authorized new fetch  *(informational; ZERO weight)*

- Fetch `origin + '/llms.txt'` **once per audit**, through the **same guarded fetcher/SSRF path as
  robots.txt** (verify the robots fetch path and reuse it; any other fetch route is a spec violation).
  Timeout-tolerant; absence is normal, not an error.
- Check: present; basic markdown-shape parseable (H1 + link lists). Result renders as an informational
  badge with the honest note ("No AI search engine consumes this file as of 2026 — Google's own guidance
  says it isn't needed; it's read mainly by AI coding agents"). **It never moves the score** (A9 pins
  zero weight). `llms_txt_absent` is severity `info`.

## 9. Free vs Pro — the wall (SPEC 02 discipline: gate the cure, never the diagnosis)

**FREE:** the full `AiReadinessScore` — score, band, all four component breakdowns, the complete findings
ledger (every JS-blind page named, every blocked bot listed), the access matrix, llms.txt status — plus
`homepageView` (the homepage What-AI-Sees excerpt: the wow + the share moment).

**PRO (owner + `entitlement`, server-side, never serialized otherwise):**
1. **`whatAiSees`** — the whole-site simulator: every page's class + excerpt, sortable, the "your
   beautiful site is an empty shell to ChatGPT" moment at site scale.
2. **`aiPackets`** — deterministic AI-fix action packets **reusing SPEC 02's `ActionPacket` machinery**
   (same type, same determinism bar, byte-identical per fix). Body convention codified:
   `System:` role line / `Task:` instruction / `Data:` fenced block of the page's real signals (escaped —
   crawled content). Packet kinds: server-render-this-page, add-this-JSON-LD, fix-heading-structure,
   link-this-orphaned-readable-page (source pages + anchors from the existing relevance machinery).
   Gated by `canUseActionPackets`. **Never in the public report/snapshot.**
3. **The llms.txt generator** — a Pro, owner-gated route that deterministically compiles the artifact
   from persisted pages: **ordered PageRank desc, URL asc tiebreak**, hubs first; honest header comment
   (same wording as §8); generated in-response (no storage). Honestly marketed: the checkbox clients ask
   for, zero risk, generated from your real link graph — never "improves AI rankings".
4. **The AI section in the white-label client report** (§10) — the agency deliverable (AEO audits sell
   for $250–$1,500; we're the $19 tool that produces the artifact).

Security test A11 pins: a free viewer's serialized `ClientAuditV2` contains **no** non-homepage excerpts
and **no** packet bodies.

## 10. The report section (SPEC 04 seam — Stage 6, post-merge only)

- Mounts as **one additive section** in the frozen section-slot layout of `/r/[slug]/page.tsx` — zero
  edits to SPEC 04's components. Renders: score + band, component bars, the top findings in
  **plain client-explainable language** (each finding's `plainLanguage` is a non-technical "what this
  means / why it matters" — a hard requirement from user research), the access matrix summary, the
  evidence labels, the `asOf` date, and the §2 disclosures. **Diagnostic-only: no packets, no simulator,
  no cure content** — SPEC 04's structural snapshot gating holds.
- **Snapshot:** `AiReadinessScore` (score + breakdown + findings + matrix + llms.txt status; NOT the
  per-page excerpts — bounded snapshot) is denormalized into `report_snapshot` at mint as an additive
  optional field. Reports minted before SPEC 05 lack it → the section renders nothing (null-safe, test
  A13). Minted snapshots stay immutable.
- OG card untouched this phase (SPEC 04 owns it; an AI-score OG variant is a later polish).

## 11. Data model & migrations  *(additive, nullable, RLS-untouched, OWNER-RUN)*

All migrations additive + reversible, timestamped in `infra/supabase/migrations/`, **written by Terminal 2
but applied by the owner via runbook** (SPEC 04 precedent — never autonomous). Verify final column names
against live schema via the Supabase MCP before writing the migration.

- **`pages`:** ONE additive nullable column `ai_signals jsonb` (the `PageAiSignals` payload incl. the
  bounded excerpt) — the `white_label jsonb` low-risk precedent. No shape change to existing columns;
  no new RLS (pages already read through the capability/admin path only).
- **`audits`:** additive nullable `ai_readiness jsonb` (the persisted `AiReadinessScore`) — one column,
  reusing the `20260617000001` crawl-health-columns precedent for review framing.
- **`public_reports`:** no migration — `report_snapshot jsonb` gains the optional field at mint (code).
- **Storage math (cost ceiling):** ~2KB excerpt + ~300B signals per page ⇒ ≤ ~1.2MB per 500-page audit,
  rides the existing free-audit 30-day TTL cleanup. No new tables, no new buckets, no RLS edits.
- **RLS check (mandatory):** after migration, verify via MCP that `pages.ai_signals` and
  `audits.ai_readiness` are reachable ONLY through the existing capability/owner paths — deny-by-default
  intact (test A12).

## 12. Security requirements  *(non-negotiable)*

- **XSS — the excerpt is attacker-controlled crawled text** rendered prominently ("What AI Sees", report,
  packets). Extraction stores `.text()` output (never HTML); render as text nodes only; escape at every
  boundary (`lib/html-escape.ts`); no `dangerouslySetInnerHTML` anywhere near it; packet `Data:` blocks
  are fenced + escaped so crawled strings cannot break the markdown frame (test A14).
- **SSRF:** exactly one new outbound fetch (llms.txt) through the existing guarded fetcher (§8). Any
  other new fetch path — including "re-check this page" — is a violation; STOP.
- **Server-side gating only** (SPEC 02 §11): `whatAiSees`/`aiPackets` populated only for the entitled
  owner in `projectAuditForClient`; UI hiding is not gating; nothing trusts client-asserted state.
- **No secrets / no `user_id`** in any new payload; the audit UUID capability model unchanged.
- **Rate limits / Turnstile / fail-closed untouched;** the generator + packet routes are owner+Pro-gated
  reads of already-persisted data (no crawl trigger, no new abuse surface beyond authed rate limits).

## 13. Non-regression contract  *(MUST NOT change without explicit sign-off — CLAUDE.md §5)*

1. **The grade is byte-identical.** Extraction is additive observation: the four components, weights,
   A–F/0–100, coverage floor, and every existing fixture grade are unchanged. **Run the backtest harness
   (`scripts/backtest-engine.ts`, `--budget-ms=240000`) — required: zero grade deltas** (test A15).
2. **Site-level JS detector + its orphan suppression untouched** (it keeps driving the grade; the
   per-page classifier is a parallel additive signal).
3. **SSRF guard / safe-fetch** — no weakening; one authorized fetch through it.
4. **RLS deny-by-default + capability-URL reads; anon-audit + claim-on-signup.**
5. **SPEC 02 cure gating** (prescriptions/monitoring/packets never serialized to free viewers) — extended
   to the new gated fields, never relaxed.
6. **Minted snapshot immutability** (§10's additive-at-mint field included).
7. **SPEC 04 surfaces untouched** except the Stage-6 additive section mount.
8. **Crawlee memory hint + direct-`crawlee` dependency; `maxDuration=300`; Inngest concurrency
   env-driven; Turnstile + rate limits + `global:audits:day` fail-closed; `PASSING_SCORE` untouched.**
9. **Determinism (SPEC 01 R1)** — score, findings, excerpts, packets, generator output all deterministic.
10. **Crawl time budget:** the added per-page work must not blow the 240s budget — perf-tested (A17).

## 14. Observability

Extend `lib/analytics-events.ts` (coordinate names; one funnel): `ai_score_revealed` (score, band,
confidence), `ai_homepage_view_opened`, `ai_whataisees_opened` (Pro), `ai_packet_copied`,
`llms_txt_generated`, `ai_finding_expanded`, `ai_report_section_viewed`. Sentry breadcrumbs on the
llms.txt fetch + generator/packet routes. PostHog sampling + geo-gated consent preserved.

## 15. Testing & acceptance criteria  *(TDD — failing tests first, per CLAUDE.md §3)*

Co-located vitest/component tests; `pnpm test`/`typecheck`/`lint`; all four repo guards green
(positioning-and-honesty-guard extended per §2); live smoke on the **deployed** function; 3×-reviewer
adversarial gate (≥9 all lenses, 0 blocking).

| # | Test | Pass condition | Covers |
|---|---|---|---|
| A1 | Extraction determinism | Same HTML ⇒ byte-identical `PageAiSignals` incl. excerpt; runs on the crawler-passed `$` with no second `cheerio.load` | §4, R1 |
| A2 | Classifier fixtures | SSR Next w/ content ⇒ `readable`; empty `#__next` shell + bundle ⇒ `js_blind`; populated `__NEXT_DATA__` but useEffect-fetched body ⇒ `partial`/`js_blind` via text gate; thin contact page ⇒ `thin`, never `js_blind` | §4.2 |
| A3 | Boilerplate precision | Nav/footer/CMP-allowlist stripped; a hero `class="banner"` with real content is NOT stripped; wildcards absent from the selector set | §4.1 |
| A4 | Excerpt rule | Post-filter text, word-boundary truncation at cap, no raw HTML, no nav jumble | §4.4 |
| A5 | Access matrix | Per-bot per-page ratios correct on a fixture robots.txt (path-scoped rules); wildcard disallow ⇒ fullyBlocked; no robots ⇒ 1.0 + noted | §3 |
| A6 | Retrieval-vs-training scoring | Subscore = retrieval-class mean only; training blocks reported, unscored; opt-out tokens described as tokens | §3 |
| A7 | WAF disclosure | CF headers ⇒ `wafDetected` + note rendered; score unchanged with/without WAF | §3, §2 |
| A8 | Retrieval path | readable-but-orphaned / readable-but-deep findings correct; JS-site suppression ⇒ `depth_only` basis + note | §6 |
| A9 | llms.txt | One guarded fetch via the robots fetch path; absent tolerated; **score identical with and without llms.txt** (zero weight pinned) | §8 |
| A10 | Score assembly | Weights 25/40/20/15; bands; confidence mirror; `isEstimate` framing; deterministic end-to-end | §7 |
| A11 | Gating (SECURITY) | Free viewer's serialized payload: full score+ledger+matrix+homepageView present; **no** non-homepage excerpts, **no** packet bodies; Pro owner gets both | §9, §12 |
| A12 | Migrations + RLS (SECURITY) | Additive nullable columns; deny-by-default verified via MCP; no policy widened | §11 |
| A13 | Report section + snapshot | Section mounts additively post-SPEC-04-merge; snapshot gains optional field at mint; pre-SPEC-05 reports render null-safe; no cure content in snapshot | §10 |
| A14 | XSS (SECURITY) | Malicious crawled titles/text/JSON-LD render escaped in What-AI-Sees, report section, packet bodies; markdown fence unbreakable | §12 |
| A15 | Grade non-regression + backtest | Full existing suite green; backtest over the corpus: **zero grade deltas**; site-level detector behavior unchanged | §13 |
| A16 | Honesty guard | Banned-claims phrases ("AI ranking", "guaranteed citations", …) pinned by the extended guard; evidence labels + `asOf` render | §2 |
| A17 | Perf budget | Per-page extraction overhead bounded (measure on a 500-page fixture); 240s budget + 300s `maxDuration` hold | §13 |
| A18 | Pro artifacts | Packet byte-determinism + System/Task/Data convention; generator output PageRank-desc/URL-asc, deterministic, honest header | §9 |
| A19 | Live smoke (deployed) | Static site, throttling WP site, JS/SPA site: score + classes + homepage view + (Pro) simulator/packets/generator from the deployed function | DoD |

## 16. Out of scope for SPEC 05
AI-visibility rank tracking / prompt-running / any LLM call (D3) or JS rendering (D2). Monitoring UI,
history dashboard, delta emails (SPEC 06 — this spec only persists history-ready data). Agency tier,
Chrome extension, MCP/CLI/GitHub surfaces (post-v1 roadmap). OG-card AI variant. Content-quality /
"fluff-percentage" verdicts (undeliverable deterministically; trust risk). Chunk/context-window scoring
(folklore). Engine crawl/politeness/budget changes. Any edit to SPEC 04's components beyond the §10
additive mount.

## 17. Build sequence & STOP gates  *(plan-mode; STOP for approval per CLAUDE.md §3)*

1. **Stage 0 — Restate scope + plan** against the real repo (verify every reference incl. post-SPEC-04
   `main` state, the robots matcher + fetch path, the header capture, the NON-CONTENT selector set, the
   suppression site in `audit.ts`, the exact SPEC 02 `ActionPacket` machinery). **STOP for plan approval.**
2. **Stage 1 — §1 types + constants** (additive) → unblocks everything. Small PR-able unit.
3. **Stage 2 — §4 engine extraction** (main-content + classifier + excerpt in `extractPage`) → A1–A4,
   A15 (grade untouched + backtest), A17. **STOP: owner eyeballs classifier output + excerpts on real
   sites (an SSR Next site, a CSR SPA, a WordPress site) before anything renders.**
4. **Stage 3 — §3 access matrix + WAF + §8 llms.txt + §5/§6/§7 score assembly** → A5–A10.
5. **Stage 4 — §11 migration (runbook to owner) + persistence + projection gating** → A11, A12.
6. **Stage 5 — web surfaces:** audit-page AI panel (free diagnosis + homepage view) + Pro simulator +
   packets + generator routes → A11, A14, A16, A18. **STOP: owner reviews the free wow and the Pro wall.**
7. **Stage 6 — the report section (§10): ONLY after SPEC 04 merges to `main`;** rebase, mount additively,
   snapshot field at mint → A13. **STOP: owner reviews the client-facing section end-to-end.**
8. **Stage 7 — §14 observability + full suite + guards + live smoke (deployed) + 3× adversarial gate.**
   Open the PR. **STOP — no merge to `main` without owner approval.** Post-merge: verify the Vercel
   production deployment is READY and run the production smoke (A19) before declaring done.

## 18. Git / workflow
- Branch `ai/spec-05-readiness` in its own worktree off a fresh `origin/main`; Terminal 2 only; small
  conventional commits; PR; **never self-merge; never push without the review gate + live smoke + owner
  go.** Show the full diff before any push.
- **No AI references anywhere** in commits/PRs/code/comments — no "claude", "claude code", "cursor",
  etc.; strip any `Co-Authored-By` trailer (CLAUDE.md §7). Trace-audit before every push.
- `nvm use 22`; `turbo.json build.env` lists every new build-time env var; route-segment exports static.
- MCPs for reading real data (Supabase schema, PostHog, Sentry, Vercel deploy status). **All
  production-touching actions (the migration, any env var) go to the owner as runbooks.**
- Report progress with real `file:line` references; surface spec/code mismatches — and any contract-type
  change — **before** acting. Coordination conflicts with Terminal 1 are a STOP, never a race.
