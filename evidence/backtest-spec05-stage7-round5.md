# Backtest (crawl-once-grade-twice): 30 audits — v1 vs v2 on the SAME crawl

Crawl: v2 pipeline, pageCap=500, budget=240000ms. Stored grade = context only; the diff is v1↔v2.

| URL | stored | v1 | v2 | Δ(v2−v1) | grade | finding deltas (v2−v1) | health(v2) | flag |
|---|---|---|---|---|---|---|---|---|
| https://resumematchapp.com/ | C/60 | C/60.00 | C/60.00 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://pageforge.pro/ | B-/71.22 | C+/68.17 | B-/70.68 | +2.51 | C+→B- | unreachable_page:-25, over_optimized_anchor:-5, incomplete_crawl:+1 | low cov=11% blk=16% partial |  |
| https://grandprixpicks.com/ | B+/80.45 | B+/80.39 | B+/80.45 | +0.06 | same | — | medium cov=78% blk=0% partial |  |
| https://celebratepaparazzi.com/ | D+/53.4 | D+/51.37 | D+/51.37 | +0.00 | same | incomplete_crawl:+1 | low cov=61% blk=0% partial |  |
| https://masterhomedecor.com/ | B+/82.99 | B+/82.64 | B+/82.83 | +0.19 | same | unreachable_page:-3, over_optimized_anchor:-3, incomplete_crawl:+1 | low cov=61% blk=23% partial |  |
| https://demodashboardrice.freedev.app/?i=1%20%20link%20testing%20dashboard | C/60 | C/60.00 | C/60.00 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://sibnetworks.com/ | C/60.55 | C/60.55 | C/60.55 | +0.00 | same | unreachable_page:-4 | high cov=97% blk=0% partial |  |
| https://heyzine.com/ | B+/81.89 | B+/81.89 | B+/81.89 | +0.00 | same | unreachable_page:-2 | high cov=99% blk=0% partial |  |
| https://flagcrack.com/ | B-/73.57 | B/75.89 | B/75.89 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://unntak.no/ | C+/68.72 | C+/69.39 | C+/68.72 | -0.67 | same | over_optimized_anchor:-1 | high cov=91% blk=0% |  |
| https://racedays.run/ | B+/80.32 | B+/80.32 | B+/80.32 | +0.00 | same | unreachable_page:-1, incomplete_crawl:+1 | low cov=13% blk=0% partial |  |
| https://rvflushguide.com/ | B+/80.91 | B+/81.67 | B+/80.91 | -0.76 | same | over_optimized_anchor:-1 | medium cov=89% blk=0% partial |  |
| https://joudresidenc.com/ | B-/70.37 | B-/70.37 | B-/70.37 | +0.00 | same | — | high cov=96% blk=0% partial |  |
| https://www.synergyairsystems.com/ | B/76.2 | B/76.09 | B/76.09 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://brandremaster.com/ | C-/59.34 | C/62.91 | C/62.80 | -0.11 | same | unreachable_page:-7, over_optimized_anchor:-2, incomplete_crawl:+1 | low cov=41% blk=2% partial |  |
| https://baazii.com/ | C/60 | C/60.00 | C/60.00 | +0.00 | same | — | medium cov=80% blk=0% partial |  |
| https://qudeltastudios.com/ | B-/70.32 | B-/70.32 | B-/70.32 | +0.00 | same | unreachable_page:-9 | high cov=100% blk=0% |  |
| https://leetcode.com/ | C/60 | D-/40.72 | D-/40.72 | +0.00 | same | incomplete_crawl:+1 | low cov=98% blk=0% partial |  |
| https://www.figma.com/resource-library/what-is-wireframing/ | C+/69.86 | B-/70.84 | B-/70.84 | +0.00 | same | unreachable_page:-7, incomplete_crawl:+1 | low cov=15% blk=0% partial |  |
| https://www.villa-apartamente.com/ | C/60 | C/60.00 | C/60.00 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://www.runam.space/Dashboard | C/60 | C/60.00 | C/60.00 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://www.runam.space/ | C/60 | C/60.00 | C/60.00 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://www.runam.space/ | C/60 | C/60.00 | C/60.00 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://axolutions.com.br/ | B+/81.33 | B+/81.33 | B+/81.33 | +0.00 | same | — | high cov=98% blk=0% partial |  |
| https://axolutions.com.br/ | B+/82.29 | B+/81.33 | B+/81.33 | +0.00 | same | — | high cov=98% blk=0% partial |  |
| https://mohammadalinijhoom.com | C/62.87 | C+/65.51 | C+/65.51 | +0.00 | same | incomplete_crawl:+1 | low cov=47% blk=0% partial |  |
| https://alynthe.com | A-/88 | B+/80.00 | B+/80.00 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://quotes.toscrape.com | B/76.09 | B/76.09 | B/76.09 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://getcastle.com/ | C+/65.59 | C+/65.59 | C+/65.59 | +0.00 | same | unreachable_page:-8, incomplete_crawl:+1 | low cov=55% blk=0% partial |  |
| https://valcirxaves.com/ | C/60 | C/60.00 | C/60.00 | +0.00 | same | — | high cov=100% blk=0% |  |

**0** audit(s) with |Δscore| > 5 — each must be explained before the ENGINE_V2 flip (§8).
**0** excluded (logged above, not dropped). **17** partial (budget/cap-truncated crawl; the v1↔v2 diff is still valid).