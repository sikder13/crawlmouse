# Backtest (crawl-once-grade-twice): 30 audits — v1 vs v2 on the SAME crawl

Crawl: v2 pipeline, pageCap=500, budget=240000ms. Stored grade = context only; the diff is v1↔v2.

| URL | stored | v1 | v2 | Δ(v2−v1) | grade | finding deltas (v2−v1) | health(v2) | flag |
|---|---|---|---|---|---|---|---|---|
| https://lite.cnn.com/ | B/79.52 | B/79.59 | B/79.52 | -0.07 | same | — | high cov=99% blk=1% |  |
| https://tom.preston-werner.com/ | B/75.19 | B/75.19 | B/75.19 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://fb.com/ | C/60 | C/60.00 | C/60.00 | +0.00 | same | — | low cov=5% blk=0% partial |  |
| https://www.gov.nl.ca/eccc/ | B-/72.25 | C+/69.78 | B-/72.41 | +2.63 | C+→B- | orphan:-18, unreachable_page:-35, incomplete_crawl:+1 | low cov=5% blk=0% partial |  |
| https://www.crawlmouse.com/ | B+/80.13 | B/77.64 | B/77.64 | +0.00 | same | incomplete_crawl:+1 | low cov=59% blk=0% partial |  |
| https://www.mumbaiplacenyc.com/ | C+/69.39 | C+/69.39 | C+/69.39 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://quotes.toscrape.com/ | B/76.09 | B/76.09 | B/76.09 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://www.alynthe.com/ | A-/88 | A-/88.00 | A-/88.00 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://mohammadalinijhoom.com/ | B-/73.92 | C+/66.04 | C+/66.04 | +0.00 | same | incomplete_crawl:+1 | low cov=47% blk=0% partial |  |
| https://quotes.toscrape.com/ | B/76.09 | B/76.09 | B/76.09 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://example.com | C/60 | C/60.00 | C/60.00 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://lite.cnn.com/ | B/79.65 | B/79.59 | B/79.52 | -0.07 | same | — | high cov=99% blk=1% |  |
| https://quotes.toscrape.com/ | B/76.09 | B/76.09 | B/76.09 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://useaboon.com/ | C/60 | C/60.00 | C/60.00 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://www.gatsbyjs.com/docs/ | C/60 | C+/67.61 | C+/67.61 | +0.00 | same | unreachable_page:-35, incomplete_crawl:+1 | low cov=33% blk=0% partial |  |
| https://astro.build/ | C/60 | B-/74.05 | B-/74.09 | +0.04 | same | deep_page:-3, incomplete_crawl:+1 | low cov=38% blk=0% partial |  |
| https://tom.preston-werner.com/ | B/75.19 | B/75.19 | B/75.19 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://curl.se/ | D/47.16 | B-/71.97 | B-/71.96 | -0.01 | same | incomplete_crawl:+1 | low cov=2% blk=0% partial |  |
| https://nginx.org/ | C/60 | A/90.28 | A/90.89 | +0.61 | same | orphan:-4, unreachable_page:-48, incomplete_crawl:+1 | low cov=23% blk=25% partial |  |
| https://www.sqlite.org/ | C/60 | A-/89.71 | A-/89.71 | +0.00 | same | incomplete_crawl:+1 | low cov=30% blk=0% partial |  |
| https://danluu.com/ | A-/88.43 | A-/87.14 | A-/87.49 | +0.35 | same | orphan:-1, deep_page:-1, unreachable_page:-1 | high cov=91% blk=0% partial |  |
| https://www.11ty.dev/ | C/60 | B-/71.83 | B-/71.83 | +0.00 | same | incomplete_crawl:+1 | low cov=20% blk=0% partial |  |
| https://jekyllrb.com/ | B/77.52 | B/77.35 | B/77.52 | +0.17 | same | orphan:-1, unreachable_page:-2 | high cov=92% blk=0% partial |  |
| https://text.npr.org/ | C/60 | C/60.00 | C/60.00 | +0.00 | same | — | low cov=4% blk=0% partial |  |
| https://lite.cnn.com/ | B/79.65 | B/79.59 | B/79.52 | -0.07 | same | — | high cov=99% blk=1% |  |
| https://justinjackson.ca/ | A-/86.73 | A-/86.49 | A-/86.41 | -0.08 | same | over_optimized_anchor:-1 | medium cov=83% blk=0% partial |  |
| https://sive.rs/ | D/46.61 | D/46.61 | D/46.61 | +0.00 | same | unreachable_page:-5 | medium cov=81% blk=0% partial |  |
| https://web-scraping.dev/ | D/49.41 | D+/50.31 | D+/50.38 | +0.07 | same | orphan:-1, incomplete_crawl:+1 | low cov=51% blk=1% partial |  |
| https://www.scrapethissite.com/ | B-/73.69 | B-/73.10 | B-/73.69 | +0.59 | same | — | medium cov=89% blk=3% |  |
| https://dessinetonmeuble.fr/ | C/60 | — | — | n/a | n/a | — | — | ⛔ EXCLUDED (0 ok pages) |

**0** audit(s) with |Δscore| > 5 — each must be explained before the ENGINE_V2 flip (§8).
**1** excluded (logged above, not dropped). **16** partial (budget/cap-truncated crawl; the v1↔v2 diff is still valid).