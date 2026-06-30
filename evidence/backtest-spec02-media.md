# Backtest (crawl-once-grade-twice): 30 audits — v1 vs v2 on the SAME crawl

Crawl: v2 pipeline, pageCap=500, budget=240000ms. Stored grade = context only; the diff is v1↔v2.

| URL | stored | v1 | v2 | Δ(v2−v1) | grade | finding deltas (v2−v1) | health(v2) | flag |
|---|---|---|---|---|---|---|---|---|
| https://lite.cnn.com/ | B/79.65 | B/79.65 | B/79.65 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://quotes.toscrape.com/ | B/76.09 | B/76.09 | B/76.09 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://useaboon.com/ | C/60 | C/60.00 | C/60.00 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://www.gatsbyjs.com/docs/ | C/60 | C+/67.61 | C+/67.61 | +0.00 | same | unreachable_page:-35, incomplete_crawl:+1 | low cov=33% blk=0% partial |  |
| https://astro.build/ | C/60 | B-/74.47 | B-/74.52 | +0.05 | same | deep_page:-3, incomplete_crawl:+1 | low cov=40% blk=0% partial |  |
| https://tom.preston-werner.com/ | B/75.19 | B/75.19 | B/75.19 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://curl.se/ | D/47.16 | B-/71.97 | B-/71.96 | -0.01 | same | incomplete_crawl:+1 | low cov=2% blk=0% partial |  |
| https://nginx.org/ | C/60 | A/90.27 | A/90.88 | +0.61 | same | orphan:-4, unreachable_page:-48, incomplete_crawl:+1 | low cov=23% blk=25% partial |  |
| https://www.sqlite.org/ | C/60 | A-/89.71 | A-/89.71 | +0.00 | same | incomplete_crawl:+1 | low cov=30% blk=0% partial |  |
| https://danluu.com/ | A-/88.43 | A-/87.01 | A-/87.37 | +0.36 | same | orphan:-1, deep_page:-1, unreachable_page:-1 | high cov=91% blk=0% partial |  |
| https://www.11ty.dev/ | C/60 | B-/72.08 | B-/72.08 | +0.00 | same | incomplete_crawl:+1 | low cov=22% blk=0% partial |  |
| https://jekyllrb.com/ | B/77.52 | B/77.35 | B/77.52 | +0.17 | same | orphan:-1, unreachable_page:-2 | high cov=92% blk=0% partial |  |
| https://text.npr.org/ | C/60 | C/60.00 | C/60.00 | +0.00 | same | — | low cov=4% blk=0% partial |  |
| https://lite.cnn.com/ | B/79.65 | B/79.65 | B/79.65 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://justinjackson.ca/ | A-/86.73 | A-/86.49 | A-/86.41 | -0.08 | same | over_optimized_anchor:-1 | medium cov=83% blk=0% partial |  |
| https://sive.rs/ | D/46.61 | D/46.61 | D/46.61 | +0.00 | same | unreachable_page:-5 | medium cov=81% blk=0% partial |  |
| https://web-scraping.dev/ | D/49.41 | D/49.65 | D/49.72 | +0.07 | same | orphan:-1, incomplete_crawl:+1 | low cov=51% blk=1% partial |  |
| https://www.scrapethissite.com/ | B-/73.69 | B-/73.10 | B-/73.69 | +0.59 | same | — | medium cov=89% blk=3% |  |
| https://dessinetonmeuble.fr/ | C/60 | — | — | n/a | n/a | — | — | ⛔ EXCLUDED (0 ok pages) |
| https://angielek.pl/ | B/77.38 | B+/82.72 | B+/82.79 | +0.07 | same | over_optimized_anchor:-1, incomplete_crawl:+1 | low cov=70% blk=0% partial |  |
| https://nodejs.org | C/60 | C+/67.46 | B-/71.31 | +3.85 | C+→B- | orphan:-84, incomplete_crawl:+1 | low cov=27% blk=0% partial |  |
| https://www.gnu.org | C-/58.76 | C/60.00 | C/60.00 | +0.00 | same | — | low cov=1% blk=0% partial |  |
| https://vuejs.org | D+/53.29 | C-/55.97 | C-/55.97 | +0.00 | same | unreachable_page:-5 | high cov=100% blk=0% |  |
| https://www.drupal.org | C/60 | A/92.39 | A/92.39 | +0.00 | same | incomplete_crawl:+1 | low cov=15% blk=0% partial |  |
| https://nextjs.org | C/60 | C+/69.70 | C+/69.70 | +0.00 | same | incomplete_crawl:+1 | low cov=47% blk=0% partial |  |
| https://www.wix.com | D/47.44 | D/47.20 | D/47.20 | +0.00 | same | unreachable_page:-1, incomplete_crawl:+1 | low cov=24% blk=0% partial |  |
| https://www.shopify.com | D/45.21 | F/38.74 | F/39.02 | +0.28 | same | orphan:-117, unreachable_page:-22, incomplete_crawl:+1 | low cov=3% blk=0% partial |  |
| https://www.joomla.org | C/64.64 | C+/69.44 | C+/69.38 | -0.06 | same | deep_page:-2, over_optimized_anchor:-2 | medium cov=74% blk=0% partial |  |
| https://ghost.org | B/79.21 | C/63.99 | C/63.99 | +0.00 | same | unreachable_page:-99, incomplete_crawl:+1 | low cov=58% blk=0% partial |  |
| https://www.squarespace.com | C+/69.41 | B-/72.80 | B-/72.80 | +0.00 | same | unreachable_page:-30, incomplete_crawl:+1 | low cov=32% blk=0% partial |  |

**0** audit(s) with |Δscore| > 5 — each must be explained before the ENGINE_V2 flip (§8).
**1** excluded (logged above, not dropped). **22** partial (budget/cap-truncated crawl; the v1↔v2 diff is still valid).

## Explanations (media/binary non-content skip — `excludeNonContentLinks`, commit 2213ba0)

**0 v1↔v2 swings > 5 — grade-neutral, as predicted for leaf-node removal.** Media/binary links
(`.jpg/.pdf/.js/.css/woff/…` + `/wp-content/uploads/`) are leaf nodes (inbound from their linking page,
no outbound), so dropping them from the crawl changes neither the orphan set nor the reachable structure
of the CONTENT graph. Every v1↔v2 delta is ≤0.61 except the pre-existing **nodejs** §1 (blocked/dead
node-eligibility, orphan:-84 → +3.85) — unrelated to this fix and identical to the coverage backtest.

**Vs the prior coverage backtest (absolute grades):** every grade LETTER is identical across the two
runs; most scores match to ≤1.1. The few larger cross-run score deltas (joomla C+ 65.15→69.44, danluu
A- 88.07→87.01, web-scraping 48.59→49.65) are all on PARTIAL/budget-truncated crawls (cov<90%, 240s
budget) where which pages fit the budget varies run-to-run — not a media-skip artifact. The controlled
"v1↔v2 on the SAME crawl" gate is 0.

**1 excluded** (dessinetonmeuble.fr, 0 ok pages — crawl reliability, not a grade change). angielek.pl
recovered this run (B+/82.79). §2 cap-removal still holds; anchor tune grade-neutral. SSRF/safe-fetch
untouched (this changes only which links are extracted/recorded, not what is validated/fetched).