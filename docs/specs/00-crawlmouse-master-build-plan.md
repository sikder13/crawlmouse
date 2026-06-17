# SPEC 00 — Crawlmouse Master Build Plan & SDLC

> **Read this first.** This is the controlling document for the Crawlmouse rebuild. It defines the goal, the one
> organizing principle, the locked engineering decisions, the phase plan, the full spec index, and the software
> development lifecycle every change must pass through. Every other spec (01–06) serves the principle defined here.
> Pair this with `PROJECT_OVERVIEW.md` (current architecture/state) when working in Claude Code.

---

## 1. The goal (one sentence)

Turn Crawlmouse into a professional-grade product where **the free tier is a trustworthy, complete showcase of the
value Pro delivers — engineered so the user, at the moment of peak motivation, sees exactly why paying solves their
pain.** Targeted at solo site owners/bloggers and small WordPress/Shopify builders (secondary: in-house SMB marketers).
Near-term commercial target: **$1,000–$3,000 MRR within ~2 months** (monthly + annual combined).

## 2. The organizing principle — THE CONVERSION SPINE

Every spec is built around this single loop. If a feature doesn't serve a step here, it is out of scope for v1.

```
   TRUSTWORTHY RESULT      →   THE WOW          →   THE GAP             →   ONE TASTE OF THE CURE   →   THE WALL          →   STAY
   (reproducible grade,        (live graph,         ("you're a C —          (1 full fix revealed,        (full fix list +     (monitoring:
    crawl-health/confidence,    grade reveal,        you could be an A−       free, end to end)            artifacts +          re-audit, deltas,
    no false findings)          AI-readiness score)  if you fix these")                                    monitoring, Pro)     "watch it climb")
```

Two hard truths this encodes, both validated earlier in this project:

1. **A free result that can't be trusted converts at zero.** Reproducibility (SPEC 01) is therefore the **#1 conversion
   prerequisite**, not merely a correctness fix. It is ranked above all feature work.
2. **You cannot charge *monthly* for a one-shot diagnosis.** The only durable monthly value is **monitoring** (re-audit
   + delta tracking + "watch your grade climb"). Monitoring is the *spine* of Pro, not a line item. The product must be
   a loop (audit → fix → re-audit → improvement → watch continuously), not a one-time grade.

**The conversion wall moves from VOLUME to VALUE.** We do *not* primarily sell "more pages / more rows of the same
problem." We sell the **outcome**: the fixes, the artifacts that apply them, and the proof they worked.

## 3. Locked engineering decisions (v1)

These are principal-engineer calls for v1. They are decisions, not options — flag in review only if a hard constraint
breaks them.

| # | Decision | Rationale |
|---|---|---|
| D1 | **Reproducibility is conversion prerequisite #1.** | A wrong free result is anti-conversion; nothing else matters until grades are trustworthy and stable. |
| D2 | **Static-HTML crawl only for v1 — no headless/JS rendering.** | Keeps COGS under the ≤18%-MRR ceiling and reliability high. The static read *becomes* the AI-readiness "what a non-rendering AI agent sees" feature. Optional JS rendering deferred to a post-revenue Pro add-on. |
| D3 | **Prescriptive fixes are algorithmic/deterministic for v1 — no LLM calls.** | Zero per-call cost, reproducible, no API-key/budget dependency. Link suggestions come from graph structure + lightweight content relevance (shared tokens/TF-IDF over titles/headings/anchors). LLM-enhanced suggestions deferred as a capped, gated Pro add-on. |
| D4 | **Gate VALUE, not VOLUME.** | The page cap stays as a soft usage gate, but the *primary* Pro wall is fixes + artifacts + monitoring + privacy/white-label. "See more of the same problem" is the weakest lever for this audience. |
| D5 | **Monitoring is the spine of monthly Pro.** | Built in Phase 5 but *teased* in the Pro pitch from Phase 2 onward. |
| D6 | **Keep the existing brand (cream/orange, the wordmark) but elevate to a real, professional design system.** | This is a polish/quality pass, not a rebrand. "Looks like a weekend project" is itself a conversion killer; "looks competent" makes paying feel safe. |
| D7 | **Claude Code performs all coding, testing, and deployment** under the SDLC in §6, using the existing repo conventions in `PROJECT_OVERVIEW.md` §11/§13. |

## 4. Success metrics (the dashboard)

Instrument all of these in PostHog. These four numbers govern the 2-month push:

- **Activation:** landing → audit-completed. Today ≈ 5%. **Target ≥ 30%.**
- **Aha→share:** audit-completed → share-action. Today ≈ 0. **Target ≥ 15%.**
- **Virality:** share → new audit (coefficient). Today ≈ 0. **Target → 1.**
- **Conversion:** free → Pro. Today ≈ 0. **Target 3–5%.**

**Revenue math (reference):** $1,000 MRR ≈ 53 Pro-equivalent subs; $3,000 ≈ 158. At 3–5% conversion that needs ~1,060–5,270
activated audits. Treat **$1–1.5k as base case, $3k as stretch** contingent on virality + the builder/affiliate channel.

## 5. Phase plan & spec index

Build strictly in this order. Phases may overlap at the seams, but **no phase that depends on a trustworthy grade ships
before Phase 1 passes its acceptance gate.**

| Phase | Name | Spec | Goal | Gate to exit |
|---|---|---|---|---|
| **0** | Baseline & working agreement | this doc + kickoff prompt | Repro the reproducibility bug with a failing test; establish SDLC scaffolding; capture current PostHog baselines | Failing test exists that encodes the bug; baselines recorded |
| **1** | Engine reliability & reproducible grade | **SPEC 01** | Trustworthy, cap-independent grade; no false findings; polite reliable crawl; visible crawl-health/confidence | Same site → same grade ±2 across page caps; zero false "unreachable" on 200 pages; crawl-health emitted; tests green; smoke passes |
| **2** | Conversion core | **SPEC 02** (features) + **SPEC 03** (UX/onboarding/payment) | Prescriptive fixes; value-not-volume gating; the **single-fix reveal** + **projected achievable grade** in free; the designed conversion-moment screen; Stripe flow polish | Conversion-moment screen live; one full fix free; projected grade computed; checkout→Pro entitlement proven |
| **3** | Viral loop | **SPEC 04** | Real streamed link-graph + grade reveal; rich dynamic share card; frictionless multi-channel share (no forced verification); indexable public reports | Live graph renders; share card carries grade+percentile+graph; verification removed from public-report mint; report pages indexable |
| **4** | AI / agent-readiness lens | **SPEC 05** | Technical AI-readiness score (robots.txt AI-crawler access, content-without-JS, schema, semantic HTML, llms.txt) reusing the static engine | AI-readiness score + free top issues + Pro full report/artifacts; findings caveated by crawl-health |
| **5** | Monitoring & delta tracking | **SPEC 06** | Scheduled re-audits, delta alerts, "watch your grade climb" — the monthly-Pro spine | Re-audit cron + deltas + alert emails; before/after grade history |

**Reference appendix (do not hand to Claude Code as instructions):** the prior research report *"Crawlmouse: Engine
Correctness, Viral Loop, and AI-Readiness Build Specs"* is the cited evidence base behind these decisions (algorithms,
parameters, market data). Specs 01–06 are the buildable distillation; the research report is the "why."

## 6. SDLC / working agreement (every change)

Mirror the repo's existing process (`PROJECT_OVERVIEW.md` §13):

1. **Spec → plan.** For each task, Claude Code first restates scope and produces a short implementation plan.
2. **TDD.** Write failing tests that encode the acceptance criteria *before* implementation. For Phase 1, the first test
   reproduces the reproducibility bug.
3. **Implement** to green, smallest viable change.
4. **Adversarial review gate.** Run the project's 3×-reviewer gate (correctness / security / deploy-safety / test-quality),
   fix-loop to ≥9, 0 blocking.
5. **Smoke.** After ANY engine/crawl-path change, run a live audit smoke (`pnpm smoke -- --url=…`) — unit tests cannot
   catch the prod-only pipeline bugs documented in `PROJECT_OVERVIEW.md` §11.
6. **Deploy** via the git-linked Vercel flow; verify on production.
7. **Conventions:** `nvm use 22`; never reference AI tools in commits/PRs (strip `Co-Authored-By`); static route-segment
   exports; keep `crawlee` a direct `apps/web` dependency; `turbo.json build.env` lists every build-time env var.

## 7. Definition of done (global)

A phase is done only when: acceptance gate met, tests green, review gate passed, live smoke passes, deployed to prod,
and the relevant PostHog events fire correctly. No "proven live" claim is accepted from the local Inngest dev server —
only from the deployed Vercel function (see `PROJECT_OVERVIEW.md` §11).

## 8. Risk register

- **R1 — Reproducibility not fully fixed.** Any growth amplifies "this tool is wrong." Mitigation: Phase 1 is a hard gate;
  the books4.you fixture must pass.
- **R2 — COGS creep.** JS rendering and LLM calls are the two things that breach ≤18% MRR. Mitigation: D2/D3 keep both out
  of v1; revisit only with metering.
- **R3 — Scope sprawl / AI-agent API distraction.** The MCP/API business is real but is explicitly post-v1 (a later spec
  07). Do not start it until Phases 1–5 ship.
- **R4 — Timeline.** Freemium conversion is slow; the 2-month number leans on virality (Phase 3) + the builder channel.
  Mitigation: ship Phases 1–3 fast; treat $3k as stretch.
