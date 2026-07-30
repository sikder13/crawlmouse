# Backtest (crawl-once-grade-twice): 30 audits — v1 vs v2 on the SAME crawl

Crawl: v2 pipeline, pageCap=500, budget=240000ms. Stored grade = context only; the diff is v1↔v2.

| URL | stored | v1 | v2 | Δ(v2−v1) | grade | finding deltas (v2−v1) | health(v2) | flag |
|---|---|---|---|---|---|---|---|---|
| https://mohammadalinijhoom.com | C/62.87 | C+/65.94 | C+/65.94 | +0.00 | same | incomplete_crawl:+1 | low cov=52% blk=0% partial |  |
| https://alynthe.com | A-/88 | A-/88.00 | A-/88.00 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://quotes.toscrape.com | B/76.09 | B/76.09 | B/76.09 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://getcastle.com/ | C+/65.59 | C+/65.59 | C+/65.59 | +0.00 | same | unreachable_page:-8, incomplete_crawl:+1 | low cov=55% blk=0% partial |  |
| https://valcirxaves.com/ | C/60 | C/60.00 | C/60.00 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://developer.stockfit.io/ | B+/82.32 | B+/82.32 | B+/82.32 | +0.00 | same | — | high cov=95% blk=0% partial |  |
| https://routealert.io/ | B-/74.43 | B-/74.43 | B-/74.43 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://rewardguru.in/ | D-/42.53 | D-/42.53 | D-/42.53 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://uims.cuchd.in/ | C/60 | C/60.00 | C/60.00 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://njcarpetsteamers.com/ | B-/74.21 | B-/74.23 | B-/74.21 | -0.02 | same | incomplete_crawl:+1 | low cov=62% blk=0% partial |  |
| https://www.flooddamagepro.com/ | B+/80.61 | B+/82.56 | B+/80.61 | -1.95 | same | orphan:-2, over_optimized_anchor:-1 | medium cov=71% blk=0% |  |
| https://www.baltimorecarpetcleaning.com/ | C/64.3 | B-/74.73 | B-/74.79 | +0.06 | same | — | medium cov=84% blk=0% |  |
| https://eyondo.com/home | A-/88.29 | A-/88.15 | A-/88.29 | +0.14 | same | incomplete_crawl:+1 | low cov=20% blk=0% partial |  |
| https://provion.io/ | B+/82 | B+/82.00 | B+/82.00 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://duskroute.com/ | C+/69.99 | C+/69.14 | C+/69.14 | +0.00 | same | unreachable_page:-494, incomplete_crawl:+1 | low cov=20% blk=0% partial |  |
| https://metadataconverter.com/ | B-/70.35 | B-/70.35 | B-/70.35 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://thejerseyworld.com.au/ | B-/73.74 | B-/73.55 | B-/73.74 | +0.19 | same | over_optimized_anchor:-1 | high cov=97% blk=0% partial |  |
| https://zofbox.com/ | C/60 | C/60.00 | C/60.00 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://www.spplus.com.au/ | C/60 | — | — | n/a | n/a | — | — | ⛔ EXCLUDED (0 ok pages) |
| https://trykanso.app/ | B-/72.76 | B-/71.40 | B-/72.76 | +1.36 | same | orphan:-1, unreachable_page:-2 | high cov=93% blk=0% partial |  |
| https://stream4k.tv/ | B/75.2 | C+/68.98 | B/75.20 | +6.22 | C+→B | orphan:-3, over_optimized_anchor:-12, incomplete_crawl:+1 | low cov=54% blk=0% partial | 🚩 explain |
| https://fortivibe.com/ | D-/42.23 | C/62.99 | C/62.23 | -0.76 | same | over_optimized_anchor:-1, incomplete_crawl:+1 | low cov=38% blk=0% partial |  |
| https://apptile.com/ | B/75.09 | C/62.73 | C/62.76 | +0.03 | same | deep_page:-2, unreachable_page:-38, incomplete_crawl:+1 | low cov=33% blk=0% partial |  |
| https://www.atscontainers.com/ | C+/65.99 | C+/65.51 | C+/65.51 | +0.00 | same | incomplete_crawl:+1 | low cov=46% blk=0% partial |  |
| https://www.swarovski.com/ | C/60 | — | — | n/a | n/a | — | — | ⛔ EXCLUDED (0 ok pages) |
| https://revenuetales.com/ | C+/67.38 | C+/67.38 | C+/67.38 | +0.00 | same | — | high cov=96% blk=0% partial |  |
| https://platesandpixels.com.gr/ | C/60 | C/60.00 | C/60.00 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://www.taskrabbit.co.uk/ | C/60.28 | C-/59.54 | C-/59.54 | +0.00 | same | unreachable_page:-23, incomplete_crawl:+1 | low cov=28% blk=0% partial |  |
| https://javasystemsolutions.com/ | B-/70.14 | B-/70.14 | B-/70.14 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://www.tinkeringmonkey.com/ | B/78.19 | B/78.19 | B/78.19 | +0.00 | same | unreachable_page:-209, incomplete_crawl:+1 | low cov=47% blk=0% partial |  |

**1** audit(s) with |Δscore| > 5 — each must be explained before the ENGINE_V2 flip (§8).
**2** excluded (logged above, not dropped). **15** partial (budget/cap-truncated crawl; the v1↔v2 diff is still valid).
---

## Stage-7 sign-off — the one flagged row, explained

**`https://stream4k.tv/` — Δ(v2−v1) = +6.22, C+/68.98 → B/75.20.** Explained, and NOT a SPEC 05 regression.

**What the diff actually measures.** This harness crawls once and grades twice: **engine v1 vs engine v2** on the
identical crawl output. It does not compare "with SPEC 05" against "without SPEC 05" — SPEC 05 contributes no
grading input at all (`packages/engine/src/audit.ts`: the AI assembly runs after the grade is computed and is
attached as a separate `aiReadiness` field; the four grade components and their weights are untouched).

**Why this row is not a change we are shipping.** The stored production grade for this site is **B/75.2** and the
**v2 column reproduces it exactly (75.20)**. v2 *is* current production behaviour (ENGINE_V2 is enabled in prod).
The +6.22 is therefore the gap to the **retired v1 engine**, i.e. the already-shipped ENGINE_V2 cutover, not a
delta this branch introduces. The finding deltas say the same thing: `over_optimized_anchor: -12` (v2 emits 12
fewer over-optimised-anchor findings, lifting the 20%-weighted anchor component) and `orphan: -3`, both v2
node-eligibility properties from SPEC 01. Crawl health is `low cov=54% partial`, so this is also a partially
crawled site where the sampled subset amplifies anchor concentration — the count-transparency class tracked
separately as SPEC 5.1.

**The SPEC 05-specific question — "does the AI work move the A–F grade?" — is answered deterministically**, and
more strongly than a sampled backtest could:

- `packages/engine/src/extract.test.ts` — grade-bearing outputs (title/links) are **byte-identical** with
  `AI_READINESS_EXTRACTION` on vs off.
- `packages/engine/src/ai-kill-switch.test.ts` — the same site crawled with the switch OFF then ON yields the
  **same grade and the same score**.

**Corpus health:** 30 audits attempted, 28 graded, **2 excluded** (`spplus.com.au`, `swarovski.com` — 0 fetchable
pages; logged, not dropped), 15 partial. Excluding the row above, the largest absolute delta is **1.95**.
