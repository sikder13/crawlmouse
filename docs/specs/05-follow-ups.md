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

**NOT a lone-surrogate risk today — but for a different reason than this ticket first recorded.** The
original justification ("cheerio/htmlparser2 maps surrogate-range numeric character references to
U+FFFD") is true only for NCRs. A gate reviewer measured the raw case: `a&#xD800;b` in a `<title>`
becomes `61 fffd 62`, but a **raw** `\ud800` code unit in the source passes through to `pages.title`
unchanged. Neither field is truncated, so neither can be *split* — that part holds, and the exposure
today is **size only**.

The real protection is upstream and dependency-owned: `@crawlee/cheerio`'s `_parseHTML` decodes the
body with a UTF-8 `TextDecoder`, which emits U+FFFD for any byte sequence that would decode to a
surrogate — even when the response declares `charset=utf-16le`. The hazard is live one layer beneath
it: Node's `Buffer.toString('utf16le')` and iconv-lite both return a lone surrogate for those bytes.
**`crawlee` is caret-pinned** (`PROJECT_OVERVIEW` §12 watch-item), so if a minor bump ever honours the
declared charset there, raw `pages.title` becomes audit-fatal with no test in this repo covering it.
Fold a well-formedness pass into this ticket alongside the size caps, and treat this as an argument for
exact-pinning `crawlee`.

### The exposure this ticket UNDER-RECORDED: the same field is served to every FREE viewer

`apps/web/lib/graph-assembly.ts:80` copies raw `pages.title` into each graph node. The node list is
capped in COUNT (`FREE_GRAPH_NODE_CAP = 150`) and not in bytes, so:

| measured | |
|---|---|
| `pages.title` from one crafted page | 1,000,000 chars |
| `assembleGraph` serialized, 150 nodes | **150.03 MB** |
| SPEC 05's `aiSignals.title` on the same page | **200 bytes** |

That 150 MB is a single SSE `event: done` line served to **every viewer, anonymous included**, on the
conversion-critical result page — on every load, not once. This ticket previously logged only the
storage-inflation and insert-body axes; the client-payload axis is larger than both and was unrecorded.

The contrast is the point: SPEC 05's own copy of the same title is bounded at 200 bytes because it is
capped at the source. The graph node is the pre-existing field beside it.

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

> **Scope note (owner ruling, 2026-07-28).** The SPEC 05 branch's headline is *"the SPEC 05 class is
> closed AT THE SOURCE"* — every crawled string entering `PageAiSignals` / `AiFinding` is bounded once,
> at construction. It is **not** a claim that the class is closed everywhere in the repo. This ticket is
> a **scheduled follow-up with the shared utility already merged and ready**, not a denial that the
> defect exists. Two independent gate reviewers flagged it unprompted; both were right to, and both
> agreed the deferral is defensible. SPEC 5.1 planning picks it up.


---

## FU-7 — Three live SPEC 02 cutters split surrogate pairs on the audit-fatal path (PRE-EXISTING; owner-deferred 2026-07-27)

**Where** (all `packages/engine/src/projection/`):

| Site | Cuts | Sink | Measured |
|---|---|---|---|
| `action-packet.ts:33` `sanitizeText` | crawled title / anchor / topic | `fixes.action_packet_body` | splits at caps **200, 120, 80, 40** |
| `action-packet.ts:38` `sanitizeUrl` | crawled canonical URL | same | splits at cap **300** |
| `ledger.ts:60` `cleanInline` | crawled title → `target_title` / `rationale` / `suggested_links` | `fixes` (text + jsonb) | structurally identical to `sanitizeText` |

**Probe** (re-runnable; the odd offset is essential — an even-length astral fixture lands on a pair
boundary and reports a false negative):

```ts
const odd = (n: number) => 'A' + '\u{1F600}'.repeat(n);
sanitizeText(odd(600), 200);                        // -> lone surrogate
sanitizeUrl(`https://ex.com/${'\u{1F600}'.repeat(400)}`, 300);  // -> lone surrogate
```

### PRIORITY RAISED 2026-07-28 — the oracle test found a second, wider fatal channel

The SPEC 05 round added `packages/engine/src/postgres-roundtrip.test.ts`, which asks a real Postgres
(PGlite) instead of reasoning about it. Measured:

| input | `jsonb` | `text` |
|---|---|---|
| **NUL (U+0000)** | REJECTED 22P05 | **REJECTED — "invalid byte sequence for encoding UTF8: 0x00"** |
| lone surrogate | REJECTED 22P02 | accepted |
| C0 (SOH), DEL, astral, CJK, ASCII | accepted | accepted |

**This widens FU-7.** The original write-up scoped the defect to jsonb, on the reasoning that
`sanitizeText`'s surrogate-splitting output lands in `fixes.suggested_links`. But `sanitizeText` and
`cleanInline` also write `fixes.target_title`, `fixes.rationale` and `fixes.action_packet_body`, which
are **`text` columns** — and a NUL is fatal there too. Neither function strips NUL.

Reachability differs by channel and both matter:
- a **lone surrogate** can only be produced by their own char-index cut, and the rejection is
  **COLUMN-AGNOSTIC** — see the correction below;
- a **NUL** is not produced by HTML parsing (htmlparser2 maps it to U+FFFD, verified) but IS produced by
  `JSON.parse` of crawled JSON — and any SPEC 02 path that ever carries a JSON-derived string into a
  `fixes` text column inherits an audit-fatal write.

**Consequence for scheduling: this ticket is no longer "one line per site".** The fix is to route all
three cutters through `toPersistableText`, which now repairs surrogates AND strips NUL AND budgets in
UTF-8 bytes in a single call — so the change is still small, but it closes two fatal channels rather
than one, and it should be scheduled sooner than the original MEDIUM/latent framing implied.

**Severity: MEDIUM, latent.** Postgres rejects an unpaired surrogate in jsonb (22P02), so the `fixes`
insert throws in `persistAuditResults` and the WHOLE AUDIT fails — the same fatal path as SPEC 05's B1.
SPEC 02 is live in production behind ENGINE_V2, so this is shipped code. **No observed occurrences:**
no `insert failed` issue in Sentry over 90 days, and the single `audit.failed` group (13 events since
2026-06-13) is `"unable to get local issuer certificate"` — TLS, not this.

### Why it was pulled OUT of the SPEC 05 branch (owner ruling, 2026-07-27)

The fix was approved, implemented, and then withdrawn when the facts changed: the diff had grown to
touch `crawler.ts`, `ledger.ts` and `action-packet.ts` (live SPEC 02 code), the Stage-7 gate failed
with 8 blocking findings, and no pre-merge live smoke is possible (preview deployments never execute
the worker — see `[[reference_preview_cannot_start_audits]]`). Touching live engine code with no live
smoke, on a branch already failing its gate, is a worse risk than a latent defect with a 90-day clean
Sentry record. The branch returned to **additive SPEC 05 code only**.

Also pulled out with it, all non-fatal: `inngest/progress.ts` `capActivityLabel` (a split pair poisons
`audits.crawl_activity`, whose write is swallowed — progress silently stops updating for the rest of
the crawl); `apps/web/lib/billing/csv.ts` (malformed UTF-8 in the Pro CSV); `audit-crawl-health-telemetry.ts`
and `audit-failure-sentry.ts` (operator telemetry); `crawler.ts` `activityPath`'s raw fallback;
`apps/web/lib/audit-activity.ts` (cosmetic client-side re-cut — it does NOT need the persistence
utility, and importing it there dragged the engine barrel into the client bundle and broke `next build`).

### The fix, when scheduled — each is ONE line

`packages/engine/src/text-safety.ts` **already exists and is merged with SPEC 05**, exported as
`toPersistableText` — the single sanctioned entry point (the code-unit helpers it replaced have been deleted, deliberately, so they cannot be reached for). Each site becomes:

```ts
return toPersistableText(collapsed, cap);   // instead of collapsed.slice(0, cap)
```

`apps/web/__tests__/crawled-text-cut-guard.test.ts` already inventories all three, classified
`"crawled text, cut WITHOUT the shared helper — PRE-EXISTING, tracked as FU-7"`, so the ticket has a
ready-made checklist: when they are fixed, those inventory reasons change and the guard forces the
update.

**Requires:** a live audit smoke on the deployed function per CLAUDE.md §6 (static site / throttling
WordPress / JS-SPA), since it touches the crawl/projection path.

### Related, measured round 4: `links` and `findings` are still ONE un-chunked insert each

`inngest/persist-results.ts` chunks the `pages` insert (250 rows) but sends every `links` row in a
single request, and `links.anchor_text` is uncapped by the same FU-6 decision. There is **no cap on
link count anywhere in the engine**, so at PRO_PAGE_CAP that is O(10^5) rows carrying raw crawled
anchors — the same "PostgREST/Kong rejects the body ⇒ thrown insert ⇒ whole audit fails" mode the
`pages` chunking removed, on a larger body. `findings` and `fixes` likewise.

Owner ruling 2026-07-28: **DEFER to this ticket.** Pre-existing, live on `main`, not a SPEC 05
regression. When scheduled, chunk all four inserts with the same `PAGE_INSERT_CHUNK` idiom — the
delete-then-insert idempotency already in place makes it a mechanical change.

### Known SPEC 05-visible consequence while this is open

SPEC 05's Pro `aiPackets` embed crawled excerpt and title through `sanitizeText`, so a packet body a
Pro owner copies can contain malformed UTF-16. **Bounded and non-fatal:** packets are built on demand
at projection and are NEVER persisted (D4), so no 22P02 path exists. Stated explicitly in
`apps/web/lib/ai-readiness-packets.test.ts` and `apps/web/lib/audit-stream-projection.test.ts` rather
than left as a silent gap in the RULE tests.

**Disposition:** LOGGED, owner-deferred 2026-07-27, with the probes and measurements above so the next
session does not have to re-derive them.

> **Scope note (owner ruling, 2026-07-28).** The SPEC 05 branch's headline is *"the SPEC 05 class is
> closed AT THE SOURCE"* — every crawled string entering `PageAiSignals` / `AiFinding` is bounded once,
> at construction. It is **not** a claim that the class is closed everywhere in the repo. This ticket is
> a **scheduled follow-up with the shared utility already merged and ready**, not a denial that the
> defect exists. Two independent gate reviewers flagged it unprompted; both were right to, and both
> agreed the deferral is defensible. SPEC 5.1 planning picks it up.


---

## FU-8 — Known residual gaps in the two source guards (owner-scoped, 2026-07-28)

Both guards in `apps/web/__tests__/crawled-text-cut-guard.test.ts` received **one** improvement pass at
the owner's direction, closing every evasion the round-3 reviewers verified. What remains is logged
here rather than iterated further: guard completeness protects *future* code, and the current code is
proven clean by the build, the byte measurements and the behavioural suites.

**Classification: NON-BLOCKING.** These are test-infrastructure gaps, not shipped-behaviour defects.

### Closed in the improvement pass (each proven by reintroducing it)

| Evasion | Guard now catches |
|---|---|
| `'use client'` file in `apps/web/lib` (e.g. `trpc/client.ts`, `trpc/Provider.tsx`) importing the barrel | ✔ seeds from every `'use client'` file under `apps/web` |
| Hoisted truncation regex, when the const NAME contains TRUNC/CUT/CAP/LIMIT/MAX | ✔ `CUT_HOISTED_RE` — **name-gated, see the residual below** |
| Computed member access (`v['slice'](0, n)`) | ✔ `CUT_COMPUTED` |
| `Buffer.from(v,'utf16le').toString('utf16le', 0, n)`, simple argument | ✔ `CUT_BYTES` — **fails on a NESTED paren, see below** |
| Workspace specifiers (`@crawlmouse/types`, `@crawlmouse/inngest`) truncating the import walk | ✔ resolved via the same `paths` mapping the build uses |
| `.js` specifiers (next.config `extensionAlias`) | ✔ resolved |
| Multi-line `import type { … } from` treated as a runtime edge | ✔ stripped (it was a false positive) |
| Relative deep import into `packages/engine/src` | ✔ matched on the extracted specifier |

### Remaining, verified, deliberately not fixed

**1. Manual char-accumulation loop — the cut spelled as arithmetic.**
```ts
let out = '';
for (let i = 0; i < cap; i++) out += v.charAt(i);   // VERIFIED to split a surrogate pair
```
Every line-based pattern that matches this also matches legitimate single-character reads —
`email.trim().charAt(0)` for an avatar initial, `charCodeAt(i)` inside `text-safety.ts` itself. A rule
producing that much noise gets suppressed within a week, which is worse than not having it. Detecting
it properly needs AST analysis (an ESLint rule with scope awareness), not a line scan.

**1b. CORRECTION — two entries above were claimed closed and are not.** Round-4 review verified both:

```ts
const HEAD_RE = /^([\s\S]{0,100})[\s\S]*$/;   // name has no TRUNC/CUT/CAP/LIMIT/MAX -> EVADES
v.replace(HEAD_RE, '$1')

Buffer.from(String(v), 'utf16le').toString('utf16le', 0, 200)   // nested paren -> EVADES
```
The second was **verified to split a surrogate pair**. `CUT_HOISTED_RE` is name-gated and `CUT_BYTES`
uses `[^)]*`, which cannot span a nested `)`. Also evading: `const { slice } = String.prototype;
slice.call(v, 0, n)` and `v[KEY](0, n)` with a variable key. These are corrected here rather than
patched, per the convergence rule — the detector is syntactic by nature and the behavioural backstops
(`postgres-roundtrip.test.ts`, `persisted-text-wellformed.test.ts`) do not depend on it.

**2. Multi-line member expressions.**
```ts
v
  .slice
  (0, 500);
```
Contrived — no formatter in this repo produces it — and it would fail review on sight.

**3. THE GUARD COVERS CUTS ONLY — not the inbound channel.** It detects a *truncation operation* on
crawled text. The other half of the hazard class needs no cut at all: `JSON.parse` of crawled JSON-LD
yields lone surrogates and NUL whole (this is how the round-1 and round-4 blockers arrived), and
nothing in the guard would notice a crawled-JSON-derived string reaching a `fixes` / `links` /
`findings` sink. That half is covered by behaviour, not by the guard —
`packages/engine/src/postgres-roundtrip.test.ts` and `persisted-text-wellformed.test.ts` — and both
are scoped to the engine's `aiSignals` output, so the SPEC 02 sinks in FU-7 have no equivalent
backstop until that ticket lands.

**4. Guard scope is `apps/web`, `packages/engine/src`, `packages/types/src`, `inngest`.**
Not scanned: `scripts/` (operator tooling, never persists crawled text), `packages/*/dist` (build
output), and third-party code.

### Why this is the right stopping point

The behavioural backstops do not depend on the guards: `persisted-text-wellformed.test.ts` asserts the
RULE over the serialized payload at both page caps with every axis worst-case, the byte ceilings are
measured with `Buffer.byteLength`, and `next build` is a hard release gate for the client-bundle class.
A guard that misses an idiom nobody uses is a smaller risk than a guard nobody trusts.

**When scheduled:** an ESLint rule (`no-restricted-syntax` on member expressions whose object is a
crawled-text-typed identifier) would subsume all three residuals and remove the inventory's
maintenance cost. Reasonable SPEC 5.1 candidate.

---

## FU-9 — The A15 harness gives no clean signal on sub-15%-coverage WAF'd sites (SPEC 5.1 evidence)

**Observed across rounds 4 and 5 on the same site, with byte-identical grade-path code.**

`pageforge.pro` — 11% coverage, ~16–25% of fetches blocked, wall-clock budget exhausted on both runs:

| | round 4 | round 5 | round 6 |
|---|---|---|---|
| Δ (v1↔v2) | +0.30 | **+2.51** | **+4.45** |
| grade | same | **C+ → B−** | **C+ → B−** |
| coverage / block rate | 10% / 25% | 11% / 16% | ~12% / ~20% |
| finding deltas | `orphan:-3` | **`unreachable_page:-25`** | budget-truncated at 261.8 s |

**Three runs, byte-identical grade-path code, monotonically diverging.** That is the strongest form of
the evidence: not noise around a fixed value, but a measurement whose spread is set entirely by which
pages the crawl happened to reach.

Both columns of a backtest row come from the *same* crawl, so this is not v1-vs-v2 noise: it is that
**the crawl reached a materially different subset of the site each time**. On a heavily-blocked,
budget-truncated crawl the subset is the dominant variable, and it swamps the engine difference the
harness exists to measure.

**Why this belongs in SPEC 5.1.** This is the duskroute phenomenon — crawl-composition instability —
appearing *inside our own measurement instrument* rather than in a user's grade. It means:

- A15 cannot certify "no grade delta" on this class of site. Grade-neutrality claims for such
  branches must rest on a deterministic pre/post probe over fixed input
  (`evidence/grade-identity-spec05-hardening.md`), with A15 as corroboration, not proof.
- The same instability is what a **user** on such a site experiences between two audits of their own
  site — the monitoring/delta feature (SPEC 06) will surface it as phantom grade movement unless
  crawl composition is stabilised or the delta is confidence-gated.

**Suggested handling in 5.1:** record per-run crawl composition (the set of fetched URLs, not just the
count) and either pin the frontier for repeat audits of the same site, or gate delta reporting on
coverage/block-rate so a low-confidence re-crawl cannot report a grade change it did not earn.

---

## FU-10 — Round-8 residuals: TRUNCATE grants, runtime skew, CURIE types, guard off-by-ones

Logged rather than fixed, per the convergence rule: none of these is a defect a real site or user can
trigger in shipped behaviour. Recorded with the measurement so the next round starts from evidence
instead of re-deriving it.

### 10a — `anon`/`authenticated` retain DELETE and TRUNCATE on `pages`, `audits`, `public_reports`

Read-only verification against production: those table ACLs carry `d` (DELETE) and **`D` (TRUNCATE)**
for `anon`. **Postgres RLS does not gate TRUNCATE**, so the deny-by-default policy set is not the
control here.

Not reachable through the shipped surface — PostgREST never emits TRUNCATE, and the anon publishable
key is not a database credential — and it is the Supabase default on every table, so this is not a
SPEC 05 regression. But **"minted public-report immutability" is a `CLAUDE.md` §5 non-regression item
resting on a grant that RLS does not back up**, which is worth closing deliberately rather than
inheriting. Fix is a one-line `revoke truncate, delete on ... from anon, authenticated` migration —
**owner-applied, and out of scope for this branch** (SPEC 05 touches no grants beyond migration B).

### 10b — Verification ran on Node 22; production runs Node 24

Vercel project `crawlmouse-001` reports `nodeVersion: "24.x"`; every test, typecheck, lint, build and
mutation run in this branch used Node 22 (`nvm use 22`, the repo convention). Ordinarily immaterial —
but this branch's changes are concentrated in Unicode handling and JSON serialization, which is exactly
where a V8 major could differ. Either pin CI/local to the deployed major or add a Node-24 job; until
then the live smoke on the deployed function is the only Node-24 evidence.

### 10c — CURIE-form `@type` (`schema:Organization`) is not recognised

`ENTITY_TYPES` holds bare names and both full-IRI spellings, not the CURIE form a `@context`-mapped
document may use. Raised in review as a possible false-negative source. **Measured on the corpus:
0 of 69 homepages used a CURIE-prefixed `@type`** (`evidence/ai-entity-scan-delta.md`). Widening a
scoring predicate at a final gate with zero measured beneficiaries is the wrong trade, so this is
deferred to the FU-4 entity-signal work, where it can be measured against a corpus that contains the
shape.

### 10d — Guard off-by-ones in the employer walk that no behaviour can distinguish

`creditableEntityAt`'s `depth + 2` → `depth + 1` mutant survives the suite: both values sit far below
`JSON_LD_ENTITY_SCAN_MAX_DEPTH`, so no document distinguishes them without a fixture built at the exact
boundary. The walk's *reachable* behaviour — node budget, depth bound, array traversal on `author`,
`worksFor` and `@type` — is pinned as of round 8. This is the FU-8 class: a guard-precision gap, not a
behaviour gap. Same for `toPersistableText`'s `< 1` arm, which is provably equivalent to the loop's own
`width > maxBytes` break.
