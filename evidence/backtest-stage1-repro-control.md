# Backtest (reproducibility: the same engine twice): 2 sites

Mode: `repro`. Crawl: pageCap=500, budget=120000ms. Both sides are the SAME engine — a difference is drift or a determinism defect.

**Composition** is the HTTP-200 fetched-URL set. `identical` means the two crawls reached exactly the same pages,
so any grade delta beside it is attributable to the ENGINE and nothing else.

| URL | base | head | Δ(head−base) | grade | composition (base→head) | finding deltas | health(head) | flag |
|---|---|---|---|---|---|---|---|---|
| https://mohammadalinijhoom.com/ | C/63.43 | C/61.54 | -1.89 | same | 65→80 −0/+15 (/dashboard /data-collect /decision-control /decision-manipulation, +11 more) | orphan:+10 | low cov=39% blk=0% partial |  |
| https://mohammadalinijhoom.com/ | C/62.25 | C/63.24 | +0.99 | same | 91→97 −0/+6 (/everyone-has-something-to-share /expense-track /expenses /fair-advantage, +2 more) | orphan:+1 | low cov=45% blk=0% partial |  |

**0** site(s) with |Δscore| > 5 — each must be explained before merge (SPEC 5.1 §10).
**2** site(s) where the fetched-page set changed (an explained input change; the moved URLs are named in the row).
**0** site(s) where the grade moved on an IDENTICAL sample — that is an engine change, and the only kind that needs no crawl caveat.
**0** excluded (logged above, never silently dropped).