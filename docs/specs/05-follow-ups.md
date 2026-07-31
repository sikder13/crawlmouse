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

### 10d — Guard off-by-ones in the employer walk — **WITHDRAWN, code deleted**

Described `creditableEntityAt`'s `depth + 2` vs `depth + 1` residue. That function, and the whole
traversal-only mechanism around it, was deleted by 10e. Nothing to carry forward.

(The one part that outlived it: `toPersistableText`'s `< 1` arm is still provably equivalent to the
loop's own `width > maxBytes` break — a genuine equivalent mutant, not a coverage gap.)

### 10e — `author.worksFor` crediting — **DECIDED AND REMOVED, not open**

**Resolved at the round-8 review. No decision remains; recorded for history only.**

Two reviewers independently reproduced that `author.worksFor` credited a THIRD PARTY: on a syndicated
article the reporter's employer is the wire service, not the site. The owner ruled it **out**, reversing
their own earlier instruction that had put the position in — *"my instruction put it in and my
instruction was wrong."*

It failed the crediting rule (*credit a position only if it can ONLY mean self-declaration*) exactly as
`provider` and `mainEntity` had, and the asymmetry settled it: a false positive **suppresses a true
finding**, handing +3.0 to a site that genuinely does not declare itself — the product lying toward
comfort — while a false negative merely asks a site to add markup.

**What shipped:** `author` no longer credits in any shape. The removal deleted the entire traversal-only
mechanism that existed for nothing else — `TRAVERSAL_ONLY_KEYS`, `creditableEntityAt`,
`creditsViaWorksFor`, and the `creditable` flag — and with it **FU-10d and FU-10h, which only described
that mechanism's guard residue**. The round-7 blocking fix for array-valued `author` went with it; that
fix was correct for the design it served, and the design is gone. Pinned by a fixture asserting every
`author` shape (object, array, nested array, `@type` array, nested author, root `worksFor`) is NOT
credited, plus a companion asserting the surviving positions still are. Re-measured on the corpus after
removal: identical 69 / 4 / 0 / 65, zero losses.

### 10f — the §6 live smoke has NOT been run for this branch

`CLAUDE.md` §6 and SPEC 00 §6.5 require `pnpm smoke` against the **deployed Vercel function** after any
engine/crawl-path change, and `legibility.ts` runs inside `extractPage` on every crawled page. This
branch has not had one, and the gate evidence is `turbo test/typecheck/lint` plus `next build` only.

This is an **unmet gate condition, stated plainly rather than waived**: the code is not deployed, and
deploying it is what the merge does — so the smoke is only obtainable *after* merge, which is exactly
what the A19 supervised production canary is for. Compounding it, all verification ran on **Node 22**
while Vercel `crawlmouse-001` runs **Node 24** (FU-10b), on a change concentrated in Unicode handling
and JSON serialization. The canary is therefore also the first and only Node-24 evidence.

**Do not read a green gate as satisfying §6.** The ordering is: merge dark (`AI_READINESS_EXTRACTION=0`
in Production + redeploy) → smoke the deployed function on a static site, a throttling WordPress site
and a JS/SPA site → only then flip the canary.

### 10g — **P1** — `js-detect.ts` hard-crashes any audit on a 22 KB page, and is quadratic besides

**Owner ruling: DEFER to a standalone engine patch, for the same reason A3/A4/A5 were pulled from this
branch three rounds ago — live pre-existing code does not enter a branch at gate stage.** Recorded here
with the full measurement so the patch can ship immediately.

`packages/engine/src/analysis/js-detect.ts:79` runs `$('body').clone()` + `.find()`, the same pair SPEC
05's `main-content.ts` used to. It is called at `audit.ts:147` on the **homepage of every audit**, with
**no try/catch**. There are TWO independent failure axes, and an earlier version of this ticket recorded
only the first:

| axis | primitive | measurement |
|---|---|---|
| **width** | `.find()` is quadratic in direct-child count | 1.28 MB / 128 000 flat siblings → **43 274 ms**, converging on 4× per doubling |
| **depth** | `clone()` recurses | **22 KB** nested ~2 000 deep → `Maximum call stack size exceeded`, **thrown** |

The depth axis is the serious one: **22 KB of HTML hard-crashes any audit of that homepage today**, on
`main`, deterministically on retry. The width axis extrapolates past 40 minutes of synchronous CPU at
safe-fetch's 10 MB cap, which `maxDuration` converts into a killed function. Neither is preemptible —
synchronous code cannot be interrupted by the crawl's wall-clock budget.

Independently verified during round 9: decomposing the old SPEC 05 path showed `clone()` is *linear in
width* (46 ms vs 34 ms at 40 000 siblings) while `.find()` is the quadratic term (2 149 ms vs 7 ms), and
separately that `clone()` throws at depth 2000 where the current walk returns normally. A reviewer
attributed the width cost to the clone; that attribution is wrong, and it matters, because the two axes
need different fixes.

**THE §5 ARGUMENT, PRE-MADE so the patch ships fast.** The JS/SPA detector is a `CLAUDE.md` §5
non-regression item, so any change needs sign-off. The first commit should be the cheap one:

> **Wrap the `looksJsRendered` call at `audit.ts:147` in try/catch. This changes no existing grade,**
> because the only inputs it affects are those that currently **throw** — and a thrown audit produces NO
> grade at all. There is no page that today yields grade X and would yield grade Y afterwards; there are
> only pages that today yield *nothing*. A guard that converts "no result" into "a result with the JS
> signal degraded" is therefore §5-safe by construction, not merely low-risk.

Second commit: port the O(n) approach now proven in `main-content.ts` — collect `$(sel)` matches into a
Set once and skip them during a single walk, with no clone. That closes both axes. The equivalence
harness in `main-content.test.ts` (which diffs against `$('body').clone().find(SEL).remove()`) is
directly reusable as the oracle.

### 10h — the entity-scan starvation threshold — **WITHDRAWN, cause removed**

Recorded that running the credit-granting probe before the never-credits descent halved the decoy
threshold (24 998 nodes, from 49 997), because both walks charged one shared budget. Both walks are gone
with the mechanism (10e), so the shared budget is no longer split and the threshold returns to its
original value. Nothing to carry forward.

### 10i — a PRE-EXISTING flaky engine test, and the evidence that earlier "flake" sightings were real

`packages/engine/src/crawl-settlement.test.ts` asserts a crawl fetched **≥ 5 pages** inside a 1 500 ms
wall-clock budget. That is a THROUGHPUT race, not a settlement assertion, and under `turbo run test`
parallelism it failed roughly **two runs in three** — `expected 3 to be greater than or equal to 5`.

**It is not caused by this branch.** Verified by stashing every uncommitted change and running the
parent commit three times under identical load: it failed 2/3 there too. An earlier single green run
with a heavy new test skipped was a coincidence, and taking that at face value would have produced a
confident wrong attribution.

**Fixed by widening the budget to 5 000 ms, NOT by relaxing the assertion.** `budgetExhausted` does not
depend on the budget being small — the stalled socket never returns, so the wall-clock cut lands at
whatever the budget is. Relaxing `>= 5` would have been the easy move and would have stopped catching a
regression that settles after fetching only the homepage. Three consecutive full-suite runs green after.

**Why this matters beyond the flake.** Two of the three round-8 reviewers independently reported engine
"flakes" and both attributed them to environment/load. They were reporting a **real, reproducible**
defect in the test, and a third reviewer's "10 consecutive clean runs" measurement had earlier been read
as evidence the sightings were spurious. SPEC 5.1 re-touches this path: treat a repeated flake report as
a finding to reproduce under the reporting conditions, not as noise to average away. Two other
load-sensitive bounds were widened in the same pass for the same reason (`text-safety` O(budget) 50 →
500 ms; the settle bound 10 → 30 s) — a timing assertion tight enough to flake trains everyone to
ignore a red run, which costs more than it protects.


---

## Contingency C-1 — the pre-costed fallback if the O(n) strip cannot be made to clear a gate

**Not built. Costed and held ready** per the owner's round-9 circuit breaker: *"if round 10 does not clear
the bar, we do NOT run round 11 on the same design."* Recorded so the decision is a switch, not a design
session.

**The design.** Revert `extractMainContent` to cheerio's `.find().remove()` exactly as it was —
known-correct, quadratic — and bound the pathological input instead of fixing the algorithm:

```
if (directChildCount(body) > MAIN_CONTENT_MAX_BODY_CHILDREN) return null;  // skip extraction
```

A `null` return degrades the page to **no `aiSignals` at all**, which is an EXISTING, already-handled
state — v1 rows and extraction-disabled rows carry none, and `selectAiSignalPages`
(`ai-readiness-packets.ts:67`) already filters on `ai_signals != null`. No new type, no new enum member,
no persisted-shape change, no migration.

**Threshold.** Direct body children, measured on real sites: crawlmouse.com **25**, wordpress.org/news
**12**, smashingmagazine.com **22**. A threshold of **5 000** leaves ~200× headroom over real pages while
capping the quadratic term at roughly (5 000/40 000)² × 4 444 ms ≈ **70 ms** — comfortably inside the
per-page budget.

**Cost:** ~15 lines across `main-content.ts` and `page-signals.ts`, plus three tests (below threshold →
signals present; above → signals absent; the honest-count invariant). Half a day including a gate.

**The one real risk, and it is not the algorithm.** A page silently dropping out of the AI population
must not corrupt the honest counts — `basis.pagesAnalyzed` (`assemble.ts:221`) and
`whatAiSeesTotalPages` both derive from the page list, and SPEC 05 §2 requires the reported total to be
truthful. The fallback therefore needs an explicit decision: either count skipped pages in
`pagesAnalyzed` (and accept that a page contributed no signal), or exclude them and surface the
exclusion. **Do not ship the fallback without resolving that** — an unexplained count is the same class
of dishonesty as an unexplained score.

**Why it is not the default.** It is strictly worse on correctness-per-cost: it leaves a known quadratic
in the crawl path and adds a cliff where a legitimate 5 001-child index page silently loses its AI
signal. The adopted design has neither, is measured linear (`152 ms` on a 1.8 MB / 200 000-sibling page
against `108 569 ms`), and — because cheerio remains the matcher — carries no CSS-semantics risk to
regress. The fallback exists only so a failed gate has a bounded, pre-agreed exit.

---

## FU-11 — Round-10 residuals (logged, not fixed; disclosed in the PR body)

Round 10 cleared the bar (0 shipped-behaviour blocking; correctness 9, security 8, test quality 7,
deploy safety 9). These are what the three reviewers found that is NOT a shipped defect. A
post-gate pass fixed the highest-value ones — the constants content pin, the self-proving fixture, the
two vacuous menu-drop assertions, the depth-axis claim and its ratio test, and both vacuous tone
assertions. What follows is the deliberate remainder.

### 11a — U+0085 (NEL) survives every sanitizer *(shipped behaviour — deliberately NOT changed post-gate)*
`text-safety.ts` strips C0 + DEL; JS `\s` excludes U+0085. Reachable end-to-end into `pages.title`,
`ai_signals.excerpt` and packet bodies via raw `C2 85` bytes. Harmless in JS, CommonMark and CSS — but
Python's `splitlines()` and Java's `String.lines()` DO split on it, so a packet piped through such a
tool gains a forged line, contradicting the sanitizer's stated contract. **Two characters to fix.** Not
taken here only because the gate cleared on `b10486f` and this changes what gets persisted; changing
shipped behaviour after a gate is how a clean gate stops meaning anything. First item of the next pass.

### 11b — `ownerRow` owner-scoping is unpinned
`apps/web/app/api/audits/[id]/stream/route.ts:93` — mutating `isOwner && user ?` to `user ?` survives
all 1 291 web tests. Shipped code is correct and A11 still holds (`canArtifacts` requires `isOwner`), but
it would hand a non-owner Pro viewer `tier='pro'` on someone else's capability URL, driving the SPEC-02
volume gate. One test closes it.

### 11c — the `MIN_MENU_LINKS` boundary is unpinned
`main-content.ts:12` — mutating 3 → 4 survives the engine suite. The test labelled "the MIN_MENU_LINKS
guard, not vacuous" uses ONE link, which does not pin the 3-boundary; the menu fixtures use 4 and 6.

### 11d — the module-load source scan misses two shapes and one directory
`module-load-safety.test.ts` — a module-scope `const` initialised by an **arrow** callee that throws, and
a **conditional** top-level throw, both survive the source scan (the import check still catches anything
that throws on today's inputs). The scan also covers only `ai-readiness/`, while `extract.ts` statically
imports `audit-config.ts`, `text-safety.ts` and `@crawlmouse/types` — identical blast radius.

### 11e — `inngest/persist-helpers.test.ts` still hand-picks four prototype keys
Four sibling sites were upgraded to iterate `Object.getOwnPropertyNames(Object.prototype)`; this one was
not. Consistency only — the guard itself is mutation-killed.

### 11f — `crawl-settlement.test.ts` case (B) retains the throughput race case (A) had
Case (A) was fixed by widening `maxCrawlMs` 1 500 → 5 000. Case (B) still uses
`crawlMsFloorForTesting: 1500` with the same `>= 5` page assertion, and was observed failing under ~4×
normal parallelism. Same fix applies.

### 11g — a compound/attribute selector added to the strip constants has no differential coverage
The fixture builder now HARD-FAILS on a shape it cannot construct (so the case can no longer pass
vacuously), but that is a refusal, not coverage. `buildStripSet` matches at document root while the
oracle's `.find()` is body-scoped — equivalent for a flat selector list, NOT provably equivalent for a
combinator. If a combinator is ever added, extend the fixture builder in the same commit.

---

## FU-12 — Hotfix-01 residuals (logged, not fixed; disclosed in the PR body)

Found by the hotfix gate. None is a defect a real site can trigger in shipped behaviour; each is
pre-existing, unreachable from the engine, or a copy-accuracy question wider than this hotfix.

### 12a — opt-out crawlers are on NO surface at all
`Google-Extended` and `Applebot-Extended` are neither `retrieval` nor `training`, so they are excluded
from the access card (which is retrieval-scoped) **and** get no finding — `assemble.ts:189-193` has no
branch for that class. On racedays.run both are fully blocked and invisible everywhere. Pre-existing;
surfaced because the hotfix's scope copy had to describe what the card omits, and the honest answer
turned out to be "more than training crawlers".

### 12b — the executive summary states per-category counts that `capFindings` has already truncated
`report-snapshot.ts:61-72` caps each category at `MAX_FINDINGS_PER_CATEGORY = 10`, and
`report-content.ts` counts the capped array. Verified in live `public_reports`: justinjackson.ca (494
pages), ru.wikipedia.org, sellontube.com and others all sit at exactly n=10 for `deep_page` and
`over_optimized_anchor`. Magnitude is pre-existing — the old copy printed the same 10 — but this hotfix
applied the principle "grammatical and false is worse than ungrammatical and false" to the site-wide
UNIT and not to the CAP, in the same sentence, on a permanent artifact. `orphan` is correctly exempt
(it uses the true `orphanCount`). Either say "at least N" or carry the pre-cap total like
`totalFindings` does.

### 12c — `summarizeFindings` still tie-breaks with `localeCompare`
`report-content.ts:93`. `buildExecutiveSummary` was moved to code-unit ordering because the output is
frozen into a permanent report and collation is ICU-dependent; its sibling on the same `/r/` page was
not. No divergence is producible across the 9 shipped categories, so this is latent, not live.

### 12d — `partitionRetrievalBots` ignores `fullyBlocked`
`ai-view-logic.ts` reads only `allowedPageRatio`, so a drifted snapshot carrying
`{ fullyBlocked: true, allowedPageRatio: 1 }` would be presented as a reacher — contradicting the
docstring's "anything not provably full-reach is treated as restricted". Not engine-producible
(`access-matrix.ts:31` keeps the two consistent).

### 12e — `bots: [null]` throws on both surfaces
A null ELEMENT inside the array passes `Array.isArray` and then derefs `.botClass`, 500ing a permanent
indexable page against the report component's own "degrade, not 500" contract. Pre-existing — the old
helper threw identically — and unreachable, since `report-snapshot.ts:154` derefs `b.token` at mint and
would have thrown first. Every other drift shape degrades correctly. The result page has no guard on
`score.accessMatrix.bots` at all, which is the same pre-existing gap.

### 12f — dead copy for two categories that are never emitted as findings
`near_orphan` and `under_linked_important` exist only as projection-ledger fix categories, never as
`Finding`s, so their `countable` entries — and the test rows pinning them — describe copy the engine
cannot produce. Harmless, but it inflates the apparent coverage of the copy table.

### 12g — `over_optimized_anchor`'s phrasing implies the wrong direction
"page with over-optimized anchor text" reads as the page's OUTGOING anchors; the engine measures
INBOUND anchor concentration on the target (`grade-inputs.ts:78`, `perTargetHHI`). The unit (pages) is
now correct; the preposition is still ambiguous.

### 12h — the AI finding body renders `targetUrl` UNDECODED
`AiReadinessSection.tsx` prints `{f.targetUrl}` raw in the expanded body, so a percent-encoded crawled
path shows literal `%XX` — the SPEC 04.2/04.3 class, on a surface that guard's matrix
(`__tests__/spec04.2-url-decode-guard.test.tsx`) never enumerated. Pre-existing. It is now VISIBLE as an
inconsistency, because the collapsed row directly above it decodes (hotfix-01 H3). The public report
already decodes the same value via `safeDecodeUrlForDisplay` (`AiReadinessReportSection.tsx:125`), so the
fix is one call — deliberately not taken here to hold the H1/H2/H3 scope. Fix should add the AI section
to the guard matrix rather than patch the one line.

### 12i — the two access cards disagree on bot-line punctuation and name order
Rendered side by side against audit `15a79871`:

- result page — `OpenAI (OAI-SearchBot) — reaches 0% of your pages: Fetches pages for ChatGPT…`
- public report — `OAI-SearchBot (OpenAI) — reaches 0% of your pages — Fetches pages for ChatGPT…`

The report puts **two em dashes in one line**, which reads as a run-on where the colon does not; the
operator/token order is also inverted between the surfaces. Cosmetic, both correct in substance, and the
report's more technical token-first framing may be deliberate — but the double em dash is not.

### 12j — the 88-char summary bound frequently cuts one character short of a word
Observed on the dominant finding class: `"…which weakens the machine-readable outlin…"`. Bounding by
length is the deliberate choice (FU-12/round-1: a sentence-boundary cut is abbreviation-blind and has an
exception to relocate), so this is the accepted cost, not a defect. Logged only so it is not re-reported
as new. A word-boundary *backstop* — never cutting forward, only back to the previous space when the cut
lands mid-word — would have no exception class, if it is ever judged worth the code.

### 12k — ONE source of truth for the bot reach percentage (the structural fix)

**This is the right fix for the defect class that produced hotfix-01's round-3 blocker.** The percentage a
reader sees is computed **twice** from `allowedPageRatio`: once by the engine into the finding's
`plainLanguage` (`assemble.ts:207`), and once by the result page / public report via `reachPercent`
(`ai-view-logic.ts`). Two computations of one number will drift, and they did — the engine rounded while
the card floored, so a partially-blocked site rendered `"reaches 99% of your pages"` on the card and
`"can reach only 100% of your pages"` in a finding six lines below, on the same screen and on the
permanent report. Both were patched to floor (`c0664c4` era), which makes them agree **today** and leaves
the class wide open: nothing prevents the next divergence, and no test can prevent one that is introduced
in only one of the two places unless it compares the two, which is why the pin had to be a property test
driving both.

Fix: the engine emits the display percentage ONCE — either as a field on `AiBotAccess`
(e.g. `allowedPagePercent`) written by `buildAccessMatrix` next to `allowedPageRatio`, or via a shared
formatter in `@crawlmouse/types` that both surfaces import — and `reachPercent` becomes a read, not a
recomputation. Prefer the field: it survives into the frozen `/r/` snapshot, so a minted report and a live
result page cannot diverge either.

### FU-12k — APPROVED SCOPE (owner ruling, 2026-07-31). Next piece of work, own gate.

Hotfix-01 tried and failed to fix this from the display line twice. Both computations must go.

1. **Exact integer math, one computation.** `buildAccessMatrix` computes `allowedPagePercent` as
   `Math.floor((allowed * 100) / total)` — from the integer counts, **never** through the float ratio.
   `Math.floor(ratio * 100)` is wrong at 40 count-pairs up to 1000 pages — 20 within `FREE_PAGE_CAP` (500),
   80 within `PRO_PAGE_CAP` (2000) — because
   `0.29 * 100` is `28.999999999999996`; that is not a rounding-rule preference, it is an arithmetic bug,
   and it is why hotfix-01 shipped a false number for one round. Two readers: the engine's finding text and
   the card's `reachPercent`, which becomes a field read rather than a recomputation.
2. **Fold in the `fullyBlocked` / 0% conflation.** A bot at 0.2% reach renders `0%` — byte-identical to a
   total block, a materially different remediation. `fullyBlocked` is computed at `access-matrix.ts:31`,
   typed, and persisted into the minted snapshot, and is consumed by **no surface**. Render `<1%`, or read
   `fullyBlocked`.
3. **Fold in the headline and component-bar rounding.** `assemble.ts` (`score = Math.round(raw * 100)`) and
   `componentBars` round **up**, so 1 disallowed page of 419 renders **"100 / 100 AI-ready"** and an access
   bar of **100%** directly above a restricted crawler and a HIGH finding. Same class as the blocker, one
   component up, in the number a reader sees first — and worse for the conversion spine than the defect
   hotfix-01 fixed. **Rule: a perfect displayed score must be unreachable while any finding exists.** Floor
   the display, so 99.76% shows 99 and agrees with the finding.
4. **Frozen-snapshot fallback — decided.** A legacy snapshot has no `allowedPagePercent`, and its finding
   text is frozen under `Math.round`. It falls back to **rounding**, matching that frozen text. An immutable
   artifact prioritises INTERNAL COHERENCE over retroactive correctness: we cannot change frozen text, so the
   card must agree with it. New audits use exact integer math and persist the percentage at mint. (Measured
   window: 46 public reports, 2 with `aiReadiness`, every restricted bot at ratio 0 — zero legacy instances.)
5. **The test must be capable of failing.** Assert against independently **hand-computed truth** for known
   count pairs — 29/100 → 29, 290/500 → 58, 418/419 → 99, 299/300 → 99 — and **never** against the other
   side's output. Hotfix-01's property test asserted only `card === finding`; both sides floored the same
   float to the same wrong integer, so it passed green on a false number. Agreement is not correctness.
6. **Known coverage gap to close on the way:** `pct` feeds two template literals (`retrieval_bot_blocked`
   and `training_bot_blocked`) and only the retrieval string is pinned — rounding the training string alone
   survives both suites today.

Caveat that makes item 4 a real design decision rather than a rename: a persisted percentage becomes part of
the immutable snapshot, so a later change to the rule can no longer retroactively correct old reports.
