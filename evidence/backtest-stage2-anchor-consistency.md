# Backtest (base vs head engine): 4 sites

Mode: `ab`. Crawl: pageCap=500, budget=120000ms. Base engine: `/home/udsik/nahl-clients-projects/crawlmouse-base/packages/engine/src/index.ts`.

**Composition** is the HTTP-200 fetched-URL set. `identical` means the two crawls reached exactly the same pages,
so any grade delta beside it is attributable to the ENGINE and nothing else.

| URL | base | head | Δ(head−base) | grade | composition (base→head) | finding deltas | health(head) | flag |
|---|---|---|---|---|---|---|---|---|
| https://racedays.run/ | B+/80.32 | B+/81.58 | +1.26 | same | 419→419 identical | orphan:-1, over_optimized_anchor:-33 | low cov=13% blk=0% partial |  |
| https://defaultoffice.com/ | B-/70.61 | B-/70.61 | +0.00 | same | 15→15 identical | — | high cov=100% blk=0% |  |
| https://quotes.toscrape.com/ | B/76.09 | B/79.31 | +3.22 | same | 214→214 identical | deep_page:-35, over_optimized_anchor:-168 | high cov=100% blk=0% |  |
| https://info.cern.ch | A-/87.04 | A-/87.39 | +0.35 | same | 123→123 identical | over_optimized_anchor:-9 | low cov=26% blk=0% partial |  |

**0** site(s) with |Δscore| > 5 — each must be explained before merge (SPEC 5.1 §10).
**0** site(s) where the fetched-page set changed (an explained input change; the moved URLs are named in the row).
**3** site(s) where the grade moved on an IDENTICAL sample — that is an engine change, and the only kind that needs no crawl caveat.
**0** excluded (logged above, never silently dropped).