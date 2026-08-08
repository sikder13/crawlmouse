# SPEC 02 — Conversion Core (Phase 2, features + logic)

> **Read `00-crawlmouse-master-build-plan.md`, `PROJECT_OVERVIEW.md`, and `docs/OPERATING-RULES.md` first.** This spec
> serves the conversion spine (SPEC 00 §2). It builds the middle of the spine — **the wow → the gap → one
> free taste of the cure → the wall** — on top of the Phase-1 reproducible grade.
>
> **Status:** Phase 2. Co-developed in parallel with **SPEC 03 (UX/UI/onboarding)** on a separate branch.
> SPEC 02 owns the *features, logic, data, and gating*; SPEC 03 owns the *experience that renders them*.
> The two share one frozen data contract (§1), which is **identical in SPEC 03 §1**.
>
> **Dependency on Phase 1:** SPEC 01 v2 is merged to `main` behind `ENGINE_V2` (default OFF; prod on v1).
> §2 of this spec (the confidence-band) is the last remaining `ENGINE_V2`-flip dependency — it replaces the
> blunt low-confidence ceiling that currently collides with conversion and the viral loop. The flip itself
> (adding `ENGINE_V2=1` to prod) happens when §2 lands, the dense-links `statement_timeout` batching is done,
> and the v2-ON live smokes pass. **Do not flip the flag as part of this spec without explicit sign-off.**
>
> **Implementer note (mandatory, per OPERATING-RULES §3):** verify every file/function/table/column name against
> the live repo before editing. The references below were taken from the repo but you must re-confirm
> signatures in-code and flag any mismatch before writing implementation. **Do not assume.**


> ### AMENDMENT (owner-ruled 2026-08-04) — §2 is SUPERSEDED IN THE OVERLAP by SPEC 5.1a Stage 4
>
> **This is a continuation of §2's intent, not a reversal.** §2 removed the `LOW_CONFIDENCE_SCORE_CAP`
> (C/60) clamp because clamping produced a **fake letter** on a partially crawled site. Stage 4 does not
> reinstate the clamp — it removes the **assertion**: where a crawl trips a categorical refusal trigger
> (too few gradeable pages, nothing read, no observed links), no letter, score or confidence band is
> emitted at all.
>
> They overlap only where truncation is severe enough to leave no true grade for §2 to preserve. A test
> asserting "a degraded crawl still gets a score" encodes §2's MECHANISM rather than its INTENT.
>
> See `docs/specs/05_1-engine-honesty-spec.md` §7.

---

## 0. What this spec delivers, and the parallel-build rules

**Delivers, in spine order:**
1. **Confidence-band** (§2) — replace the blunt `LOW_CONFIDENCE_SCORE_CAP = 60` ceiling with a banded
   *estimate* (`B+/84, based on 500 of ~1,200 pages, medium confidence`). Flip-blocker; ship first.
2. **Projected-grade ledger** (§3) — deterministic "you're a C/64, fix these and you'd be ~B+/86," itemized
   as a ledger of specific fixes each carrying a *relative* marginal delta. No LLM (D3). No naive summing.
3. **Single free-fix reveal** (§4) — one *complete, real* fix of the user's highest-impact issue, free, end
   to end. Parameterized (`FREE_FIX_COUNT`, default **1**) so we can A/B 1-vs-2-3 later without a rewrite.
4. **Action-packet** (§5) — a deterministic, copy-paste-into-your-own-AI artifact. **The Pro headline.**
5. **The wall inversion** (§6) — free shows the *full diagnosis + full gap + one cure + the projection*;
   Pro gates the *cure* (all prescriptions + action-packets), *monitoring*, *completeness*, *privacy*.
   Retires the per-category diagnosis cap (`FREE_FINDING_LIMIT`).
6. **Entitlement/tier abstraction** (§7) — the **agency seam**: a real `Tier` model so a later Agency tier
   is a config addition, not a refactor. **No agency features are built in this phase.**
7. **Monitoring, day-one real** (§8) — manual re-audit + a visible delta (`C→B since last run`) in Pro now.
   The *scheduled/automated* monitoring engine is deferred to SPEC 06. Pro must have a real recurring reason
   to return on day one (SPEC 00 D5 / locked-truth #2).
8. **AI-readiness seam** (§9) — leave the existing `js_rendered` finding category and a clean score-slot for
   SPEC 05. **Do not build AI-readiness here.**

**Parallel-build rules (this consciously overrides OPERATING-RULES §8 "one branch per phase" — approved):**
- **Branch:** `conversion/spec-02-core`, off `main`. SPEC 03 runs on `ux/spec-03-onboarding`, also off `main`.
- **One spec per context still holds:** this terminal holds **only SPEC 02**. Do not load SPEC 03.
- **File ownership — SPEC 02 owns and may edit:** `packages/engine/src/**`, `packages/types/src/**`,
  `apps/web/lib/findings.ts`, `apps/web/lib/pro.ts`, `apps/web/lib/tier.ts`, `apps/web/lib/limits.ts`,
  `apps/web/lib/audit-stream-projection.ts`, `apps/web/app/api/**`, `inngest/**`,
  `infra/supabase/migrations/**`, `scripts/**`. **Do not touch** page/component `.tsx` files, the Tailwind
  theme, `lib/brand.ts`, or `components/**` — those are SPEC 03's. If you believe you must, STOP and ask.
- **The contract (§1) is frozen.** If implementation reveals the contract needs a field it doesn't have,
  **STOP, do not unilaterally change it** — raise it; it must be updated in *both* specs simultaneously, and
  SPEC 03 must be told. Changing the contract on one side silently is the one thing that breaks the parallel
  build.
- **Integration order:** SPEC 02's PR is reviewed and (with explicit owner approval) merged to `main`
  **first** — it provides the real data + contract. SPEC 03 then rebases onto updated `main`.

---

## 1. SHARED DATA CONTRACT  *(identical in SPEC 03 §1 — SPEC 02 implements it, SPEC 03 renders it)*

These types live in `packages/types/src/` (extend the existing `audit.ts`; do not duplicate `Confidence`,
`FindingCategory`, `CrawlHealth`, which already exist there). This is the **frozen seam** between the two
specs. SPEC 03 builds its UI against fixtures matching these shapes; SPEC 02 produces them for real.

```ts
// ── Entitlement / tier (the agency seam). Derived SERVER-SIDE from users.tier + pro_until. ──
export type Tier = 'free' | 'pro' | 'agency';

export interface Entitlement {
  tier: Tier;
  proUntil: string | null;            // ISO; the existing pro_until
  // Capability gates — derived from tier, ALWAYS recomputed server-side, never trusted from the client.
  canSeeAllPrescriptions: boolean;    // the cure for every fix (Pro+)
  canUseActionPackets: boolean;       // copy-paste AI artifacts (Pro+)
  canMonitor: boolean;                // re-audit + delta (Pro+)
  canSeeFullSiteGrade: boolean;       // completeness: grade the whole site, not a sampled estimate (Pro+)
  canWhiteLabel: boolean;             // agency only — FALSE for everyone in this phase
}

// ── Confidence band (§2). Replaces the blunt score cap. ──
export interface ConfidenceBand {
  pointEstimate: number;              // the deterministic score (0..100) — unchanged determinism (R1)
  grade: string;                      // letter grade for pointEstimate
  lower: number;                      // band lower bound (0..100)
  upper: number;                      // band upper bound (0..100)
  confidence: Confidence;             // 'low' | 'medium' | 'high' (already defined)
  basis: {
    crawled: number;                  // pages actually graded (fetchedOk)
    estimatedTotal: number | null;    // ~M; null when we can't responsibly estimate (then omit "of ~M")
    method: 'sitemap' | 'frontier' | 'none';  // how estimatedTotal was derived (auditability)
  };
  isEstimate: boolean;                // true when partial/low-confidence → UI renders "estimate", not verdict
}

// ── The gap ledger (§3). Deterministic, no LLM (D3). ──
export interface FixDiagnosis {       // FREE — part of the full diagnosis. The "what" + "how much".
  id: string;                         // stable, deterministic id (so monitoring can match across re-audits)
  category: FindingCategory;          // ties to the diagnosis taxonomy already in audit.ts
  targetUrl: string;                  // the page being fixed (e.g. the orphan / the deep page)
  targetTitle: string | null;
  marginalDelta: number;              // estimated RELATIVE score gain of THIS fix alone (NOT additive)
  effort: 'low' | 'medium' | 'high';
  rationale: string;                  // plain-language why (escaped at render — XSS, crawled content)
}

export interface FixPrescription {    // GATED (except the one free fix) — the "how". The cure.
  fixId: string;                      // FK to FixDiagnosis.id
  suggestedLinks: Array<{
    fromUrl: string;                  // source page to add the inbound link on
    fromTitle: string | null;
    anchorText: string;               // exact suggested anchor (deterministic; varied; not over-optimized)
    relevanceScore: number;           // 0..1 shared-token/TF-IDF relevance over titles/headings/anchors (D3)
  }>;
  actionPacket: ActionPacket;         // the paste-into-your-AI artifact for this fix
}

export interface ProjectedGrade {
  current: { score: number; grade: string };
  projected: { score: number; grade: string };   // grade of the fully-simulated-fixed graph (single recompute)
  ledger: FixDiagnosis[];             // FREE: the full ledger of problems + per-fix relative impact
  disclaimer: string;                 // "Estimated, not guaranteed. Per-fix impacts are relative and do not sum."
}

// ── The free taste of the cure (§4). ──
export interface FreeFix {
  diagnosis: FixDiagnosis;
  prescription: FixPrescription;      // the ONE complete, free cure (highest-impact)
  rank: number;                       // 1 = the #1 issue
}

// ── Action packet (§5) — the headline. Deterministic markdown; pasteable into the user's own LLM. ──
export interface ActionPacket {
  fixId: string;
  format: 'markdown';
  body: string;                       // the structured, deterministic context block (no LLM call on our side)
  copyLabel: string;                  // e.g. "Copy for ChatGPT / Claude"
}

// ── Monitoring (§8) — manual re-audit delta now; scheduled engine deferred to SPEC 06. ──
export interface MonitoringDelta {
  previousAuditId: string | null;     // null on the first audit of a URL
  currentAuditId: string;
  scoreDelta: number | null;          // current - previous (null when no previous)
  gradeFrom: string | null;
  gradeTo: string;
  resolvedFixIds: string[];           // FixDiagnosis.ids present last time, gone now
  newFixIds: string[];                // FixDiagnosis.ids that appeared
  ranAt: string;                      // ISO
}

// ── What the client receives. EXTENDS the existing ClientAudit (audit-stream-projection.ts). ──
// GATED fields are present ONLY when the viewer's Entitlement allows. Enforced server-side in
// projectAuditForClient — NEVER hidden in the UI. (Same discipline as groupAndCapFindings today.)
export interface ClientAuditV2 extends ClientAudit {
  entitlement: Entitlement;                       // the VIEWER's tier — drives every UI lock
  confidenceBand: ConfidenceBand | null;          // FREE + all (transparency builds trust)
  projectedGrade: ProjectedGrade | null;          // FREE: the full ledger (diagnosis + impact)
  freeFix: FreeFix | null;                         // FREE: the one complete cure
  prescriptions: FixPrescription[] | null;        // GATED: null for free; ALL cures for entitled
  monitoring: MonitoringDelta | null;             // GATED: null for free; the delta for entitled
  hasMorePrescriptions: boolean;                  // true when prescriptions exist behind the wall (UI signal)
}
```

**Gating summary (the wall, encoded):** `confidenceBand`, `projectedGrade.ledger` (the full diagnosis), and
`freeFix` are **free**. `prescriptions` (every cure) and `monitoring` are **gated** and are `null` in a free
viewer's payload — never serialized, never sent. `hasMorePrescriptions` lets the UI show the *shape* of the
wall ("11 more fixes — Pro") without leaking the cure. This is the inversion: **stop capping the diagnosis,
gate the cure.**

---

## 2. Confidence-band — replace the blunt ceiling  *(flip-blocker; ship first)*

**The problem (precise).** The engine currently caps a low-confidence score via
`Math.min(rawScore, LOW_CONFIDENCE_SCORE_CAP)` with `LOW_CONFIDENCE_SCORE_CAP = 60`
(`packages/engine/src/grade.ts`, `constants.ts:45`). A well-structured large site that the crawl only
partly reached (coverage < 0.7 → `low` confidence) is slammed to C/60 regardless of its real structure
(evidence: nginx A/91→C/60, sqlite A−/89→C/60). This **violates locked-truth #1** (a free result that can't
be trusted converts at zero) and poisons the badge/leaderboard (the viral loop). **Do not confuse this with
`PASSING_SCORE = 60` in `apps/web/lib/limits.ts` — that is the grade-C boundary and is unrelated. Do not
touch `PASSING_SCORE`.**

**The fix.**
1. **Stop capping.** The deterministic point estimate (R1) is the *real* computed score — keep it exactly as
   computed; do not clamp it down for low confidence. Determinism is preserved (this is a non-regression:
   same site + same cap + clean crawl → identical grade, SPEC 01 R1).
2. **Band it.** Produce a `ConfidenceBand` from the already-computed `CrawlHealth`. The ± width is driven by
   confidence: `high ≈ ±2`, `medium ≈ ±5`, `low ≈` a wide band rendered as "estimate, re-crawl recommended"
   (SPEC 01 §6 specified these magnitudes — confirm/justify the exact constants in `constants.ts`). Clamp
   `lower`/`upper` to `[0, 100]`.
3. **Estimate ~M (the site total)** for the "of ~M pages" copy, *honestly*:
   - If a sitemap was seen and is larger than what was crawled → `estimatedTotal = sitemap URL count`,
     `method: 'sitemap'`.
   - Else if the crawl hit the page cap with a non-empty unexpanded frontier → a conservative frontier-based
     extrapolation, `method: 'frontier'`. Document the formula; keep it conservative (never inflate).
   - Else → `estimatedTotal = null`, `method: 'none'`; the UI omits "of ~M" and shows only "based on N pages."
4. **`isEstimate`** = `partial || confidence !== 'high'`. When true, the band + "estimate" framing is shown;
   when false, a clean verdict.

**Where:** the band is computed in the engine (it has `CrawlHealth`) and carried on `AuditResult`; it is
persisted (see §10) and projected to the client in `projectAuditForClient` (extend `ClientAudit` →
`ClientAuditV2.confidenceBand`). The crawl-health is *already* projected to the client today, so this is an
additive extension, not new plumbing.

**Reproducibility bar:** the point estimate and the band must be deterministic — identical inputs → identical
band. Add a determinism test (mirrors SPEC 01 T2).

**Backtest gate (OPERATING-RULES §6):** because this changes how low-confidence grades present (no longer 60), run
`scripts/backtest-engine.ts` over the corpus and confirm every changed grade is explained ("removed C/60
cap; true grade X at confidence Y"). No unexplained swing merges.

---

## 3. Projected-grade ledger — the gap mechanic  *(deterministic, no LLM)*

**Goal:** turn the inert grade into motivation — "you're C/64; fix these and you'd be ~B+/86" — as an
**itemized ledger**, not an aspirational "fix everything → A." (Research: Lighthouse/PSI per-opportunity
"estimated savings" is the trusted pattern; health scores are subtraction ledgers.)

**Algorithm (deterministic, D3 — confirm the real graph/grade function signatures in
`packages/engine/src/graph.ts`, `analysis/*`, `grade.ts`):**
1. **Enumerate fixable issues** from the graded graph: orphans (add inbound internal links), deep pages (add
   a link from a shallow hub), generic/over-optimized anchors (anchor-diversity improvements), under-linked
   important pages. Each maps to a `FindingCategory` already in `audit.ts`.
2. **Choose the prescription deterministically** using lightweight content relevance — shared-token / TF-IDF
   over page titles, headings, and existing anchor text (D3; **no LLM, no embeddings service**). For an
   orphan, pick the top-K most topically-relevant *eligible source pages* to link from, with a natural,
   varied, non-over-optimized anchor. Ties broken by a stable key (URL asc) for reproducibility.
3. **Compute the projection by a single re-grade of the simulated-fixed graph.** Build the "what-if" graph
   (apply *all* simulated fixes — add the suggested edges, re-mark resolved orphans, etc.), then recompute
   the grade **once**. That recomputed grade is `projected`. This is deterministic and order-independent.
4. **Per-fix `marginalDelta` is for prioritization display only.** Compute it as the grade delta of applying
   *that one fix* to the *base* graph. **It is explicitly NOT summed to reach `projected`** — encode the
   Lighthouse #14107 lesson ("these opportunities are not independent; you can't sum them") in the
   `disclaimer` and in a test. Sort the ledger by `marginalDelta` desc (then stable key).
5. **Clamp honesty:** `projected.score` is the real recomputed score of the fixed graph — do not inflate to a
   round "A." If the fixed graph still isn't an A, the projection isn't an A.

**Output:** `ProjectedGrade` (§1). The full `ledger` (all `FixDiagnosis`) is **free** — this is the "full
gap." The prescriptions are gated (§6) except the free one (§4).

**Reproducibility & backtest:** same audit → same ledger and same projected grade (determinism test). If the
projection logic reads the grade engine, the backtest harness must show projections are stable.

---

## 4. Single free-fix reveal — one complete cure, free

**Decision (owner-approved):** give away **one complete, real, end-to-end cure** of the user's *highest-impact
actual* issue — the real target page, the specific source pages to link from, the exact anchor text, the
marginal delta, and the action-packet — done fully. Depth-of-one is the proof the cure exists and works on
*their* site (the answer to "diagnoses but doesn't fix"); breadth (all the cures) is the wall.

**Selection:** the `FreeFix` is the ledger's rank-1 fix (highest `marginalDelta`, stable tiebreak). It must
be a *genuinely useful, real* fix — not a throwaway. The same site must always yield the same free fix
(deterministic).

**Parameterize for future A/B:** add `FREE_FIX_COUNT` (default **1**) in `constants.ts`/`limits.ts`. The
reveal logic takes the top-`FREE_FIX_COUNT` fixes. Shipping value is **1**; the parameter exists so we can
test 1-vs-2-3 later without a rewrite (research flagged the count as WE'RE-BETTING — to be validated with
real users).

**Gating:** `freeFix` is in every viewer's payload (free + Pro). The *remaining* prescriptions are gated
(§6).

---

## 5. Action-packet — the Pro headline  *(deterministic; bridges D3)*

**What it is:** a structured, deterministic, copy-pasteable artifact the user pastes into their **own**
ChatGPT/Claude to generate the actual HTML/content edits. This is the bridge over D3 — **we never call an
LLM** (zero COGS, reproducible); we provide the high-value *deterministic structure* (which page, which
inbound links, which anchors, in what priority) and offload the generative step to the user's existing AI
subscription. Research: this is especially powerful worldwide — a user with a $20 ChatGPT plan who can't
afford a $130 suite converts their existing AI spend into fixes.

**Format (deterministic markdown `body`):** for each fix, a block containing: the target page (URL + title),
the suggested inbound links (each: source page URL + title, exact suggested anchor, a one-line "why these
share topics: …"), and an instruction wrapper telling the user's LLM to output the exact `<a>` tags and where
to place them naturally. **No nondeterminism** — given the same fix, byte-identical packet (test this).

**Positioning:** the action-packet is the **headline Pro value prop** on the result page and pricing
(SPEC 03 leads the Pro pitch with it). The homepage still leads with the grade/gap (broadest top-of-funnel);
the *Pro* value leads with the action-packet + monitoring. Research split: solo owners lead with "what's
wrong" (grade/gap), builders lead with "can't be bothered to fix" (packet) — so grade/gap is the hook, the
packet is the closer.

**Gating:** the action-packet for the **free fix** is free (it's part of the free cure). All other packets
are gated (`prescriptions` is null for free). The `freeFix.prescription.actionPacket` proves the format is
worth paying for the rest.

---

## 6. The wall inversion — gate the cure, not the diagnosis

**Current wall (the thing we invert):** `apps/web/lib/findings.ts` `groupAndCapFindings(findings, isPro,
FREE_FINDING_LIMIT)` caps each finding category to the top **5** for free users (`FREE_FINDING_LIMIT = 5`,
`limits.ts`). Its server-side discipline is *correct* ("the gated rows are never sent to a non-Pro client")
but it gates the **wrong thing** — diagnosis volume, the weakest lever (SPEC 00 D4; research TRAP).

**The inversion:**
- **Free now sees the full diagnosis.** Retire the per-category cap for free users — send *all* findings and
  the *full* `projectedGrade.ledger`. (Keep `groupAndCapFindings` only if a category still needs *display*
  grouping; the *cap* for free goes away. Confirm callers — primarily
  `apps/web/app/api/audits/[id]/stream/route.ts:45` and the export route.)
- **Pro gates the cure.** Apply the same never-send-to-client discipline to the *new* artifacts:
  `prescriptions` (every fix's `suggestedLinks` + action-packet) and `monitoring` are `null` in a free
  viewer's payload. Enforced in `projectAuditForClient` (the existing chokepoint that already strips
  `user_id`/`failure_reason`) — extend it to produce `ClientAuditV2`, populating the gated fields **only**
  when `entitlement.canSeeAllPrescriptions` / `canMonitor`.
- **The CSV export** (`apps/web/app/api/audits/[id]/export/route.ts`, currently 402-gated) stays Pro and
  should include the prescriptions/packets in the export for Pro (confirm `lib/billing/csv.ts`).

**Why this converts (research, MARKET-PROVEN directionally):** ungated freemium ~3× signup lift; role-based
gating (gate collaboration/export/cure, not core) lifted conversion ~2.6%→5.1%; the unmet need is *fixing*.
Showing the full gap free makes the cure more desirable, not less. **Calibration is WE'RE-BETTING** — the
exact boundary is the first thing to test with beachhead users; the spec must make the boundary a single,
easily-moved place (`Entitlement` gates + `FREE_FIX_COUNT`), not scattered conditionals.

**Security (critical, see §11):** gated data must be **absent from the free client payload**, not hidden in
the UI. SPEC 03 must never receive `prescriptions`/`monitoring` for a free viewer. Add a test asserting a
free viewer's serialized `ClientAuditV2` contains no `suggestedLinks`/`actionPacket.body`/`monitoring`.

---

## 7. Entitlement / tier abstraction — the agency seam  *(build the seam, not the tier)*

**Goal (owner-approved):** make a future Agency tier a *config addition*, not a refactor. Build the
abstraction now; **build zero agency features.**

**What exists:** `apps/web/lib/pro.ts` (`isProActive`, `userIsPro`) and `lib/tier.ts` (`tierLimits(isPro)`)
are binary free/pro keyed on `users.pro_until` (a boolean world). Entitlement columns are service-role-write
locked (migration `20260602000013_harden_users_entitlement_grants`) — a user cannot self-grant; **preserve
that** for any new tier column.

**Build:**
- A `Tier` type (`'free' | 'pro' | 'agency'`) and an `entitlementFor(tier, proUntil)` function returning the
  `Entitlement` capability object (§1). All gating reads `Entitlement`, never a raw boolean. Today `tier` is
  derived: `proUntil` active → `'pro'`, else `'free'`. The `'agency'` branch exists in the type and the
  capability map but is **unreachable in this phase** (no path sets it) — that is the seam.
- Refactor existing call sites (`userIsPro`/`isProActive` consumers) to go through the new
  entitlement function so adding Agency later is one place. Keep `isProActive` as the underlying date check.
- `tierLimits` extends to a tier-keyed map (free/pro today; agency row present but equal-to-pro for now, or
  clearly TODO). Do not invent agency caps — leave a documented placeholder.

**Data model (§10):** add a `tier` column to `users` (nullable, default null → derived as today), service-role
write-locked exactly like `pro_until`. Do **not** wire Stripe to set it yet — Agency billing is post-phase.

**Out of scope here:** white-label, team seats, multi-client dashboards, scheduled multi-site monitoring. The
seam must make these additive; building them is a later spec.

---

## 8. Monitoring — day-one real, scheduled deferred

**Principle (SPEC 00 D5 / locked-truth #2):** you cannot charge *monthly* for a one-shot; Pro must have a real
recurring reason to return **on day one**. Full scheduled/automated monitoring is SPEC 06 — but a *manual*
re-audit with a *visible delta* is cheap, real, honest, and shippable now.

**Build now:**
- **Manual re-audit** of a prior audit's URL (Pro), producing a new audit linked to the previous one for the
  same URL+owner. Reuse the existing audit pipeline (`apps/web/app/api/audits/start/route.ts` + the Inngest
  `auditFn`); add the linkage (previous audit id) — do not build a new crawler.
- **Delta computation** → `MonitoringDelta` (§1): score delta, grade from→to, resolved vs new fixes (match on
  the deterministic `FixDiagnosis.id`). Computed server-side; gated (`canMonitor`).
- Surfaced in the Pro dashboard (SPEC 03 §5) as "your grade moved C→B since last run — here's what changed."

**Deferred to SPEC 06 (do not build):** scheduled cron re-audits, email delta alerts, multi-site monitoring,
historical time-series beyond the immediate previous→current delta. Leave the `MonitoringDelta` shape and the
previous-audit linkage clean so SPEC 06 builds on them.

---

## 9. AI-readiness seam — leave it clean for SPEC 05  *(do not build)*

SPEC 05 is AI/agent-readiness. **Do not build any AI-readiness feature here.** Just don't block it:
- The `js_rendered` and `incomplete_crawl` finding categories already exist in `audit.ts` — leave them; the
  JS-rendered disclosure SPEC 03 surfaces ("this is also what a non-rendering AI agent sees") reads the
  existing `js_rendered` finding. Do not repurpose them.
- Keep the JS/SPA detector + its orphan suppression intact (non-regression; it *becomes* the AI-readiness
  signal in SPEC 05 — OPERATING-RULES §5).
- Do not add an AI-readiness score, llms.txt check, or robots-AI-rule check — that is SPEC 05. If the design
  tempts you toward it, STOP; it is out of scope.

---

## 10. Data model & migrations  *(additive, non-breaking, RLS-correct)*

All migrations **additive and reversible**; follow the existing pattern in `infra/supabase/migrations/`
(timestamped; nullable new columns; backfilled defaults). Apply via the Supabase MCP / Management API.

- **`users`**: add `tier text` (nullable; default null), **service-role write-locked** mirroring the
  `pro_until`/`stripe_customer_id` lockdown (`20260602000013`). No CHECK that would break forward tiers
  (follow the `confidence`-as-free-text precedent noted in `20260617000001`).
- **Fixes / projection storage**: persist the computed ledger + prescriptions so the result page and
  monitoring are stable across reloads and re-audits. Prefer a `fixes` table (audit_id FK, the
  `FixDiagnosis` fields + the prescription fields, or a sibling `fix_prescriptions` table — pick the
  lower-risk shape) **with RLS matching the existing `findings` policy** (owner-read via the audit join;
  anon reads via the capability-URL admin path — no `user_id` on the wire). Store the `ConfidenceBand` either
  on `audits` (new nullable columns) or alongside crawl-health — reuse the `20260617000001` precedent.
- **Monitoring linkage**: a nullable `previous_audit_id` (or a `monitoring_runs` row) linking a re-audit to
  its predecessor for the same URL+owner. RLS owner-scoped.
- **RLS is deny-by-default** — every new table gets explicit policies; never widen `findings`/`audits`
  policies. Verify with the Supabase MCP that the new tables are not anon-readable except via the existing
  capability-URL admin path.
- **Minted public reports are immutable** (non-regression #6) — if a report renders fixes, denormalize at
  mint; never mutate a minted `public_reports` snapshot when the engine logic changes.

---

## 11. Security requirements  *(industry standard; non-negotiable)*

- **Server-side gating only.** The cure (`prescriptions`, `actionPacket.body`, `monitoring`) is gated in
  `projectAuditForClient` and the API — it is **never serialized into a free viewer's response**. UI hiding
  is not gating. Test: a free viewer's `ClientAuditV2` JSON contains no prescription/packet/monitoring data.
- **Entitlement is server-derived.** `Entitlement` is computed server-side from `users.tier`/`pro_until`;
  the client cannot assert its own tier. The write-lock on `tier`/`pro_until` (RLS) must be preserved and
  tested (a user PATCHing their own `tier`/`pro_until` must fail — mirror the existing entitlement-grant
  test).
- **SSRF guard / `safe-fetch` unchanged** (non-regression #1). The projection/relevance work operates on
  already-crawled data — it must introduce **no new outbound fetch path**. If anything wants to fetch, STOP.
- **XSS on crawled content.** All user-site-derived strings (page titles, anchor text, URLs, rationale) are
  attacker-controlled. They must be escaped/sanitized at the boundary — reuse `apps/web/lib/html-escape.ts`.
  The action-packet `body` embeds crawled URLs/titles; ensure it cannot break out of the markdown block or
  inject when rendered (SPEC 03 renders it; SPEC 02 must produce safe content).
- **Rate-limit & abuse controls unchanged** (non-regression #8): Turnstile, per-IP/domain/global limits, the
  `global:audits:day` fail-closed. Manual re-audit (§8) must go through the same rate-limit path as a normal
  audit — it is not an unmetered backdoor.
- **No secrets client-side.** Nothing in the new client payload exposes service-role data, internal ids
  beyond what's already public (the audit UUID capability URL), or `user_id`.
- **Stripe entitlement checks server-side** (existing pattern) — no client-trusted Pro state.

---

## 12. Non-regression contract  *(MUST NOT change without explicit sign-off — OPERATING-RULES §5)*

1. **SSRF guard / `safe-fetch`** — no new unguarded fetch path.
2. **RLS deny-by-default + capability-URL admin reads**; anon-audit + claim-on-signup flow.
3. **JS/SPA detector + orphan suppression** (becomes SPEC 05's signal).
4. **Four grade components & weights (Orphans 40 / Depth 20 / Anchor 20 / Structure 20) and the A–F / 0–100
   scale** — the projection re-grades through the *same* engine; **no silent re-weighting**.
5. **SPEC 01 R1 determinism** — the point estimate stays deterministic; the band/ledger/free-fix/packet are
   all deterministic. Same site → same everything.
6. **Minted public-report immutability** — never mutate `public_reports` snapshots.
7. **Crawlee memory hint + direct-`crawlee` dependency** (`PROJECT_OVERVIEW.md` §11).
8. **Turnstile + per-IP/domain/global rate limits**; `global:audits:day` fail-closed.
9. **`PASSING_SCORE = 60` (the grade-C boundary) is untouched** — only the engine's
   `LOW_CONFIDENCE_SCORE_CAP` behavior changes.

---

## 13. Observability  *(the funnel that governs success — SPEC 00 §4)*

Emit PostHog events for the spine (coordinate names with SPEC 03 so the funnel is one pipeline; see
`apps/web/lib/analytics-events.ts`): grade revealed (with confidence/isEstimate), gap/projection viewed,
free-fix viewed, action-packet copied, wall/upgrade viewed, checkout started, Pro activated, re-audit run,
delta viewed. Keep PostHog sampling + geo-gated consent (non-regression). Sentry breadcrumbs for any new
server path; preserve the `signal:audit-failed` path.

---

## 14. Testing & acceptance criteria  *(TDD — failing tests first, per OPERATING-RULES §3)*

**Industry-standard testing required; determinism is the headline bar.** Co-located vitest tests
(`*.test.ts`) per repo convention; run `pnpm test`, `pnpm typecheck`, `pnpm lint`; then the live smoke
(`pnpm smoke -- --url=…`) on the **deployed** function; then the 3×-reviewer adversarial gate (≥9 all four
lenses, 0 blocking).

| # | Test | Pass condition | Covers |
|---|---|---|---|
| C1 | Confidence-band determinism | Same audit inputs → identical `ConfidenceBand`; point estimate uncapped & unchanged from the deterministic score | §2, R1 |
| C2 | No-cap behavior | A high-structure, low-coverage fixture no longer returns C/60; returns the true grade + an estimate band | §2 |
| C3 | Site-size estimate honesty | `estimatedTotal` from sitemap when present; `null`+`method:'none'` when not derivable; never inflated | §2 |
| C4 | Ledger determinism | Same audit → identical `ProjectedGrade.ledger` (order + deltas) and identical `projected` | §3, R1 |
| C5 | Non-additivity guard | `projected.score` = re-grade of the fixed graph, **not** the sum of `marginalDelta`s; disclaimer present | §3 |
| C6 | Free-fix selection | `freeFix` = deterministic rank-1; respects `FREE_FIX_COUNT`; is a real, complete cure | §4 |
| C7 | Action-packet determinism | Same fix → byte-identical packet `body`; pasteable; no injection/escape break | §5 |
| C8 | Wall inversion — diagnosis free | Free viewer payload contains the FULL findings + full `ledger` (no per-category cap) | §6 |
| C9 | Wall inversion — cure gated (SECURITY) | Free viewer's serialized `ClientAuditV2` contains **no** `suggestedLinks`/`actionPacket.body`/`monitoring`; `hasMorePrescriptions` true | §6, §11 |
| C10 | Entitlement server-derived (SECURITY) | A user cannot self-set `tier`/`pro_until` (RLS PATCH fails); `Entitlement` computed server-side | §7, §11 |
| C11 | Tier seam | `entitlementFor('agency', …)` returns agency capabilities; no code path reaches `'agency'` in this phase | §7 |
| C12 | Monitoring delta | Re-audit links to predecessor; `MonitoringDelta` correctly reports score delta + resolved/new fixes (matched on `FixDiagnosis.id`); gated | §8 |
| C13 | Migrations additive + RLS | New columns/tables backfill; new tables deny-by-default; `findings`/`audits` policies unchanged; minted reports unaffected | §10 |
| C14 | Backtest gate | `scripts/backtest-engine.ts` over the corpus: every changed grade explained (mostly "removed C/60 cap"); zero unexplained swing | §2/§3 |
| C15 | Non-regression suite | All existing tests green; §12 behaviors intact; SSRF/RLS/rate-limit unchanged | §12 |
| C16 | Live smoke (deployed) | Static + throttling-WP + JS/SPA sites: grade + band + ledger + free-fix render from the deployed function | DoD |

---

## 15. Out of scope for SPEC 02
SPEC 03's UI/UX (this spec produces the data; SPEC 03 renders it). AI-readiness (SPEC 05). Scheduled/automated
monitoring, email alerts, multi-site monitoring, long time-series (SPEC 06). Agency *features* (white-label,
seats, multi-client dashboards). LLM calls in-product or JS rendering (D2/D3 hold). The `ENGINE_V2` flag flip
itself (separate sign-off).

---

## 16. Build sequence & STOP gates  *(plan-mode; STOP for approval per OPERATING-RULES §3)*

1. **Restate scope + plan** against the real repo; **STOP for plan approval** before implementation.
2. **Land §1 contract types** in `packages/types` (this unblocks SPEC 03's real wiring). Small PR-able unit.
3. **§2 confidence-band** (engine) → tests C1–C3 → **backtest (C14)** → **STOP: review band behavior before
   proceeding** (it's the flip-blocker; the owner may want to eyeball real outputs).
4. **§3 ledger** + **§4 free-fix** + **§5 action-packet** (engine/lib) → tests C4–C7.
5. **§7 entitlement seam** + **§6 wall inversion** (lib/api/`projectAuditForClient`) → tests C8–C11 (esp. the
   SECURITY tests C9/C10).
6. **§10 migrations** (additive, RLS) → C13. **§8 monitoring** (re-audit + delta) → C12.
7. **§13 observability** events.
8. **Full suite + live smoke (deployed) + 3× adversarial gate.** Open the PR. **STOP — do not merge to
   `main`; owner approval required** (and SPEC 02 merges *before* SPEC 03).

---

## 17. Git / workflow
- Branch `conversion/spec-02-core` off `main`; small focused conventional commits; PR, no self-merge of
  engine changes. **Never push to `main` without the review gate + live smoke + owner permission.**
- **No AI references anywhere** in commits/PRs/code/comments — no "claude", "claude code", "cursor", etc.;
  strip any `Co-Authored-By` trailer (OPERATING-RULES §7).
- `nvm use 22`; `turbo.json build.env` lists every new build-time env var; route-segment exports static.
- Use the MCPs for *reading real data* (Supabase schema/corpus, Sentry, PostHog funnel, Vercel logs, Stripe)
  and for applying migrations via the Supabase Management API. **Any production-touching action needs owner
  approval and goes through this terminal — not invoked blindly.**
- Report progress against this spec with real `file:line` references; surface any spec/code mismatch **before**
  acting.
