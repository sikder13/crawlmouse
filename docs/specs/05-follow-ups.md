# SPEC 05 — Logged follow-ups (non-blocking)

Items surfaced during the SPEC 05 build/review that are deliberately NOT fixed in the SPEC 05 branch.
Owner-acknowledged at the Stage 2 gate. Each is non-blocking; listed here so nothing is lost.

---

## FU-1 — Short-name content grids can be dropped from the "What AI Sees" excerpt (SPEC 05, excerpt-only)

**Where:** `packages/engine/src/analysis/ai-readiness/main-content.ts` — the density filter's menu-vs-grid
discriminator `avgLinkText < MENU_AVG_LINK_CHARS (30)`.

**Symptom:** A content grid whose links are SHORT on average — e.g. a category page listing bare product
names (`iPhone 15`, `Galaxy S24`, …), avg link text ≈ 9 chars — is structurally indistinguishable from a
navigation menu and is dropped from the excerpt. A blog-index / card grid whose links wrap a title + blurb
(avg > 30) is correctly kept.

**Severity: MINOR.** Excerpt-only and **grade-neutral** (`aiSignals` never feeds `grade.ts`). It can NEVER
produce a false `js_blind`: a static short-name grid carries no CSR signals → classed `thin`, whose content
subscore is 1.0, identical to `readable`. When the grid is the WHOLE page, the empty-fallback restores it;
only a short-name grid embedded alongside other content loses its names from the excerpt.

**Disposition:** Logged, not fixed. `MENU_AVG_LINK_CHARS` is fixture-tunable. Owner ruling: keep `= 30`;
revisit at the Stage 5 eyeball on real whole-site-simulator output, not before.

---

## FU-2 — Deep-nesting inside an `<a>` can throw `RangeError` out of link extraction (PRE-EXISTING; crawler robustness, NOT SPEC 05)

**Where:** `packages/engine/src/extract.ts` — the link-extraction loop `$(el).text()` over anchor elements
(predates SPEC 05; unchanged by this branch).

**Symptom:** An attacker-controlled page with an `<a>` wrapping thousands-deep nested markup makes cheerio's
recursive `.text()` overflow the call stack, throwing an uncaught `RangeError` out of `extractPage` — which
is called with no try/catch in the crawler request handler (`crawler.ts`), so Crawlee retries the page up to
`MAX_REQUEST_RETRIES` before dropping it (budget/CPU amplification against the ≤18%-MRR ceiling).

**Note:** SPEC 05's own extraction is already shielded — `computePageAiSignals` is wrapped in try/catch in
`extractPage`, so the AI feature degrades to `aiSignals: undefined` and never throws. This FU is about the
*pre-existing* title/link extraction path, which is outside SPEC 05's ownership.

**Minimal repro:**
```ts
import { extractPage } from '@crawlmouse/engine/extract';
const html = `<a href="/x">${'<span>'.repeat(6000)}deep${'</span>'.repeat(6000)}</a>`;
extractPage(html, 'https://example.com/'); // throws RangeError: Maximum call stack size exceeded
```

**Severity: MINOR (DoS-lite).** Cannot crash the worker process (Crawlee contains the throw); no memory-safety
issue or data leak. Bounded per-page, but burns retries + CPU on a hostile page.

**Disposition:** Logged, NOT fixed in this branch — crawler robustness is outside SPEC 05 ownership (CLAUDE.md
§8 phase discipline). Owner will schedule it as a standalone engine patch post-SPEC-05. Suggested fix when
scheduled: wrap the per-anchor `.text()` (or all of `extractPage`) in try/catch and/or bound anchor-subtree
depth, mirroring the SPEC 05 AI-extraction shield.

---

## FU-3 — Access-matrix robots-matching amplification on a pathological robots.txt (SPEC 05, bounded)

**Where:** `packages/engine/src/analysis/ai-readiness/access-matrix.ts` — `isAllowedByRobots` per bot × page.

**Symptom:** the matrix runs ~14 bots × up to 500 pages = ~7 000 `isAllowedByRobots` calls, each iterating the
matched UA group's disallow+allow arrays. A pathological multi-MB robots.txt (the crawl's robots fetch uses
safeFetch's 10 MB default) parses to a huge rule count → the matcher (linear per call, NOT quadratic — it
avoids regex translation) still runs ~rules×7 000 ops.

**Severity: MINOR.** The path axis is bounded by the 500-page cap; the rule-count axis is bounded by the
robots the crawler ALREADY parsed and matches per enqueued link (pre-existing cost). The Stage-3 change only
adds the ×14-bots multiplier. **Disposition:** logged. Clean fix (also helps the crawler): cap the robots.txt
fetch `maxBytes` (a control file is tiny). Deferred; the llms.txt fetch is already capped (`LLMS_TXT_MAX_BYTES`).

---

## FU-4 — Homepage entity sub-signal uses a types-based proxy, not §5's `sameAs` (SPEC 05, tracked deviation)

**Where:** `packages/engine/src/analysis/ai-readiness/assemble.ts` — the homepage-entity legibility sub-signal.

**Symptom:** §5 wants "Organization or WebSite JSON-LD **with a non-empty `sameAs` array**"; the code checks
only `jsonLd.types` includes `Organization|WebSite`. A homepage with bare `Organization` schema but no `sameAs`
passes here yet should fail per §5 → a `missing_entity_link` false-negative and ≤3 points of legibility
inflation. The exact check needs a Stage-2 extraction change (`PageAiSignals.jsonLd` carries `{present, valid,
types}` only — no `sameAs`).

**Severity: MINOR.** **Disposition:** deferred to the Stage-5 eyeball tuning pass (owner ruled thresholds are
revisited at Stage 5). When addressed: add `entitySameAs` to the jsonLd extraction + the `jsonLd` signal shape.

---

## FU-5 — Fence-breakout security test can cold-start-flake under parallel vitest (SPEC 05, Stage 4)

**Where:** `apps/web/lib/ai-readiness-packets.test.ts` — the fence-integrity assertion
`(body.match(/```/g) ?? []).length === 2` in the "crawled text cannot break the markdown fence" case.

**Symptom:** on a cold, parallel, multi-file vitest run the Stage-4 review observed this assertion fail ONCE
(`expected 3 to be 2`), then pass on 20+ subsequent runs (isolated, cold-no-cache ×6, multi-file ×6) and a
subsequent 6× cold probe. A 100 000-iteration in-process stress of `buildAiPackets` always yields exactly one
fence pair, so the builder is provably deterministic; the flake is a vitest cold-start transform race on the
first concurrent load of the shared engine escaper module, NOT a product defect.

**Severity: MINOR.** The flake **fails CLOSED** — a spurious red can only over-report, never mask a real fence
breakout / excerpt leak. No security exposure.

**Disposition: RESOLVED at the Stage-7 gate (2026-07-27), owner ruling — resolve, do not accept.**

The logged diagnosis ("a vitest cold-start transform race") is the explanation left standing once the
builder was exonerated, not a mechanism anyone observed. Formally accepting an unexplained flake in a
SECURITY assertion is the same move as bounding one layer and declaring the class closed, so the
assertion was **replaced rather than pinned**: `apps/web/lib/ai-readiness-packets.test.ts` now carries
property-based tests (fast-check) over generated hostile crawled text — backticks, fences, forged
`System:`/`Task:`/`Data:` lines, astral characters and lone surrogate halves — asserting exactly one
fence pair, exactly one `Task:` and one `System:` line, no backtick surviving inside the DATA region, a
well-formed-UTF-16 body, and byte-determinism. This kills the class rather than the instance, the same
way a property test made the percent-decode class go extinct in one round.

**If it still flakes after this, the flake is real and environmental — escalate, do not accept.**

---

## FU-6 — `pages.title` and `links.anchor_text` are persisted UNBOUNDED (PRE-EXISTING SPEC 01; SPEC 5.1 candidate)

**Where:** `packages/engine/src/extract.ts:105` (`$('title').first().text().trim()`) and
`packages/engine/src/extract.ts:127` (`$(el).text().trim().replace(/\s+/g, ' ')`). Neither is capped
anywhere between extraction and the `pages` / `links` insert.

**Measured (Stage-7 audit, 2026-07-27):**

| Field | Persisted length from one crafted page |
|---|---|
| `pages.title` | **1,000,000 chars** |
| `links.anchor_text` | **500,000 chars** |

Both are attacker-controlled (anyone can submit a URL they control) and both are multiplied by the page
cap: at `PRO_PAGE_CAP` = 2000 the `pages` insert body is bounded only by how large a title the target
site is willing to serve. Same class as the SPEC 05 defects B3/C3 that were fixed in the Stage-7 round.

**NOT a lone-surrogate risk.** The Stage-7 audit established the producer set empirically: HTML text
extraction cannot emit an unpaired surrogate (cheerio/htmlparser2 maps surrogate-range numeric character
references to U+FFFD per the HTML spec, verified), and neither field is truncated, so neither can be
split. The exposure here is **size only**.

**Severity: MINOR–MEDIUM.** Cost/availability, not correctness or disclosure: 30-day storage inflation
against the ≤18%-MRR ceiling, and at the extreme an insert body large enough to OOM or time out the
audit. No observed occurrences (no matching Sentry issue in 90 days as of 2026-07-27).

### Why it was NOT fixed in the SPEC 05 branch (owner ruling, 2026-07-27)

Capping at **extraction** would change `isGenericAnchor` and the anchor-diversity inputs, which feed
`grade.ts`. That is a **grade change** — CLAUDE.md §5 non-regression territory, requiring explicit
sign-off and a backtest. Out of scope for a branch whose acceptance criterion was zero grade deltas.

### The design when scheduled

**Cap at the PERSISTENCE boundary, not the analysis boundary** — in `buildPageRows` / `buildLinkRows`
(`inngest/persist-helpers.ts`), using the existing shared helper:

```ts
title: p.title == null ? null : toPersistableText(p.title, MAX_PERSISTED_TITLE_CHARS),
anchor_text: l.anchorText == null ? null : toPersistableText(l.anchorText, MAX_PERSISTED_ANCHOR_CHARS),
```

This bounds the database while leaving **every analysis input and the grade byte-identical**, because
the engine keeps operating on the full strings and only the persisted copy is cut. The helper already
guarantees the cut cannot split a surrogate pair, so the cap introduces no new failure mode.

Still needs its own backtest to confirm byte-identical grades, plus a rule test at `PRO_PAGE_CAP` and an
entry in `apps/web/__tests__/crawled-text-cut-guard.test.ts`.

**Flagged explicitly as SPEC 5.1 candidate scope** — 5.1 touches this path anyway, so the cap and its
backtest should ride along rather than becoming a standalone engine patch.

**Disposition:** LOGGED, owner-deferred 2026-07-27. Tracked with measured numbers so the next session
does not have to re-derive them.
