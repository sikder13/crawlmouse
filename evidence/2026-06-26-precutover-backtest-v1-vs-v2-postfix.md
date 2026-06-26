# Backtest (crawl-once-grade-twice): 50 audits — v1 vs v2 on the SAME crawl

Crawl: v2 pipeline, pageCap=500, budget=240000ms. Stored grade = context only; the diff is v1↔v2.

| URL | stored | v1 | v2 | Δ(v2−v1) | grade | finding deltas (v2−v1) | health(v2) | flag |
|---|---|---|---|---|---|---|---|---|
| https://useaboon.com/ | C/60 | C/60.00 | C/60.00 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://www.gatsbyjs.com/docs/ | C/60 | C+/67.57 | C/60.00 | -7.57 | C+→C | unreachable_page:-35, incomplete_crawl:+1 | low cov=28% blk=0% partial | 🚩 explain |
| https://astro.build/ | C/60 | B-/74.56 | C/60.00 | -14.56 | B-→C | deep_page:-3, incomplete_crawl:+1 | low cov=28% blk=6% partial | 🚩 explain |
| https://tom.preston-werner.com/ | B/75.19 | B/75.19 | B/75.19 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://curl.se/ | D/47.16 | D/49.29 | D/48.11 | -1.18 | same | unreachable_page:-9, incomplete_crawl:+1 | low cov=4% blk=0% partial |  |
| https://nginx.org/ | C/60 | A/91.07 | C/60.00 | -31.07 | A→C | orphan:-4, unreachable_page:-8, incomplete_crawl:+1 | low cov=14% blk=33% partial | 🚩 explain |
| https://www.sqlite.org/ | C/60 | A-/89.71 | C/60.00 | -29.71 | A-→C | incomplete_crawl:+1 | low cov=30% blk=0% partial | 🚩 explain |
| https://danluu.com/ | A-/88.43 | A-/88.07 | A-/88.43 | +0.36 | same | orphan:-1, deep_page:-1, unreachable_page:-1 | medium cov=86% blk=4% partial |  |
| https://www.11ty.dev/ | C/60 | B-/72.08 | C/60.00 | -12.08 | B-→C | incomplete_crawl:+1 | low cov=22% blk=0% partial | 🚩 explain |
| https://jekyllrb.com/ | B/77.52 | B/77.35 | B/77.52 | +0.17 | same | orphan:-1, unreachable_page:-2 | high cov=92% blk=0% partial |  |
| https://text.npr.org/ | C/60 | C/60.00 | C/60.00 | +0.00 | same | — | low cov=4% blk=0% partial |  |
| https://lite.cnn.com/ | B/79.65 | B/79.65 | B/79.65 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://justinjackson.ca/ | A-/86.73 | A-/86.81 | A-/86.73 | -0.08 | same | deep_page:-1, over_optimized_anchor:-1 | medium cov=80% blk=2% partial |  |
| https://sive.rs/ | D/46.61 | D/46.61 | D/46.61 | +0.00 | same | unreachable_page:-5 | medium cov=81% blk=0% partial |  |
| https://web-scraping.dev/ | D/49.41 | D/49.06 | D/49.11 | +0.05 | same | orphan:-1, incomplete_crawl:+1 | low cov=54% blk=1% partial |  |
| https://www.scrapethissite.com/ | B-/73.69 | B-/73.10 | B-/73.69 | +0.59 | same | — | medium cov=89% blk=3% |  |
| https://dessinetonmeuble.fr/ | C/60 | — | — | n/a | n/a | — | — | ⛔ EXCLUDED (0 ok pages) |
| https://angielek.pl/ | B/77.38 | B/76.46 | C/60.00 | -16.46 | B→C | deep_page:-5, over_optimized_anchor:-21, incomplete_crawl:+1 | low cov=37% blk=46% partial | 🚩 explain |
| https://nodejs.org | C/60 | C+/67.46 | C/60.00 | -7.46 | C+→C | orphan:-84, incomplete_crawl:+1 | low cov=27% blk=0% partial | 🚩 explain |
| https://www.gnu.org | C-/58.76 | — | — | n/a | n/a | — | — | ⛔ EXCLUDED (Request timed out after 15000ms: https://www.gnu.org) |
| https://vuejs.org | D+/53.29 | C-/55.97 | C-/55.97 | +0.00 | same | unreachable_page:-5 | high cov=100% blk=0% |  |
| https://www.drupal.org | C/60 | A-/85.03 | C/60.00 | -25.03 | A-→C | unreachable_page:-3, incomplete_crawl:+1 | low cov=5% blk=0% partial | 🚩 explain |
| https://nextjs.org | C/60 | C+/69.70 | C/60.00 | -9.70 | C+→C | incomplete_crawl:+1 | low cov=47% blk=0% partial | 🚩 explain |
| https://www.wix.com | D/47.44 | D/47.45 | D/47.45 | +0.00 | same | unreachable_page:-1, incomplete_crawl:+1 | low cov=23% blk=0% partial |  |
| https://www.shopify.com | D/45.21 | F/38.74 | F/39.02 | +0.28 | same | orphan:-117, unreachable_page:-22, incomplete_crawl:+1 | low cov=3% blk=0% partial |  |
| https://www.joomla.org | C/64.64 | C/61.45 | C/60.00 | -1.45 | same | deep_page:-4, unreachable_page:-104, over_optimized_anchor:-4, incomplete_crawl:+1 | low cov=39% blk=1% partial |  |
| https://ghost.org | B/79.21 | C+/65.57 | C/60.00 | -5.57 | C+→C | unreachable_page:-85, incomplete_crawl:+1 | low cov=53% blk=0% partial | 🚩 explain |
| https://www.squarespace.com | C+/69.41 | B-/72.15 | C/60.00 | -12.15 | B-→C | unreachable_page:-34, incomplete_crawl:+1 | low cov=27% blk=0% partial | 🚩 explain |
| https://webflow.com | D-/40.49 | D-/40.48 | D-/40.48 | +0.00 | same | incomplete_crawl:+1 | low cov=14% blk=0% partial |  |
| https://wordpress.org | C/62.05 | D/46.06 | D/47.47 | +1.41 | same | orphan:-84, unreachable_page:-6, incomplete_crawl:+1 | low cov=2% blk=23% partial |  |
| https://jecoba.com/ | B-/70.13 | B-/70.13 | C/60.00 | -10.13 | B-→C | incomplete_crawl:+1 | low cov=79% blk=21% | 🚩 explain |
| https://en.books4.you/ | B-/70.07 | B/75.74 | C/60.00 | -15.74 | B→C | orphan:-1, over_optimized_anchor:-1, incomplete_crawl:+1 | low cov=10% blk=24% partial | 🚩 explain |
| https://en.books4.you/ | C/64.86 | B/78.33 | C/60.00 | -18.33 | B→C | orphan:-2, incomplete_crawl:+1 | low cov=9% blk=23% partial | 🚩 explain |
| https://www.nahlai.com/ | C/64.29 | C/60.00 | C/60.00 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://bitcoinsucker.net/ | B-/73.61 | B-/73.61 | B-/73.61 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://www.facebook.com/ | C/60 | C/60.00 | C/60.00 | +0.00 | same | — | low cov=5% blk=0% partial |  |
| https://travellerbd.wordpress.com/ | B/75.22 | C/60.56 | C/60.00 | -0.56 | same | unreachable_page:-86, incomplete_crawl:+1 | low cov=4% blk=0% partial |  |
| https://www.alynthe.com/ | C/60 | A-/88.00 | A-/88.00 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://books.toscrape.com | A/90.61 | A/90.44 | C/60.00 | -30.44 | A→C | incomplete_crawl:+1 | low cov=63% blk=0% partial | 🚩 explain |
| https://quotes.toscrape.com | B/76.09 | B/76.09 | B/76.09 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://www.vogue.com/ | C+/69.25 | D-/44.45 | D-/44.45 | +0.00 | same | unreachable_page:-79, incomplete_crawl:+1 | low cov=12% blk=0% partial |  |
| https://mrspringmrsfresh.com/ | C+/68.74 | C+/68.74 | C/60.00 | -8.74 | C+→C | incomplete_crawl:+1 | low cov=54% blk=23% | 🚩 explain |
| https://ddott.net/ | B/77.62 | B/75.65 | C/60.00 | -15.65 | B→C | incomplete_crawl:+1 | low cov=1% blk=0% partial | 🚩 explain |
| https://fever.wnba.com/ | B/78.13 | B+/81.49 | C/60.00 | -21.49 | B+→C | unreachable_page:-86, incomplete_crawl:+1 | low cov=37% blk=0% partial | 🚩 explain |
| https://www.eigenstate.co/ | C/61.94 | C/61.30 | C/62.18 | +0.88 | same | orphan:-1, unreachable_page:-1 | high cov=95% blk=3% partial |  |
| https://www.betonkemon.com/en | C/60 | — | — | n/a | n/a | — | — | ⛔ EXCLUDED (0 ok pages) |
| https://www.spicebox.ca/ | C+/68.1 | C+/67.90 | C/60.00 | -7.90 | C+→C | over_optimized_anchor:-20, incomplete_crawl:+1 | low cov=8% blk=74% partial | 🚩 explain |
| https://www.nahltech.com/ | B-/73.94 | B-/73.94 | B-/73.94 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://mumbaiplacenyc.com/ | C+/69.42 | C+/69.42 | C+/69.39 | -0.03 | same | — | medium cov=91% blk=9% |  |
| https://www.alynthe.com/ | C/60 | B+/80.00 | B+/80.00 | +0.00 | same | — | high cov=100% blk=0% |  |

**19** audit(s) with |Δscore| > 5 — each must be explained before the ENGINE_V2 flip (§8).
**3** excluded (logged above, not dropped). **33** partial (budget/cap-truncated crawl; the v1↔v2 diff is still valid).