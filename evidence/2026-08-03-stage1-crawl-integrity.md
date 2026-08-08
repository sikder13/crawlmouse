# SPEC 5.1a Stage 1 (§4) — crawl integrity: gate evidence

**Recorded:** 2026-08-03 · branch `engine/spec-5-1a` · base `origin/main` = `69b039f`
**Gate:** robots compliance proven on all four entry paths; the `a.com.evil.com` fixture fails closed;
the canonicalisation effect on page counts measured and reported; full suite green.

---

## 1. B1 — robots compliance on every entry path

Proven by `packages/engine/src/crawl-integrity.test.ts` against a loopback fixture whose `robots.txt`
disallows `/search` and `/cart`, and which offers all four routes into that disallowed space.

**The assertion is what the server was NEVER ASKED FOR, not what is absent from the result.** A page can
be absent from the output for a dozen reasons; compliance is a statement about the requests we made, so
the fixture records every path it is asked for and the test asserts against that log.

| Entry path | Fixture route | Result |
|---|---|---|
| 1. Enqueued link | homepage links `/search?q=link` | never requested |
| 2. Sitemap seed | `sitemap.xml` lists `/search?q=sitemap` and `/cart` | never requested |
| 3. Redirect target | `/go` → 302 → `/search?q=redirect` | never requested |
| 4. `rel=canonical` target | `/canon` declares canonical `/search?q=canon` | never requested; canonical **not adopted** as the page identity |

**Negative control, deliberately included:** a gate that blocked everything would satisfy all four rows
above while destroying the product. The same test pins that `/`, `/ok`, `/go` and `/canon` were reached
and that the audit still produced pages.

### A defect this found in its own first implementation, recorded because it nearly shipped silently

The redirect hook was first registered *inside* the `!allowPrivateIpsForTesting` block, next to the SSRF
revalidation. The robots gate therefore inherited the loopback bypass and did nothing in exactly the
place a fixture could have proven it — the test went red on `/search?q=redirect`, which is the only
reason it was caught. Registration is now unconditional; only the SSRF revalidation stays gated. A
private-IP allowance says nothing about what a site owner permits.

The second failing assertion (entry path 4) turned out to be a *symptom* of the first, not an
independent defect: the redirect had actually fetched `/search?q=redirect`, so that URL was in `pages`
for reasons unrelated to `rel=canonical`. One fix turned both green.

## 2. B2 — origin

`selectSitemapSeeds` is extracted and pure so the rule can be pinned directly. `https://a.com.evil.com/x`
is rejected; `https://a.comevil.com/y` and `https://evil.com/z` are rejected; `https://www.a.com/w` is
accepted (www-equivalence preserved); `https://blog.a.com/b` is rejected (a real subdomain is a different
site). The incumbent was `c.startsWith(canonicalOrigin)` against an origin with no trailing slash.

## 3. B3 — the canonicalisation effect, measured

Measured over the **entire production corpus**: 218 audits, **40 927 page rows**. Each stored URL was
canonicalised under the base strip-list and under the extended one, and the distinct-identity counts
compared per audit.

```
§4.3 canonicalisation strip-list extension
  page identities collapsed: 0 of 40 927 rows (0.000%)
  audits with any collapse:  0 of 218

§4.4 trap caps applied to already-crawled real pages
  rows that WOULD now be excluded: 0 of 40 927 (0.000%)
```

**Zero. And a zero from a broken instrument is worse than no measurement, so the instrument was proven
live first** — fed `?srsltid=abc` and `?PHPSESSID=z9`, the two canonicalisers disagree (old keeps, new
strips); fed a 15-segment path, `isCrawlTrap` returns `path_depth`.

Independently confirmed in SQL rather than only through the same code path:

| check | result |
|---|---|
| page rows | 40 927 |
| rows with any query string | **1 882** (4.6 % — the corpus is not degenerate) |
| rows carrying any newly-stripped key | **0** |
| rows deeper than 12 path segments | **0** |
| longest stored URL | **409 chars** (cap 2048) |
| rows containing `sid=` | **0** |

### What this means, stated without reaching

The strip-list extension and the trap caps are **forward-looking insurance with no measured effect on
the existing corpus.** They are not a fix for anything observed. Three reasons the effect is smaller than
SPEC 5.1 §4.3 anticipated, all of which understate it further:

1. `url-canonical.ts` already implemented most of §4.3 (host lowercasing, fragment strip, default-port
   drop, sorted params, dot-segments, multi-slash collapse, trailing-slash strip, and a tracking-param
   list) before this stage.
2. **Crawlee's request queue normalises common tracking parameters away at enqueue time**, below our
   canonicalisation — discovered in Stage 0.5 when a `?utm_source=` fixture produced identical
   compositions. Those URLs never become rows at all.
3. The corpus is biased by construction: it contains pages we already crawled, so identities the old
   list already collapsed are invisible, and `srsltid` in particular rides *inbound* Google Shopping
   links rather than a site's own internal linking.

The `sid` decision is untested either way by this corpus — 0 rows contain it. It rests on the argument,
not on data: stripping a content parameter merges distinct pages and deletes real ones from the graph,
which is a worse failure than the duplicate identity it would prevent.

## 4. Grade effect on real sites — and why one row cannot be attributed

`--mode=ab`, base `origin/main` vs head, pageCap 500, 120 s budget.

| URL | base | head | Δ | composition | verdict |
|---|---|---|---|---|---|
| racedays.run | B+/80.32 | B+/80.32 | +0.00 | 419→419 **identical** | grade-neutral |
| defaultoffice.com | B−/70.61 | B−/70.61 | +0.00 | 15→15 **identical** | grade-neutral |
| quotes.toscrape.com | B/76.09 | B/76.09 | +0.00 | 214→214 **identical** | grade-neutral |
| info.cern.ch | A−/87.04 | A−/87.04 | +0.00 | 123→123 **identical** | grade-neutral |
| mohammadalinijhoom.com | B−/74.18 | C/63.49 | **−10.69** | 31→50, +19 pages | **not attributable — see below** |

**Four of five sites: identical fetched-page set, identical grade.** On those, Stage 1 is grade-neutral
and the identical composition is what licenses that claim.

### The fifth row is NOT a Stage 1 effect, and the control proves it

The head engine fetched **more** pages (50 vs 31). Stage 1 is purely restrictive — robots, exact origin,
trap caps can only remove URLs — so it cannot produce that. Rather than argue the point, the same-engine
control was run:

```
--mode=repro (base and head are the SAME engine, twice, same site, same budget)
  run A:  65 pages C/63.43  →  80 pages C/61.54   (+15 pages, Δ−1.89)
  run B:  91 pages C/62.25  →  97 pages C/63.24   (+6 pages,  Δ+0.99)
```

**The same engine, on that site, never reproduces its own sample.** Six crawls within about fifteen
minutes:

| | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| pages | 31 | 50 | 65 | 80 | 91 | 97 |
| score | 74.18 | 63.49 | 63.43 | 61.54 | 62.25 | 63.24 |

A 12.64-point range with the engine held constant. The ab delta of −10.69 sits **inside** that range, so
the panel cannot attribute it to Stage 1 in either direction — and the honest report is that it is
unattributable, not that it is zero.

Two things worth carrying forward:

- **Page count rose monotonically across all six crawls (31 → 97).** Consistent with the host warming its
  cache under repeated crawling, so each crawl reaches further within the same 120 s budget. If that is
  the mechanism, crawl composition is a function of the *host's* wall-clock state — a forbidden frontier
  input under §6.6, arriving from outside our process entirely.
- **The score falls as coverage rises** (74.18 at 31 pages → ~62 at 91). That is E1's non-monotonicity
  reproduced live on a second site, and it is the SPEC 5.1 thesis in one table.

This is the Stage 0.5 instrument doing exactly the job it was built for on its first real use: **it
refused to attribute a grade movement to an engine change, and named the pages that moved instead.** The
old crawl-once-grade-twice axis would have reported Δ0.00 here and said nothing at all.

## 5. Known cost, pinned rather than left implicit

A robots-refused redirect is **retried**: 5 requests to the redirecting page for one deterministic
verdict. Crawlee's non-retryable error class does not fix it, and that was verified rather than reasoned
— the throw happens inside a got hook, got wraps it in its own `RequestError`, and the class identity
Crawlee dispatches on is lost at that boundary. The supported mechanism is `request.noRetry` set from
Crawlee's own `errorHandler`, a different layer. Reported rather than patched in, per the
report-before-fixing rule; `crawl-integrity.test.ts` asserts the defect so the fix has a tripwire.

## 6. Mutation verification

Harness liveness proven first with an unconditional throw in `isUrlAllowed` (15 tests failed). Every
mutation applied to a `cp` backup and reverted from it — never `git checkout --`. All nine killed by
named tests:

| # | Mutation | Killed by |
|---|---|---|
| M1 | `isUrlAllowed` always permits | 6 tests |
| M2 | seed selector drops the robots filter (restores E8) | 3 tests |
| M3 | origin reverts to the bare prefix test | the `a.com.evil.com` test |
| M4 | redirect-target robots check removed | 2 tests |
| M5 | canonical-target robots check removed | the entry-path-4 test |
| M6 | redirect hook re-buried in the SSRF-bypass block | 2 tests |
| M7 | trap caps removed from link admission | the entry-path test |
| M8 | session tokens dropped from the strip list | the session-token test |
| M9 | **`sid` ADDED to the strip list** | the `sid`-is-content test |

M9 matters as much as the others: the conservative choice is pinned, so adding `sid` later is a
deliberate act rather than an accident.

## 7. Verification

`pnpm test` green — engine 49 files, web 197, inngest 8, scripts 2 (5/5 turbo tasks).
`pnpm typecheck` after the final commit. `pnpm lint` clean. `next build` passes (with the gitignored
`apps/web/.env.local` supplied — see `docs/OPERATING-RULES.md` §7).

One pre-existing guard fired and was satisfied rather than suppressed: `crawled-text-cut-guard` keys its
inventory on exact source text, so extracting `selectSitemapSeeds` moved a cut it tracks. Re-inventoried
at its new location with the same classification (an array slice over URL strings, which cannot split a
surrogate pair).

## 8. Reproduce

```bash
nvm use 22
git worktree add --detach ../crawlmouse-base origin/main && (cd ../crawlmouse-base && pnpm install)
pnpm backtest -- --mode=ab --base-engine=$PWD/../crawlmouse-base/packages/engine/src/index.ts \
  --urls=https://racedays.run/,https://defaultoffice.com/,https://mohammadalinijhoom.com/,https://quotes.toscrape.com/,https://info.cern.ch \
  --pageCap=500 --budget-ms=120000 --out=evidence/backtest-stage1-crawl-integrity.md
pnpm backtest -- --mode=repro --urls=https://mohammadalinijhoom.com/,https://mohammadalinijhoom.com/ \
  --pageCap=500 --budget-ms=120000 --out=evidence/backtest-stage1-repro-control.md
```
