# SPEC 5.1 — Engine Honesty & Reproducible Grading (Phase 5)

> **Read `00-crawlmouse-master-build-plan.md`, `PROJECT_OVERVIEW.md`, `docs/OPERATING-RULES.md`, and
> `docs/handoff/2026-07-31-spec05-close-and-next.md` first.** This spec repairs the engine's
> credibility. SPEC 05 gave the product a second, honestly-framed score; SPEC 5.1 makes the first
> one deserve the same trust. It is the last thing standing between Crawlmouse and go-to-market.
>
> **The wound, in one line:** the same site, crawled nine times at exactly 500 pages, graded from
> **F/32.88 to A−/88.89** — and the A− came from the run with the *lowest* coverage (18.2%). Sample
> size cannot explain that. Sample *composition* can, and does.
>
> **Status:** Phase 5, in two lockable halves. **5.1a** (§4–§8) runs on Terminal 5.1a; **5.1b**
> (§9–§11) runs on Terminal 5.1b **after 5.1a merges** — never in parallel, because 5.1b calibrates
> against the page set 5.1a produces. SPEC 05 is closed and merged; `main` is the base.
>
> **THE INVERTED CONTRACT — read this before anything else.** Every prior spec held grades
> byte-identical. **SPEC 5.1 deliberately changes grades.** That is its purpose. This is a
> non-regression-contract amendment under `docs/OPERATING-RULES.md` §5 and requires explicit owner sign-off against
> a before/after panel (§10). No grade-affecting change ships without that sign-off. Stages that
> change grades are marked **[GRADE-CHANGING]** throughout.
>
> **Owner decisions locked into this spec:** (1) the robots-Disallow bypass is folded in as Stage 1
> rather than patched separately, because the fix and the frontier rebuild touch the same code;
> (2) orphan detection becomes **crawl ∪ sitemap triangulation**, not crawl-only; (3) full
> resumability moves to SPEC 06 — 5.1 keeps only a durable frontier checkpoint; (4) the
> discovered-URL-set fingerprint is a first-class artifact serving 5.1, FU-9 and SPEC 06;
> (5) every finding carries deterministic severity **and** coverage; (6) static-only, no-LLM,
> deterministic remain absolute.
>
> **Implementer note (mandatory, `docs/OPERATING-RULES.md` §3):** verify every file, function, table and column
> name against the live repo before editing. References below were read during SPEC 05 and may have
> moved. **Do not assume.** Flag mismatches before writing implementation.

---

## 1. The evidence base

Every change in this spec traces to production evidence. Implementers should read these as the
acceptance context, not as background colour.

| # | Evidence | Where recorded |
|---|---|---|
| E1 | duskroute.com — nine runs, **all at page_count 500**, F/32.88 → A−/88.89 (56 points, six letters). The A− outlier sits at **18.2% coverage**, so the grade is *not monotonic* in crawl completeness. `crawl_estimated_total` for the same site ranged 1,745 → 7,735. | `docs/tickets/2026-07-09-engine-linking-grade-honesty.md` |
| E2 | mohammadalinijhoom.com — 73.92/B− at 277 pages (82.2% coverage) → 62.87/C at 71 pages (35.5%). Neither run hit its page cap; both were time-bound against a throttling host. | same ticket |
| E3 | racedays.run — 419 pages/80.32 twice, then 418/80.60. Retired as a "byte-identical control": we **cannot currently distinguish site drift from crawl-order nondeterminism**, and that inability is itself the finding. | `evidence/2026-07-31-racedays-reproducibility-control-retired.md` |
| E4 | Population stats: **60%** of completed audits are partial, **45%** carry low confidence, **19** returned a reassuring A/A−/B+/B *while flagged low-confidence*, and **21** produced a grade from a **single crawled page**. | same ticket |
| E5 | justinjackson.ca — individual tweet permalinks (`/tweets/{id}`) graded as "buried key pages" at +2.6 pts each; `/cp/auth/login` recommended as an orphan fix; an action packet instructed the user to "add internal links to *'RT @mattpocockuk: 🦋'*". | same ticket |
| E6 | Headline contradicts findings: A−/86 "Strong internal linking — keep it up" beside 10 buried, 10 over-optimized, 9 orphan pages. B+/84 on a site with ~47% orphans. B+/80 at **13% coverage, low confidence**. | same ticket |
| E7 | A crawled page title rendered verbatim in a white-labelable client report: *"I'm a fucking webmaster."* Fixes shown at **+0.0 pts** in the *prioritised* list. | same ticket |
| E8 | Sitemap seeds bypass the robots `Disallow` filter (`audit.ts:207-239` passes sitemap URLs straight into `startUrls`); hostname suffix check accepts `a.com.evil.com` as same-origin. Measured repro: `Disallow: /search` + `/cart` → all 14 bots at 98%, six spurious HIGH findings. | `docs/tickets/2026-07-31-sitemap-seeds-bypass-robots-disallow.md` |
| E9 | magazine.atavist.com — Pro audit reached 550 of ~878 pages; the 240s wall clock bound before the 2,000-page cap. Report showed 550 graded / 796 fetched / ~878 estimated with no labelling. | same ticket |

**External evidence that shapes design decisions** (from the July 2026 engineering stress-test):
Screaming Frog states additional URL sources are *required* to discover orphans; Botify measured
orphan pages at ~26% of Googlebot's crawl budget on an average site (~70% worst-case); Google's
SimHash parameterisation for near-duplicate detection at web scale is 64-bit with Hamming distance
k=3 (Manku, Jain & Das Sarma, WWW 2007); Sitebulb's severity-plus-coverage "Hints" model is the
most-praised issue presentation in the category; Ahrefs documents that disabling an error check
*raises* your health score and Semrush that toggling JS rendering *changes* it — both confirming
that scope-sensitive scores are the market norm we are deliberately rejecting.

## 2. Non-negotiables (unchanged from prior specs)

- **Static-only.** No JavaScript rendering, no headless browser. Evidence-backed: the major AI
  crawlers fetch raw HTML and do not execute JS.
- **No LLM calls in the product path.** All algorithms deterministic.
- **Determinism is a product contract.** Same site, same inputs ⇒ same grade, findings and score.
  This spec *strengthens* it; §11 makes it a property test rather than an aspiration.
- **Politeness and SSRF guards.** Never weakened. Robots compliance is *tightened* (§4).
- **Cost discipline** ≤18% of MRR. No new fetch classes beyond those specified.
- **Never squash; full history.** No coding-assistant references anywhere in commits, code, comments,
  docs or PR bodies; no authorship trailers; single author. Trace-audit before every push.
- **Migrations are owner-applied only**, via runbook. Never autonomously.
- **Every merge is verified on the deployed function**, and the Vercel production deployment must
  be confirmed READY before the work is called done.

---

# PART A — SPEC 5.1a (Terminal 5.1a)

*Crawl integrity, page classification, deterministic sampling. Ships and merges before 5.1b starts.*

## 3. Shared data contract (additive)

Additive types only; nothing existing changes shape. Verify names against `packages/types/src/`
before adding.

```ts
// ── §5 page classification ──
export type PageKind =
  | 'content'        // gradeable
  | 'auth'           // login/register/account
  | 'search'         // search-result pages
  | 'pagination'     // /page/2, ?page=
  | 'archive'        // tag/category/date archives
  | 'feed'           // rss/atom/json feeds
  | 'status'         // status/permalink stubs (tweets, short posts)
  | 'utility'        // cart/checkout/print/preview
  | 'duplicate'      // near-duplicate of a representative (§5.4)
  | 'thin';          // real page, too little content to grade

export interface PageClassification {
  kind: PageKind;
  gradeable: boolean;              // kind === 'content' && !excludedByDirective
  reason: string;                  // deterministic, human-readable, e.g. 'url_pattern:auth'
  templateKey: string;             // §6 stratum key, e.g. '/event/{slug}'
  simhash: string | null;          // 64-bit hex; null when text below threshold
  duplicateOf: string | null;      // urlHash of the representative, when kind==='duplicate'
}

// ── §6 frontier + fingerprint ──
export interface CrawlFingerprint {
  version: 1;
  discoveredCount: number;         // total URLs discovered (pre-selection)
  selectedCount: number;           // URLs actually crawled
  digest: string;                  // stable hash over the sorted canonical discovered URL set
  strata: { templateKey: string; discovered: number; selected: number }[];
  seed: string;                    // the fixed sampling salt used
}

// ── §7 coverage & orphan triangulation ──
export interface CoverageAccounting {
  fetched: number;                 // every URL fetched, any status
  gradeable: number;               // PageKind 'content', 200, same-origin
  excluded: { kind: PageKind; count: number }[];
  sitemapDeclared: number | null;  // URLs in sitemap(s), null when none found
  sitemapUnreached: number | null; // in sitemap, not reachable by link-following  → orphan signal
  estimatedTotal: number | null;   // best estimate of site size, with provenance below
  estimateSource: 'sitemap' | 'discovery' | 'none';
  coverageRatio: number | null;    // gradeable / estimatedTotal, null when unknowable
}
```

`Page` gains additive `classification?: PageClassification`. `AuditResult` gains additive
`fingerprint?: CrawlFingerprint` and `coverage?: CoverageAccounting`.

## 4. Stage 1 — Crawl integrity  **[not grade-changing in intent; measure and report]**

Fixes E8 plus the canonicalisation and trap defences the frontier rebuild depends on.

**4.1 Robots compliance on every entry path.** Today sitemap-discovered URLs are pushed into
`startUrls` without passing the robots filter (`audit.ts:207-239`) — the crawler can fetch paths the
owner disallowed. **Every** URL entering the frontier, regardless of discovery source (link,
sitemap seed, redirect target, canonical target), passes the same `isAllowedByRobots` check against
our own user-agent. One gate, no exceptions. Disallowed URLs are *recorded* as
`excluded_by_robots` (they still inform the sitemap-delta in §7) but never fetched.

**4.2 Same-origin check.** Replace suffix matching with exact hostname equality plus an explicit
`www.`-equivalence rule. `a.com.evil.com` must fail. Fixture-pinned with the known bypass.

**4.3 URL canonicalisation (RFC 3986).** Lowercase scheme and host, remove default ports, resolve
dot-segments, sort query parameters, strip a pinned allowlist of session/tracking parameters
(`utm_*`, `gclid`, `fbclid`, `PHPSESSID`, `sid`, …), decide fragment handling (strip). The
canonical form is what gets hashed for dedup, sampling and the fingerprint. **This collapses
duplicate URLs and therefore changes page counts — measure the effect and report it at the Stage 1
gate.**

**4.4 Crawl-trap defences.** Deterministic caps: max path depth, max query-parameter count, max URL
length, plus a parameter-entropy guard. Per-template quotas (§6) already bound calendar and facet
explosions structurally; these caps are belt-and-braces. All values in `constants.ts`,
fixture-pinned.

**Gate:** robots compliance proven on all four entry paths; the `a.com.evil.com` fixture fails
closed; canonicalisation effect on page counts measured and reported; the full existing suite green.

## 5. Stage 2 — Page-type classification  **[GRADE-CHANGING]**

Fixes E5. Deterministic, static-HTML, no LLM. Layered cheapest-first; a page is `content` only if
every layer passes.

**5.1 URL and query-parameter rules.** A pinned, ordered rule table in `constants.ts` mapping
patterns to `PageKind`: `/login`, `/register`, `/account`, `/cart`, `/checkout`, `/search?`,
`?s=`, `?q=`, `/page/{n}`, `?page=`, `/tag/`, `/category/`, `/feed`, `/rss`, `?replytocom=`,
`/print`, and status-permalink shapes (`/tweets/{id}`, `/status/{id}`). Every rule carries a
fixture. **Rules must be general, not site-specific** — no blacklisting `/tweets/` for one customer;
the rule is "numeric-or-opaque-id status permalink under a status-shaped path."

**5.2 Directive signals.** `noindex` (meta or header) ⇒ not gradeable. A `rel=canonical` pointing
elsewhere ⇒ not independently gradeable (self-canonical or absent is fine). Robots-disallowed ⇒
excluded from the gradeable denominator.

**5.3 Thin-content detection.** Reuse SPEC 05's main-content extractor (`main-content.ts`) — it is
already deterministic, O(n), and battle-tested through ten gate rounds. Below
`MIN_GRADEABLE_TEXT_BYTES` ⇒ `thin`. **Conservative bias, as in SPEC 05:** a real contact page must
never be excluded as junk; when the signal is ambiguous, keep the page gradeable.

**5.4 Near-duplicate collapsing (SimHash).** 64-bit SimHash over the extracted main-content text,
Hamming distance **k=3** (Google's validated web-scale parameterisation). Pages within k of a
representative are `duplicate` and count **once** toward structure and orphan statistics. Fixed,
pinned tokenizer and hash — determinism depends on it, so do not rely on library defaults. Log
every collapse decision for auditability.

**Effect and the honesty requirement:** classification shrinks the gradeable denominator, which is
the point — it is what stops a login page being recommended as an orphan fix. But it **changes
grades**, so Stage 2 cannot merge without the §10 panel measurement. Excluded pages are never
silently dropped: they appear in `CoverageAccounting.excluded` and are surfaced (§7.3).

**Gate:** every rule fixture-pinned; the E5 URLs (tweet permalinks, `/cp/auth/login`) classify
correctly; a contact page and a short-but-real article stay `content`; SimHash determinism pinned;
grade delta measured across the corpus and **reported, not approved** — approval is §10.

## 6. Stage 3 — Deterministic stratified frontier  **[GRADE-CHANGING]**

The heart of the spec. Fixes E1, E2, E3.

**6.1 Why BFS fails here.** Breadth-first is a fine *discovery* order and a terrible *sampling*
order when the budget is far smaller than the site: one large index page's alphabetically-ordered
children drain the entire budget, so which 500 pages you see is arbitrary and unstable between runs.
E1 is that failure in production.

**6.2 Stratum keys.** Every canonical URL gets a `templateKey` derived by replacing numeric,
UUID-shaped and slug segments with placeholders: `/event/soknalopet-2026` → `/event/{slug}`,
`/blog/2026/03/12/x` → `/blog/{n}/{n}/{n}/{slug}`. Pure string manipulation, fully deterministic.

**6.3 Selection.** Round-robin across strata with per-template quotas, so no single template can
consume more than a bounded share of the budget. Guarantee each discovered stratum minimum
representation before any stratum receives a second quota.

**6.4 Deterministic sampling within an over-quota stratum.** Assign each URL
`sampleKey = hash(canonicalUrl, FIXED_SALT)` and keep the smallest-k (the Efraimidis–Spirakis min-k
formulation of reservoir sampling). Because the key is a hash of the URL rather than a fresh random
draw, **the same site yields the same sample regardless of discovery order** — this is the mechanism
that makes the grade reproducible.

**6.5 Sitemap-informed seeding.** Where a sitemap exists, use it to seed strata and to estimate site
size. Sitemap URLs still pass the robots gate (§4.1). This also stabilises `estimatedTotal`, which
swung 1,745 → 7,735 on one site (E1).

**6.6 The determinism contract.** The frontier must be a **pure function of the discovered URL set
and the fixed seed**. Forbidden inputs: wall-clock time, arrival order, concurrency race outcomes,
response latency. Ties break by canonical URL hash. Politeness and adaptive backoff may change
*timing* but must never change *which* URLs are selected.

**6.7 The crawl fingerprint.** Persist `CrawlFingerprint` per audit (§3). This is the artifact that
finally separates *"the site changed"* from *"we sampled differently"*: identical digest + different
grade ⇒ engine defect; different digest ⇒ explained input change, with the strata table naming which
sections moved. It serves 5.1 (E3), FU-9 (crawl composition per run) and SPEC 06 (monitoring must
not report phantom grade movement to users). **No competitor folds this distinction into the score;
the closest published work is a diagnostic diff view.**

**Gate — the decisive one:** re-crawl a fixed corpus twice with no site change and prove identical
digests and identical grades. Then replay E1's duskroute conditions and demonstrate the swing is
bounded. **STOP for owner review of the reproducibility evidence.**

## 7. Stage 4 — Coverage accounting & orphan triangulation  **[GRADE-CHANGING]**

Fixes E9 and the crawl-only orphan weakness.

**7.1 Three counts, always distinguished.** `fetched` (every URL touched, any status), `gradeable`
(content-kind, 200, same-origin), `estimatedTotal` (with explicit `estimateSource`). Today these are
conflated — one report showed 550 / 796 / ~878 with no labelling, which reads as inconsistency to
anyone who checks.

**7.2 Orphan triangulation — crawl ∪ sitemap.** A URL declared in the sitemap but not reachable by
link-following is an orphan by the industry-standard definition, and today we miss it entirely.
Compute `sitemapUnreached` and feed it into orphan detection as a distinct, labelled signal.
Robots-disallowed sitemap URLs are counted but flagged separately — they are the owner's choice, not
a defect. **GSC and log-file sources are explicitly deferred to SPEC 06** (§13).

**7.3 Excluded pages are surfaced, never hidden.** `CoverageAccounting.excluded` is rendered
somewhere the user can see it. "We excluded 412 tag-archive pages and 38 login pages" is honest and
useful; silently shrinking the denominator is not.

**Gate:** the three counts are correct and distinguishable on a real audit; sitemap-unreached
orphans detected on a fixture where crawl-only misses them; exclusions surfaced.

## 8. Stage 5 — Durable frontier checkpoint  *(minimal — full resumability is SPEC 06)*

Not resumability. A durable home for frontier state so a timed-out crawl resumes rather than
restarts, and so the fingerprint (§6.7) survives.

- `frontier` table keyed by `(audit_id, url_hash)` holding canonical URL, `templateKey`,
  `sampleKey`, depth, state, discovery source.
- Claim with `FOR UPDATE SKIP LOCKED` so parallel steps cannot double-claim.
- Per-host politeness state persisted so backoff survives a resume.
- **Determinism across a resume is mandatory:** selection is a function of the *discovered set*, so
  discovery and selection must be separable — bound discovery deterministically, then select.

**Explicitly out of scope here:** multi-step Inngest continuation, scheduled re-crawls, incremental
crawling. Those are SPEC 06. **Trigger that pulls them forward:** telemetry showing a material share
of Pro (2,000-page) crawls hitting the 240s wall before the page cap.

---

# PART B — SPEC 5.1b (Terminal 5.1b — starts only after 5.1a merges)

*Honest scoring and calibration. Every constant here is tuned against the page set 5.1a produces,
which is why this cannot run in parallel.*

## 9. Stage 6 — Honest scoring  **[GRADE-CHANGING]**

Fixes E4, E6, E7.

**9.1 Confidence governs, it does not decorate.** Today `confidence` is a label rendered beside a
fully confident letter. It must instead determine how emphatically the grade is asserted: high
confidence ⇒ a letter; medium ⇒ a letter with an explicit band; low ⇒ a band only.

**9.2 Refusal threshold.** Below a minimum gradeable-page count **and** a minimum coverage ratio,
**no letter grade is asserted at all** — the product says "insufficient coverage to grade — we
reached X of an estimated Y pages" and shows the findings. This retires the 21 single-page grades
(E4) and answers the public criticism that a grade computed from a fraction of a percent of a site
cannot be taken seriously. Thresholds are constants, calibrated in §10.

**9.3 Interval estimates.** Report the orphan rate and depth distribution as intervals with
finite-population correction, computed **per stratum and reweighted** (§6 makes this possible). Be
explicit that the interval is a floor on the true error, because the sample is stratified rather
than random.

**9.4 Headline copy derived from findings.** The headline must be a pure function of the findings,
never of the letter band. It is structurally impossible for "Strong internal linking — keep it up"
to sit above a 47%-orphan finding (E6). Pinned by an invariant test (§11).

**9.5 Severity and coverage on every finding.** Each finding carries deterministic severity plus the
percentage of the site affected — the model behind the most-praised issue presentation in the
category. 5.2's aggregation depends on this data existing, which is why the *data model* lands here
even though the presentation does not.

**9.6 Suppress meaningless fixes.** A fix estimated below a minimum delta is not shown in the
*prioritised* list (E7). Fix the underlying scaling, not the label.

**9.7 Title sanitisation for client-facing surfaces.** Crawled titles render verbatim in
white-labelable reports (E7). Provide a deterministic default and an owner-facing option. Never
silently alter data used for scoring — this is a rendering concern only.

**9.8 Projection bug.** "You're an A — you could be an A." Fix the projection so it cannot present a
null improvement as an opportunity.

## 10. Stage 7 — Calibration  **[GRADE-CHANGING — OWNER SIGN-OFF GATE]**

**10.1 The panel.** A labelled corpus of real sites with owner-assigned expected bands, deliberately
including known-bad sites (a ~47%-orphan site must not score B+) and known-good ones. The panel is a
living asset; **re-curving is gated on panel size** — do not re-curve against a thin corpus.

**10.2 Re-curve.** Analyse the score distribution across the panel and adjust band thresholds so the
letter matches expert judgement. The current curve is demonstrably too lenient at the top.

**10.3 The sign-off gate.** Produce a **before/after table across the panel and the backtest corpus**
showing every grade movement with its cause. **No grade-changing stage merges without explicit owner
approval of that table.** This is the `docs/OPERATING-RULES.md` §5 amendment in practice.

## 11. Stage 8 — Invariants and determinism as property tests

Property-based (`fast-check`), generative over synthetic link graphs — not example fixtures.
Fixtures are what let three separate defect classes survive multiple gate rounds during SPEC 05.

| Invariant | Statement |
|---|---|
| I1 Determinism | Same discovered set + same seed ⇒ identical grade, findings, fingerprint. |
| I2 Orphan monotonicity | Adding an inbound link to an orphan never lowers the grade. |
| I3 Coverage non-inflation | Increasing coverage on a fixed site does not systematically raise the grade. **This is the E1 property.** |
| I4 Copy–findings consistency | The headline cannot contradict the findings, for any finding set. |
| I5 Refusal | Below threshold, no letter is asserted anywhere — result page, report, snapshot, share text. |
| I6 Classification stability | The same URL + same HTML always yields the same `PageKind` and `templateKey`. |

**Every property test must be capable of failing.** Mutation-verify each: revert the fix, prove the
test goes red. Assert against independently computed truth, never against the other side's output —
a test comparing two implementations passes green when both are wrong the same way.

---

## 12. Data model & migrations *(additive, nullable, owner-applied)*

- `pages`: additive nullable `classification jsonb`.
- `audits`: additive nullable `fingerprint jsonb`, `coverage jsonb`.
- New table `frontier` (§8) — `(audit_id, url_hash)` PK, indexed on `(audit_id, state)`.
- **No RLS policy widened.** New columns must be verifiable as unreachable by `anon`/`authenticated`
  except through existing capability paths — the same column-privilege check SPEC 05 required.
- Storage estimate must be produced before the runbook and stay inside the cost ceiling.
- Migrations written by the terminal, **applied by the owner via runbook**, verified via MCP.

## 13. Out of scope

Full resumability, scheduled re-crawls, incremental crawling, monitoring, delta emails (SPEC 06).
GSC and log-file orphan sources (SPEC 06). Segment-level scoring and the crawl-diff UI (5.2 —
the fingerprint makes them possible). Findings aggregation and the result-page redesign (5.2).
FU-12k, the bidi ticket, and the ReDoS amplification ticket (separate). Any JavaScript rendering.
Any LLM call. Any change to the AI-readiness score's four components or weights.

## 14. Build sequence & STOP gates

Plan first; STOP for approval at each gate (`docs/OPERATING-RULES.md` §3).

**Terminal 5.1a**
0. **Stage 0 — verify and plan.** Read the repo, confirm every reference, produce a plan with real
   `file:line` anchors, propose all constants as a reviewable table. **STOP.**
1. **Stage 1 — crawl integrity** (§4). Report the canonicalisation effect on page counts. **STOP.**
2. **Stage 2 — page classification** (§5). Report the grade delta; do not seek approval yet. **STOP.**
3. **Stage 3 — deterministic frontier + fingerprint** (§6). **STOP for owner review of the
   reproducibility evidence** — this is the spec's central claim.
4. **Stage 4 — coverage & orphan triangulation** (§7). **STOP.**
5. **Stage 5 — frontier checkpoint** (§8) + migration runbook to owner. **STOP.**
6. **Stage 6 — close-out:** full suite, guards, backtest, adversarial gate, live smoke on the
   **deployed** function, PR. **STOP — no merge without owner approval.** Post-merge: confirm the
   Vercel production deployment reaches READY and run a production smoke.

**Terminal 5.1b** *(fresh terminal, after 5.1a merges)*
7. Stage 7 — honest scoring (§9). **STOP.**
8. Stage 8 — calibration (§10). **STOP — owner sign-off on the before/after panel.**
9. Stage 9 — invariants (§11), close-out, PR. **STOP.**

## 15. Acceptance criteria

| # | Test | Pass condition |
|---|---|---|
| B1 | Robots on all paths | Sitemap-seeded, redirect-target and canonical-target URLs all pass the robots gate; disallowed URLs never fetched |
| B2 | Origin | `a.com.evil.com` rejected; `www.` equivalence preserved |
| B3 | Canonicalisation | RFC-3986 normalisation deterministic; tracking params stripped per allowlist; effect on counts measured |
| B4 | Classification | E5 URLs classify correctly; contact page and short article stay `content`; every rule fixture-pinned |
| B5 | SimHash | Deterministic given fixed tokenizer/hash; k=3 collapsing correct; every decision logged |
| B6 | Frontier determinism | Two crawls of an unchanged corpus ⇒ identical fingerprint digest **and** identical grade |
| B7 | Stratification | No template exceeds its quota; every discovered stratum represented before any gets a second quota |
| B8 | E1 replay | duskroute-shaped conditions produce a bounded grade range, not a six-letter swing |
| B9 | Coverage | fetched / gradeable / estimated distinguishable and correct; exclusions surfaced |
| B10 | Sitemap orphans | Orphans found that crawl-only detection misses; robots-disallowed flagged separately |
| B11 | Checkpoint | Timed-out crawl resumes without restarting; determinism preserved across the resume |
| B12 | Refusal | Below threshold, no letter asserted on any surface |
| B13 | Headline | Cannot contradict findings, for any finding set (property) |
| B14 | Invariants | I1–I6 all pass, all mutation-verified |
| B15 | Panel | Before/after table produced across panel and corpus; every movement explained |
| B16 | Security | RLS deny-by-default verified via MCP; no policy widened; SSRF untouched |
| B17 | Live smoke | Verified on the **deployed** function, not locally |

## 16. Git & workflow

- Branch `engine/spec-5-1a` (then `engine/spec-5-1b`) in its own worktree off a fresh `origin/main`.
- Small conventional commits. **Never squash.** Full history preserved on merge — if the repo
  default is squash-merge, flag it before merging.
- **Trace-audit before every push:** no coding-assistant references in commit messages, code,
  comments, docs or PR bodies; no authorship trailers; single author.
- Adversarial gate (correctness / security / deploy-safety / test-quality) on a **frozen SHA** with
  each reviewer in its **own worktree** before any push.
- Verification order: `pnpm test` → `pnpm typecheck` **after the final commit** → `pnpm lint`
  **before** `next build` → `next build`.
- Never push to `main`; never self-merge; no merge without explicit owner approval.
- After merge: confirm the Vercel production deployment reaches READY, then verify on production.
- **Report a blocker before fixing it** if it lands inside your own prior fix — that pattern cost
  SPEC 05 four extra rounds, and the remedy is to change approach, not to patch again.
