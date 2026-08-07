# GATE 5 — the three reviewer reports (FAILED)

**Frozen SHA:** `5c5204a6b3377b53dd83024c0828d4f8317de6eb`
**Worktrees:** `../cm-g5-1` (correctness), `../cm-g5-2` (security/deploy), `../cm-g5-3` (test quality) — each detached at the frozen SHA, each running its suites per package with `npx vitest run` rather than the top-level script, because turbo's cache is shared across sibling worktrees.
**Date:** 2026-08-07.

Recorded in the repo because a gate claim without its artifacts is unverifiable — the standing rule
added after the incident in `docs/handoff/2026-08-03-spec51a-handoff.md` §5B.

## Verdict

| lens | R1 correctness | R2 security/deploy | R3 test-quality |
|---|---|---|---|
| correctness | **6** | 9 | **6** |
| security | **8** | **8** | **8** |
| deploy-safety | 9 | 9 | 9 |
| test-quality | **6** | **8** | **6** |
| blocking | **2** | 0 | **1** |

Required to pass: ≥9 on every lens, 0 blocking. **Neither was met.**

Baselines at the frozen SHA, reported identically by all three: engine **855** · web **1477** ·
inngest **145** · scripts **40**; `turbo typecheck --force` 5/5, `lint --force` 4/4, `next build`
passes; `pnpm-lock.yaml`, `turbo.json` and every `package.json` byte-identical to `origin/main`.

---

## B5-1 (BLOCKING — R1 and R3 independently, different fixtures)

**`sitemap_unreached` still publishes a quantified critical claim whose count is a function of our
own page cap.** Gate 4's B-A was narrowed, not deleted.

`packages/engine/src/coverage.ts` `linkReachableUrls` · call site `audit.ts:518` · emitter
`coverage.ts` `sitemapUnreachedFinding`.

**R3's fixture** — homepage → 40 section pages → 10 leaves each = 441 declared, zero orphans by any
definition, every leaf exactly two clicks from the homepage:

| pageCap | fetched | `sitemapUnreached` | severity | leads? | verdict |
|---|---|---|---|---|---|
| 5 | 5 | **400** | critical | yes | **GRADED D** |
| 10 | 10 | **400** | critical | yes | **GRADED D-** |
| 25 | 25 | **400** | critical | yes | **GRADED F** |
| 60 | 60 | **230** | critical | yes | **GRADED C+** |
| 441 | 441 | **0** | — | — | **GRADED B** |

**R1's fixture** — an ordinary paginated blog at the real production cap: 600 posts, `/page/2…/page/61`
archives linking 10 posts each plus next/prev, sitemap declaring the homepage + 600 posts and **not**
the paginated archives (the default output of every major WordPress SEO plugin). Every post is two
clicks from the homepage:

```
cap 500 (= FREE_PAGE_CAP) → 400 of 601 unreached, critical, leading, GRADED D/45.27
cap 900                   → 0 unreached, GRADED C/61.1
```

A scaled 120-post run reproduces the gate-4 signature exactly: cap 20 → 110 · cap 60 → 90 · cap 200 → 0.

**Mechanism.** The basis is still `ga.depths.keys()` — BFS over a graph whose edges to unfetched
targets `graph.ts` already dropped. Two losses compound: a leaf linked only from a hub we did not
fetch stays unreached, **and** the observed outbound links of pages we *did* fetch are discarded when
those pages are not BFS-reachable through fetched intermediates. That is why R3 measured `reachable`
stuck at 41 from cap 5 through cap 25.

**Production-reachable.** `FREE_PAGE_CAP = 500`; sitemaps are collected to 10 000. Live DB: of 215
completed audits, **25 sit at ≥500 pages and 62 at ≥200**. Nothing suppresses the finding on a
truncated crawl — `sitemapDeltaSeverity` reads only `coverage`, never `crawlHealth.partial`.

**Why the fix pass missed it.** The replacement fixture is a **complete graph** — every page links to
every other — so one hop from any fetched page reaches everything and the property *cannot fail
there*. It binds the cap, which is what gate 4 asked for, but it cannot bind the one-hop rule. It was
titled *"the count is not a function of our budget"*, a general claim it does not carry.

**Three self-contradictions the reviewers named:**
- `coverage.test.ts` **pins the residue as correct** — *"does NOT take a second hop — a page linked
  only from an unfetched page stays unreached"* — which is the failing case, asserted as intended.
- `coverage.ts` claimed the residue *"is no longer the systematic case, because a site with ordinary
  navigation links its pages from every page we fetch"*. Reasoned, not measured, and falsified.
  Paginated navigation is ordinary navigation and does not do that.
- `evidence/2026-08-06-stage6-acceptance-sweep.md` B10 read **MET**, in a document whose closing line
  is *"No criterion is reported met on the strength of a stub."*

**Both reviewers' remediation directions**, recorded because they are the design constraint for 5.1b:
widen the basis to *all fetched pages* rather than BFS-reachable ones; and/or withhold the delta when
`crawlHealth.partial` and the declared set exceeds what was fetched. **Either way the fixture must be
a paginated hub, not a complete graph, or the next test proves nothing again.**

---

## B5-2 (BLOCKING — R1)

**The compare page publishes a fabricated cause for an audit that FAILED**, in a sentence the B3 fix
introduced. `apps/web/components/share/CompareView.tsx` — `columnState` maps `status === 'failed'` and
`status === 'completed'` to the same `{ kind: 'ungradable' }`, so `compareOutcome` returns `one-sided`
and the new banner asserts a reason:

```
side B = { status:'failed', grade:null, score:null, failureCategory:'timeout' }, finished: true

RENDERED: We could only grade yourshop.com — there wasn't enough evidence to publish a grade for
          theirsite.com, so there's no comparison to make.
```

The audit did not run out of evidence; it errored. This is the branch's own two-meanings-of-a-null
rule inverted at a surface it enumerates. The discriminator is already on the wire — the SSE payload
CompareView consumes carries `refusal`; only `AuditSnapshot` in `lib/use-audit-stream.ts` fails to
declare it. `CompareView.test.tsx` had fixtures for graded / refused / running / two-refused and
**none for `status: 'failed'`**.

---

## Surviving mutations (R3, read against 24 measured kills)

| # | mutation | result |
|---|---|---|
| S1 | refusal branch keeps `{surface === 'refused-v2' && …}` but renders the **pre-5.1 failure card** (`text-warning`, "usually a site that blocks crawlers", "contact support") | **SURVIVES** — web 1477/1477 green, `tsc` exit 0. Gate 3's blocker restored in *effect* |
| S2 | `if (state.refused) return <Card>{resultErrorCopy}</Card>;` inserted above the JSX, every branch left textually intact | **SURVIVES** — 1477/1477 green |
| S3 | new `security definer` frontier-touching function named without "frontier" (`public.reap_stale_urls`), no revoke | **SURVIVES** — RPC guard 7/7 green |
| S4 | `grant execute on function claim_frontier(uuid, text[], integer) to anon;` — **unqualified** | **SURVIVES** — 7/7 green |
| S5 | `alter default privileges in schema public grant execute on functions to anon, authenticated;` | **SURVIVES** — 7/7 green |
| S6 | `computeConfidenceBand(…, gradeableCount: number = 0)` — a 5th parameter with a default | **SURVIVES** — engine 855/855 green (`Function.length` counts only parameters before the first defaulted one) |

R2 independently found four more RPC-guard evasions: `grant execute on all routines in schema`;
`alter function … security definer`; `grant select,insert,update,delete on public.frontier to anon`
(mitigated in fact by RLS + 0 policies); `alter function … reset search_path`.

**All nine gate-4 survivors were independently re-run and are genuinely closed** (W8b, W8, W1b, W1,
W2, W2′, W9, W9b, W7c, W10), as are all three claimed closures in `6c09b9a`, all six gate-4 RPC
evasions, and the import-graph guard's three claimed controls (pure line shift → green; new verdict
default → red; edited inventoried line → red).

---

## Non-blocking findings worth carrying

- **R2/NB-1 + R3/NB2 — the RPC guard's commit message states a false mechanism.** `5383ac2` says
  *"Frontier functions are selected by what they operate on, not by a list."* The implementation is
  `name.includes('frontier')` — a name match. S3 is the consequence.
- **R2/NB-2 — `AUDIT_COLS` lost deploy-order tolerance** and `stream/route.ts` still carries a comment
  claiming it has it. On a pre-`20260804000001` database both selects 400, `initial` is null, and no
  `snapshot` **or** `error` event is sent, so the client reconnect-loops. Not reachable in production;
  reachable on a rollback or a fresh environment.
- **R2/NB-3 — rollback hazard, undocumented.** Once refused rows exist, a Vercel rollback to
  `main@69b039f` restores `grade ?? ''` / `score ?? 0` and would render the "Down 81 points"
  fabrication on real rows. **Rollback is not safe once refused rows exist.**
- **R2/NB-4** — the `refusal` / `coverage` column grants are currently unexercised: every client read
  goes through the SSE route's service-role read. The migration justifies them with a
  `loadDashboardSites` read that does not select those columns.
- **R2/NB-6** — `docs/tickets/2026-07-31-sitemap-seeds-bypass-robots-disallow.md` (HIGH) is **fixed by
  this branch** but still reads `Status: open`. Mutating the gate out goes red, 4 tests.
- **R1/NB1** — the SSE route re-establishes `grade ?? ''` / `score ?? 0` when feeding
  `computeMonitoringDelta`, serializing `scoreDelta: -81.39` to an entitled owner. No component reads
  `monitoring` today, so it is not rendered — but §3.3's standard is byte-level proof at the
  serialization boundary.
- **R1/NB6** — `dashboard.ts` sets `prev = null` when the predecessor is outside the loaded window
  (expired, not completed, or beyond `.limit(200)`), so the B1 fix now routes a repeatedly-audited
  site to *"First audit — re-audit later"*.
- **R1/NB2** — mutating `sitemapDeltaLeads` `>` to `>=` leaves 1477/1477 green: the second copy of the
  D4 categorical rule is unpinned at its boundary. *(Moot under the D4 cut.)*
- **R3/NB4** — `crawl-stall-retries.test.ts` is wall-clock sensitive and reddened twice under load
  where the mutation could not affect it, inflating kill counts.
- **R3/NB5 / NB6** — the handoff's suite counts and commit-ahead count are stale; `9066bfd` reports
  "the dash restored, 1 red" where the measurement is 2 red.

---

## Disclosure assessment — B17, B11, B13, B14/B15

All three reviewers judged these **honestly disclosed and not defects**. R2 verified independently via
the Vercel API that production runs `main@69b039f` (`dpl_Gr4wyGbrYQEiu3p89J35NjbNLrbQ`, READY) and
that this branch is on no deployment, and found the SPEC 05 precedent (PR #21) recorded verbatim in
production. R2 confirmed the four SQL functions have **zero call sites** and both frontier tables hold
**0 rows** — "applied and uncalled" is exactly true. R3 called the disclosure discipline "exemplary"
and named **B10 as the one row that breaks it**: every sentence true, the verdict not.

## What held

R2 found **zero blocking** on security and deploy. Live posture read from `pg_proc`: all four frontier
functions `prosecdef = false`, `search_path=public, pg_catalog`, ACL `{postgres, service_role}` with
**no PUBLIC entry**; `has_function_privilege` false for `anon`, `authenticated` **and** `public`. Both
frontier tables RLS-on, **0 policies, 0 rows**. No policy created, changed or widened anywhere in the
branch. `fingerprint` correctly ungranted. SSRF guard and `safe-fetch` diffs against `origin/main` are
**empty**. R2's own byte-level serialization probe across four unentitled viewers (anon non-owner, free
owner, Pro non-owner, signed-in non-owner) found no letter, no `user_id`, no `failure_reason`, and no
gated content, with a Pro-owner anti-vacuity control that does receive them.

R3's independent route-level walkthrough drove real `runAudit` output through the **real**
`persistAuditResults` → the real `AUDIT_COLS` row → `projectAuditForClient` → `deriveAuditViewState` →
`chooseSurface` → render, for all four refusal triggers plus a graded control. Every refused screen
resolved `refused-v2`, showed the Stage 4 copy, and contained no `text-warning`, no "contact support",
no "blocks crawlers", and no letter. Copy precedence resolved correctly on the co-firing rows.

**Stated plainly by R3, and it remains true:** `AuditView` is a client component driven by
`EventSource` and this suite has no jsdom — it never mounts, in any test. Everything from
`chooseSurface`'s return value to the pixel is covered only by the source guard, which is why S1 and
S2 survive. Nothing local executes the supabase-js/PostgREST hop.
