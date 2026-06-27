# Backtest (crawl-once-grade-twice): 32 audits — v1 vs v2 on the SAME crawl

Crawl: v2 pipeline, pageCap=500, budget=120000ms. Stored grade = context only; the diff is v1↔v2.

| URL | stored | v1 | v2 | Δ(v2−v1) | grade | finding deltas (v2−v1) | health(v2) | flag |
|---|---|---|---|---|---|---|---|---|
| https://nodejs.org | C/60 | B-/71.33 | C/60.00 | -11.33 | B-→C | incomplete_crawl:+1 | low cov=28% blk=0% partial | 🚩 explain |
| https://www.gnu.org | C-/58.76 | D/49.89 | C-/56.88 | +6.99 | D→C- | orphan:-41, unreachable_page:-4, incomplete_crawl:+1 | low cov=5% blk=0% partial | 🚩 explain |
| https://vuejs.org | D+/53.29 | C-/55.97 | C-/55.97 | +0.00 | same | unreachable_page:-5 | high cov=100% blk=0% |  |
| https://www.drupal.org | C/60 | C+/68.50 | C/60.00 | -8.50 | C+→C | incomplete_crawl:+1 | low cov=15% blk=0% partial | 🚩 explain |
| https://nextjs.org | C/60 | C+/69.99 | C/60.00 | -9.99 | C+→C | over_optimized_anchor:-21, incomplete_crawl:+1 | low cov=45% blk=6% partial | 🚩 explain |
| https://www.wix.com | D/47.44 | D/49.20 | D/49.20 | +0.00 | same | unreachable_page:-1, incomplete_crawl:+1 | low cov=17% blk=0% partial |  |
| https://www.shopify.com | D/45.21 | D-/40.16 | D-/40.51 | +0.35 | same | orphan:-116, unreachable_page:-13, incomplete_crawl:+1 | low cov=8% blk=1% partial |  |
| https://www.joomla.org | C/64.64 | C/64.90 | C/64.70 | -0.20 | same | deep_page:-4, unreachable_page:-29, over_optimized_anchor:-2 | medium cov=78% blk=1% partial |  |
| https://ghost.org | B/79.21 | C/64.75 | C/60.00 | -4.75 | same | unreachable_page:-138, incomplete_crawl:+1 | low cov=69% blk=0% partial |  |
| https://www.squarespace.com | C+/69.41 | B-/73.99 | C/60.00 | -13.99 | B-→C | unreachable_page:-29, incomplete_crawl:+1 | low cov=40% blk=0% partial | 🚩 explain |
| https://webflow.com | D-/40.49 | D-/40.59 | D-/40.59 | +0.00 | same | incomplete_crawl:+1 | low cov=14% blk=0% partial |  |
| https://wordpress.org | C/62.05 | D/47.84 | D+/50.97 | +3.13 | D→D+ | orphan:-84, unreachable_page:-4, incomplete_crawl:+1 | low cov=2% blk=32% partial |  |
| https://jecoba.com/ | B-/70.13 | B-/70.13 | C/60.00 | -10.13 | B-→C | incomplete_crawl:+1 | low cov=79% blk=21% | 🚩 explain |
| https://en.books4.you/ | B-/70.07 | B-/74.30 | C/60.00 | -14.30 | B-→C | orphan:-1, over_optimized_anchor:-1, incomplete_crawl:+1 | low cov=9% blk=32% partial | 🚩 explain |
| https://en.books4.you/ | C/64.86 | B/78.97 | C/60.00 | -18.97 | B→C | incomplete_crawl:+1 | low cov=10% blk=8% partial | 🚩 explain |
| https://www.nahlai.com/ | C/64.29 | C+/69.65 | C/60.00 | -9.65 | C+→C | orphan:-3, unreachable_page:-4, over_optimized_anchor:-2, incomplete_crawl:+1 | low cov=41% blk=45% | 🚩 explain |
| https://bitcoinsucker.net/ | B-/73.61 | B-/73.61 | B-/73.61 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://www.facebook.com/ | C/60 | C/60.00 | C/60.00 | +0.00 | same | — | low cov=5% blk=0% partial |  |
| https://travellerbd.wordpress.com/ | B/75.22 | B-/74.80 | C/60.00 | -14.80 | B-→C | incomplete_crawl:+1 | low cov=42% blk=0% partial | 🚩 explain |
| https://www.alynthe.com/ | C/60 | A-/88.00 | A-/88.00 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://books.toscrape.com | A/90.61 | A/90.61 | C/60.00 | -30.61 | A→C | incomplete_crawl:+1 | low cov=63% blk=0% partial | 🚩 explain |
| https://quotes.toscrape.com | B/76.09 | B/76.09 | B/76.09 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://www.vogue.com/ | C+/69.25 | D/46.83 | D/46.83 | +0.00 | same | unreachable_page:-79, incomplete_crawl:+1 | low cov=12% blk=0% partial |  |
| https://mrspringmrsfresh.com/ | C+/68.74 | C+/68.74 | C/60.00 | -8.74 | C+→C | incomplete_crawl:+1 | low cov=54% blk=23% | 🚩 explain |
| https://ddott.net/ | B/77.62 | B/75.65 | C/60.00 | -15.65 | B→C | incomplete_crawl:+1 | low cov=1% blk=0% partial | 🚩 explain |
| https://fever.wnba.com/ | B/78.13 | B+/82.63 | C/60.00 | -22.63 | B+→C | unreachable_page:-59, incomplete_crawl:+1 | low cov=40% blk=0% partial | 🚩 explain |
| https://www.eigenstate.co/ | C/61.94 | C/62.18 | C/63.12 | +0.94 | same | orphan:-1, unreachable_page:-1 | high cov=94% blk=3% partial |  |
| https://www.betonkemon.com/en | C/60 | — | — | n/a | n/a | — | — | ⛔ EXCLUDED (0 ok pages) |
| https://www.spicebox.ca/ | C+/68.1 | C/60.00 | C/60.00 | +0.00 | same | — | low cov=2% blk=0% partial |  |
| https://www.nahltech.com/ | B-/73.94 | B-/73.94 | B-/73.94 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://mumbaiplacenyc.com/ | C+/69.42 | C+/69.42 | C+/69.39 | -0.03 | same | — | medium cov=91% blk=9% |  |
| https://www.alynthe.com/ | C/60 | B+/80.00 | B+/80.00 | +0.00 | same | — | high cov=100% blk=0% |  |

**14** audit(s) with |Δscore| > 5 — each must be explained before the ENGINE_V2 flip (§8).
**1** excluded (logged above, not dropped). **21** partial (budget/cap-truncated crawl; the v1↔v2 diff is still valid).