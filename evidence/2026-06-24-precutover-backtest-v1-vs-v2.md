# Backtest (crawl-once-grade-twice): 34 audits — v1 vs v2 on the SAME crawl

Crawl: v2 pipeline, pageCap=500, budget=engine default (240s). Stored grade = context only; the diff is v1↔v2.

| URL | stored | v1 | v2 | Δ(v2−v1) | grade | finding deltas (v2−v1) | health(v2) | flag |
|---|---|---|---|---|---|---|---|---|
| https://dessinetonmeuble.fr/ | C/60 | — | — | n/a | n/a | — | — | ⛔ EXCLUDED (0 ok pages) |
| https://angielek.pl/ | B/77.38 | B/78.18 | C/60.00 | -18.18 | B→C | deep_page:-5, over_optimized_anchor:-34, incomplete_crawl:+1 | low cov=39% blk=57% partial | 🚩 explain |
| https://nodejs.org | C/60 | C+/67.46 | C/60.00 | -7.46 | C+→C | orphan:-84, incomplete_crawl:+1 | low cov=27% blk=0% partial | 🚩 explain |
| https://www.gnu.org | C-/58.76 | — | — | n/a | n/a | — | — | ⛔ EXCLUDED (Request timed out after 15000ms: https://www.gnu.org) |
| https://vuejs.org | D+/53.29 | C-/55.97 | C-/55.97 | +0.00 | same | unreachable_page:-5 | high cov=100% blk=0% |  |
| https://www.drupal.org | C/60 | A-/85.32 | C/60.00 | -25.32 | A-→C | unreachable_page:-3, incomplete_crawl:+1 | low cov=5% blk=0% partial | 🚩 explain |
| https://nextjs.org | C/60 | C+/69.59 | C/60.00 | -9.59 | C+→C | incomplete_crawl:+1 | low cov=47% blk=0% partial | 🚩 explain |
| https://www.wix.com | D/47.44 | D/47.06 | D/47.06 | +0.00 | same | unreachable_page:-1, incomplete_crawl:+1 | low cov=30% blk=0% partial |  |
| https://www.shopify.com | D/45.21 | F/38.74 | F/39.02 | +0.28 | same | orphan:-117, unreachable_page:-22, incomplete_crawl:+1 | low cov=3% blk=0% partial |  |
| https://www.joomla.org | C/64.64 | C/61.44 | C/60.00 | -1.44 | same | deep_page:-4, unreachable_page:-104, over_optimized_anchor:-4, incomplete_crawl:+1 | low cov=38% blk=1% partial |  |
| https://ghost.org | B/79.21 | C/64.28 | C/60.00 | -4.28 | same | unreachable_page:-132, incomplete_crawl:+1 | low cov=69% blk=0% partial |  |
| https://www.squarespace.com | C+/69.41 | B-/73.85 | C/60.00 | -13.85 | B-→C | unreachable_page:-37, incomplete_crawl:+1 | low cov=41% blk=0% partial | 🚩 explain |
| https://webflow.com | D-/40.49 | D-/40.40 | D-/40.40 | +0.00 | same | incomplete_crawl:+1 | low cov=15% blk=0% partial |  |
| https://wordpress.org | C/62.05 | D/45.21 | D/46.04 | +0.83 | same | orphan:-84, unreachable_page:-10, incomplete_crawl:+1 | low cov=3% blk=17% partial |  |
| https://jecoba.com/ | B-/70.13 | B-/70.13 | C/60.00 | -10.13 | B-→C | incomplete_crawl:+1 | low cov=79% blk=21% | 🚩 explain |
| https://en.books4.you/ | B-/70.07 | — | — | n/a | n/a | — | — | ⛔ EXCLUDED (crawl did not settle within 300s (watchdog)) |
| https://en.books4.you/ | C/64.86 | B-/73.39 | C/60.00 | -13.39 | B-→C | orphan:-2, over_optimized_anchor:-1, incomplete_crawl:+1 | low cov=8% blk=33% partial | 🚩 explain |
| https://www.nahlai.com/ | C/64.29 | C/60.00 | C/60.00 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://bitcoinsucker.net/ | B-/73.61 | B-/73.61 | B-/73.61 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://www.facebook.com/ | C/60 | C/60.00 | C/60.00 | +0.00 | same | — | low cov=5% blk=0% partial |  |
| https://travellerbd.wordpress.com/ | B/75.22 | C/61.78 | C/60.00 | -1.78 | same | unreachable_page:-155, incomplete_crawl:+1 | low cov=2% blk=0% partial |  |
| https://www.alynthe.com/ | C/60 | A-/88.00 | A-/88.00 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://books.toscrape.com | A/90.61 | A/90.44 | C/60.00 | -30.44 | A→C | incomplete_crawl:+1 | low cov=63% blk=0% partial | 🚩 explain |
| https://quotes.toscrape.com | B/76.09 | B/76.09 | B/76.09 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://www.vogue.com/ | C+/69.25 | D/46.34 | D/46.34 | +0.00 | same | unreachable_page:-106, incomplete_crawl:+1 | low cov=14% blk=0% partial |  |
| https://mrspringmrsfresh.com/ | C+/68.74 | C+/68.74 | C/60.00 | -8.74 | C+→C | incomplete_crawl:+1 | low cov=54% blk=23% | 🚩 explain |
| https://ddott.net/ | B/77.62 | B-/74.66 | C/60.00 | -14.66 | B-→C | incomplete_crawl:+1 | low cov=2% blk=0% partial | 🚩 explain |
| https://fever.wnba.com/ | B/78.13 | B+/80.33 | C/60.00 | -20.33 | B+→C | unreachable_page:-97, incomplete_crawl:+1 | low cov=39% blk=0% partial | 🚩 explain |
| https://www.eigenstate.co/ | C/61.94 | C/61.30 | C/62.18 | +0.88 | same | orphan:-1, unreachable_page:-1 | high cov=95% blk=3% partial |  |
| https://www.betonkemon.com/en | C/60 | — | — | n/a | n/a | — | — | ⛔ EXCLUDED (0 ok pages) |
| https://www.spicebox.ca/ | C+/68.1 | C+/68.11 | C/60.00 | -8.11 | C+→C | over_optimized_anchor:-21, incomplete_crawl:+1 | low cov=25% blk=57% partial | 🚩 explain |
| https://www.nahltech.com/ | B-/73.94 | B-/73.94 | B-/73.94 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://mumbaiplacenyc.com/ | C+/69.42 | C+/69.42 | C+/69.39 | -0.03 | same | — | medium cov=91% blk=9% |  |
| https://www.alynthe.com/ | C/60 | A-/88.00 | A-/88.00 | +0.00 | same | — | high cov=100% blk=0% |  |

**12** audit(s) with |Δscore| > 5 — each must be explained before the ENGINE_V2 flip (§8).
**4** excluded (logged above, not dropped). **20** partial (budget/cap-truncated crawl; the v1↔v2 diff is still valid).