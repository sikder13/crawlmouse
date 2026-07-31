# Crawlmouse — SPEC 05 close-out and what comes next

**Written 2026-07-31 for someone with zero context.** This is a starting point, not a session log. Read it
top to bottom before touching anything; it should be enough to begin work without archaeology.

Orientation, if you have not read anything else yet: **`PROJECT_OVERVIEW.md`** (what the product is, the
architecture, the infrastructure IDs) and **`docs/specs/00-crawlmouse-master-build-plan.md`** (the phase
plan and the conversion spine every change must serve). `CLAUDE.md` is the operating law. Read those three
first — this document assumes them.

---

## 1. Where `main` is right now

**SPEC 05 (AI / agent-readiness) is shipped, live, and verified on production.** Three PRs merged
2026-07-31, all with full history, no squash:

| PR | merge commit | what |
|---|---|---|
| #22 | `c40d548` | SPEC 05 hotfix-01 — H1 access card, H2 pluralisation, H3 collapsed row labels (12 commits) |
| #23 | `3e2b305` | Two tickets: robots `Disallow` bypass (HIGH), bidi override (MEDIUM) |
| #24 | `7d16524` | SPEC 5.1 evidence: the racedays.run reproducibility control is retired |

Production is healthy. The deployment for `c40d548` reached READY and is aliased to `crawlmouse.com` /
`www.crawlmouse.com`. **`AI_READINESS_EXTRACTION=1` in the Vercel Production scope** — the feature is ON,
not dark. Post-merge verification was done on a **fresh live audit**, not only on tests: `racedays.run`
re-crawled in 68 s, and the rendered access card showed the reach group and the blocked group disjoint, no
bot in both, card percentages matching the findings on the same screen, 101 finding rows with zero
duplicates.

### What hotfix-01 actually fixed, in one line each
- **H1** — the "Who can reach your content" card was rendering the *blocked* bots under a heading saying
  the opposite, contradicting findings on the same screen. Now one `partitionRetrievalBots()` yields two
  never-mixed groups on both the result page and the public report.
- **H2** — the executive summary shipped `"10 over-optimized anchorss"`. Replaced with explicit
  `countable: { one, other }` per category plus an uncounted `siteWide` phrase for site-level singletons.
- **H3** — collapsed AI finding rows showed a bare "Site-wide". Rows now carry the finding text plus the
  target, scoped by **URL path** (see §4 for why the path and not the page title — it is the most
  instructive thing in this whole batch).

---

## 2. Open work, each with why it matters

Ordered roughly by how much damage leaving it does. Nothing here is started.

### HIGH — sitemap seeds bypass the robots.txt `Disallow` filter
`docs/tickets/2026-07-31-sitemap-seeds-bypass-robots-disallow.md`

**Why it matters:** we run a public crawler against other people's websites and sell honesty, and we are
currently fetching paths owners explicitly disallowed. That is a compliance and reputation exposure, not
just a bug — it is the behaviour most likely to get the crawler blocked or written up, and
`PROJECT_OVERVIEW.md` §5 claims we respect robots.

Robots filtering is applied to *enqueued links only* (`crawler.ts:274-284`, applied at `:469`); sitemap
URLs go into `startUrls` at `audit.ts:207-239` unchecked. Measured: `Disallow: /search` + `/cart` over 419
pages drops all 14 bots to 98% and emits six spurious HIGH findings — so it corrupts the diagnosis too.
Ticket also covers a second hole in the same path: the same-origin gate is a bare prefix test, so
`a.com.evil.com` passes as same-origin.

### MEDIUM — U+202E bidi override survives percent-decode into display text
`docs/tickets/2026-07-31-bidi-override-survives-url-decode.md`

**Why it matters:** a crawled path can visually reverse itself so a malicious URL reads as a benign one, on
surfaces a user reads to decide whether a URL is safe — including the permanent, indexable `/r/` report.
Inert text, correctly escaped, **not XSS**. No bidi stripping exists anywhere in the repo; the class spans
all 11 decode modules. **Do not break legitimate RTL script (Arabic, Hebrew) while fixing it** — the guard
matrix pins that and must keep passing. Sweep together with the super-linear decode ticket below; same
helper, same call sites.

### MEDIUM — super-linear decode reachable on a server-rendered page
`docs/tickets/2026-07-31-url-display-superlinear-decode.md`

**Why it matters:** ~10 s of Vercel CPU per request, repeatable, against the ≤18%-MRR cost ceiling.
Important nuance the ticket states carefully: **audit creation IS rate-limited** (global fail-closed →
per-IP + Turnstile → per-domain, and that contract is intact). This is *amplification* — one gated POST
stores a poisoned row, then `GET /audit/<uuid>` is unmetered and unauthenticated.

### FU-12k — one source of truth for the bot reach percentage (APPROVED, not started)
`docs/specs/05-follow-ups.md`

**Why it matters:** the percentage a user sees is computed **twice** from `allowedPageRatio` — once by the
engine into the finding text, once by the card. Two computations of one number drift, and they did, twice,
inside one hotfix. This is the structural fix for a defect class that resisted two point-patches.

Approved scope: compute it **once** in `buildAccessMatrix` using **exact integer math**
`Math.floor((allowed * 100) / total)` — never through the float ratio — with two readers. Folds in the
`fullyBlocked`/0% conflation (a bot at 0.2% renders `0%`, byte-identical to a total block, and
`fullyBlocked` is persisted but read by no surface) and the headline rounding, where 1 disallowed page of
419 currently renders **"100 / 100 AI-ready"** above a HIGH restriction finding. Governing rule:
**a perfect displayed score must be unreachable while any finding exists.** Legacy snapshots without the
field fall back to **rounding**, matching their frozen text — an immutable artifact prioritises internal
coherence over retroactive correctness. Its tests must assert **hand-computed truth** (29/100→29,
290/500→58, 418/419→99, 299/300→99), never the other side's output.

### The FU-12 residual list
`docs/specs/05-follow-ups.md`, items **12a–12k**, plus
`docs/tickets/2026-07-31-ai-surfaces-degradation-and-unpinned-guards.md`.

**Why it matters:** these are the known-and-disclosed remainder. Read them before filing anything new —
most "discoveries" in this area are already here. Highlights: **12b** (the executive summary quotes
per-category counts `capFindings` truncated at 10, so it says "10" where an audit has 43 — pre-existing,
live, and the first item of the next batch); raw JSX children that 500 the permanent report on a non-string
value with no mint-time backstop; the audit page degrading *worse* than the report whose tolerance its own
comment claims; and three guards whose mutations survive the whole suite (the `pct === null` guard on both
surfaces, the empty-state predicate on both surfaces, and `boundScope` behaviours killed only by
source-text bookkeeping rather than behaviour).

### The SPEC 5.1 evidence base
`evidence/2026-07-31-racedays-reproducibility-control-retired.md`, `evidence/backtest-spec05-stage7*.md`,
FU-9 in `docs/specs/05-follow-ups.md`.

**Why it matters:** grade reproducibility is conversion prerequisite #1 (SPEC 00 D1), and we currently
cannot verify it. State of the evidence:

- **duskroute series** — crawl-composition instability producing swings up to **56 points** on sites with
  giant index pages monopolising the frontier. Site-shape-dependent, not universal.
- **racedays.run is no longer a byte-identical control.** It returned 418 pages / 80.60 on 2026-07-31 after
  419 / 80.32 on both 07-27 and 07-30. Same grade; 1 page, 0.28 points. The engine was byte-identical to
  the prior release (verified three ways), so the hotfix did not cause it.
- **The finding is that we cannot tell which cause it is.** Genuine site drift and crawl-order
  nondeterminism produce identical evidence. A determinism contract we cannot verify against a live site is
  not a contract — it is an assumption that happened to hold twice.
- **Proposed instrument: persist a discovered-URL-set fingerprint per audit** (a stable hash over the
  sorted set of fetched URLs). Then *identical fingerprint + different grade* = an engine defect, and
  *different fingerprint* = an explained input change, with the set difference naming which pages moved.
  **One artifact serves three needs**: SPEC 5.1 determinism, FU-9 (which asks for the same thing from the
  measurement side so A15 can certify grade-neutrality on unstable sites), and **SPEC 06 monitoring**,
  which will otherwise report phantom grade movement to users on exactly this class of site.

---

## 3. Working agreements that must survive this handoff

These are not preferences. Several were learned expensively.

- **Never squash. Full history.** Every logical unit stays its own commit; merge with a merge commit.
- **Trace-audit before every push.** No AI-tool references anywhere in commits, PRs, code, or comments;
  strip any `Co-Authored-By` trailer. Also scan for secret-shaped strings.
- **Migrations are owner-applied only.** Approve exact SQL and dry-run first.
- **No merge without explicit owner approval.** Open the PR and stop.
- **Adversarial review gate before push** — three independent reviewers across correctness / security /
  deploy-safety / test-quality, on a **frozen SHA** in **isolated worktrees**, fix-loop to ≥9 with 0
  blocking. Do not self-review in one pass.
- **Verification checklist, in this order:** full test suite → **typecheck AFTER the final commit** (not
  before, or you validate a tree you did not ship) → lint before build → `next build`.
- **Live smoke on the deployed function.** "Works locally" and "works in the local Inngest dev server" are
  not done — the core pipeline was once 100% broken in production while every local test passed
  (`PROJECT_OVERVIEW.md` §11). After any engine/crawl-path change, smoke a static site, a throttling
  WordPress site, and a JS/SPA site.
- **Environment:** `nvm use 22` (system default is 20). Gate worktrees symlink `node_modules` into the
  primary tree, so mutating `packages/**` inside one is **invisible** to `apps/web` runs and produces false
  "SURVIVED" verdicts — always prove a mutation harness is live with an unconditional `throw` first. Never
  use `git checkout --` to revert a mutation; it has destroyed uncommitted work here. Use `cp` backups.

---

## 4. Transferable engineering lessons

Stated plainly, because each of these cost real rounds.

**Fix the class, not the instance.** A review finding is a category, not a line. Enumerate every site
before fixing one. This hotfix added `String(...)` at one JSX child and left four siblings with the same
500-on-non-string exposure; the same pass fixed one decode surface and left ten.

**Never claim coverage you have not mutation-verified.** Break the code deliberately and confirm a *named*
test fails. Multiple guards here had no killing test while their comments asserted they were load-bearing.

**A test that cannot fail is not a test.** Several were worse than nothing because they *certified* the
bug: an expectation string the engine cannot produce; an astral-boundary vector at even parity, where a raw
slice never splits; a copy table read back from the module under test; a whole-document `toContain` where
the string also appears in the expanded body. And the sharpest one — **agreement is not correctness**: a
property test asserting `card === finding` passed green while *both* sides floored `0.29 * 100` to 28,
because it cannot see an error the two sides make together. When a test compares two implementations,
also pin at least one against independently hand-computed truth, at a vector where the candidate rules
actually differ. (The first attempt at that fix still missed `Math.ceil`, because every vector sat where
round and ceil coincide.)

**When you replace a reference implementation, that implementation is your oracle.** `Math.round` was in
production and looked semantically wrong for a restriction warning; replacing it with `Math.floor` printed
a *false* number at 40 count-pairs, because `0.29 * 100` is `28.999999999999996` in binary floating point.
The incumbent was accidentally correct. Diff against it before assuming you are improving it.

**Do not generalise a small sample into a property of the world.** "Every production `allowedPageRatio` is
0 or 1" came from five rows and was used to argue a defect was unreachable; it was reachable through
ordinary sitemap seeding. "racedays.run is byte-identical across runs" came from two runs. Both were stated
as properties and both fell over.

**Render against real production data before writing UI copy.** Helper tests use fixtures you invented, and
invented fixtures have distinct titles. Real CMS output does not: racedays.run gives **405 of 500** findings
the same `<title>`, which collapsed **43 of 100** rendered rows onto two strings while every helper test
passed. That is why the collapsed row is scoped by URL path — a path is unique per page *by construction*,
so the rule has no exception to relocate, where "prefer the title unless it repeats" needs cross-row context
the helper does not have. Render first, write copy against what you observe, and write the tests last to pin
what you saw.

**Know when to stop.** This hotfix ran five gate rounds, and rounds 1–4 each introduced the next round's
blocker — always in copy or numeric display. The loop broke only when a terminal condition was set in
advance and honoured: stop patching, de-risk instead. The engine was reverted to the incumbent's exact
behaviour, which made `packages/engine` runtime byte-identical to the prior release and dropped the
crawl-path risk to zero, and the structural fix was deferred to its own properly-scoped work (FU-12k). If
you find yourself fixing a defect inside your own previous fix for the second time, that is the signal.

---

## 5. Pointers

- Prior handoff, with the full round-by-round hotfix history: `docs/handoff/2026-07-31-spec05-hotfix-01-handoff.md`
- Follow-ups and FU-12k scope: `docs/specs/05-follow-ups.md`
- Open tickets: `docs/tickets/`
- Evidence base: `evidence/`
- Deploy runbook: `docs/deploy/launch-runbook.md`
- A safety-net tag exists on origin: `backup/spec05-pre-rebase-a1bb5e7`. Leave it.
