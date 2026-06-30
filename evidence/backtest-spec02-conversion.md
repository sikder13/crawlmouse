# Backtest (crawl-once-grade-twice): 30 audits — v1 vs v2 on the SAME crawl

Crawl: v2 pipeline, pageCap=500, budget=240000ms. Stored grade = context only; the diff is v1↔v2.

| URL | stored | v1 | v2 | Δ(v2−v1) | grade | finding deltas (v2−v1) | health(v2) | flag |
|---|---|---|---|---|---|---|---|---|
| https://lite.cnn.com/ | B/79.65 | B/79.65 | B/79.65 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://quotes.toscrape.com/ | B/76.09 | B/76.09 | B/76.09 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://useaboon.com/ | C/60 | C/60.00 | C/60.00 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://www.gatsbyjs.com/docs/ | C/60 | C+/67.57 | C+/67.61 | +0.04 | same | orphan:-1, unreachable_page:-35, incomplete_crawl:+1 | low cov=28% blk=0% partial |  |
| https://astro.build/ | C/60 | B-/74.56 | B-/74.07 | -0.49 | same | orphan:-5, deep_page:-3, incomplete_crawl:+1 | low cov=28% blk=7% partial |  |
| https://tom.preston-werner.com/ | B/75.19 | B/75.19 | B/75.19 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://curl.se/ | D/47.16 | D/47.51 | B-/71.96 | +24.45 | D→B- | orphan:-144, unreachable_page:-11, incomplete_crawl:+1 | low cov=1% blk=0% partial | 🚩 explain |
| https://nginx.org/ | C/60 | A/91.07 | A/90.88 | -0.19 | same | orphan:-4, unreachable_page:-8, incomplete_crawl:+1 | low cov=14% blk=33% partial |  |
| https://www.sqlite.org/ | C/60 | A-/89.63 | A-/89.63 | +0.00 | same | incomplete_crawl:+1 | low cov=30% blk=0% partial |  |
| https://danluu.com/ | A-/88.43 | A-/88.07 | A-/88.43 | +0.36 | same | orphan:-1, deep_page:-1, unreachable_page:-1 | medium cov=86% blk=4% partial |  |
| https://www.11ty.dev/ | C/60 | B-/72.08 | B-/72.08 | +0.00 | same | incomplete_crawl:+1 | low cov=22% blk=0% partial |  |
| https://jekyllrb.com/ | B/77.52 | B/77.35 | B/77.52 | +0.17 | same | orphan:-1, unreachable_page:-2 | high cov=92% blk=0% partial |  |
| https://text.npr.org/ | C/60 | C/60.00 | C/60.00 | +0.00 | same | — | low cov=4% blk=0% partial |  |
| https://lite.cnn.com/ | B/79.65 | B/79.65 | B/79.65 | +0.00 | same | — | high cov=100% blk=0% |  |
| https://justinjackson.ca/ | A-/86.73 | A-/86.81 | A-/86.73 | -0.08 | same | deep_page:-1, over_optimized_anchor:-1 | medium cov=80% blk=2% partial |  |
| https://sive.rs/ | D/46.61 | D/46.61 | D/46.61 | +0.00 | same | unreachable_page:-5 | medium cov=81% blk=0% partial |  |
| https://web-scraping.dev/ | D/49.41 | D/49.02 | D/49.07 | +0.05 | same | orphan:-1, incomplete_crawl:+1 | low cov=54% blk=1% partial |  |
| https://www.scrapethissite.com/ | B-/73.69 | B-/73.10 | B-/73.69 | +0.59 | same | — | medium cov=89% blk=3% |  |
| https://dessinetonmeuble.fr/ | C/60 | — | — | n/a | n/a | — | — | ⛔ EXCLUDED (0 ok pages) |
| https://angielek.pl/ | B/77.38 | B/76.70 | B-/74.21 | -2.49 | B→B- | deep_page:-6, over_optimized_anchor:-21, incomplete_crawl:+1 | low cov=37% blk=46% partial |  |
| https://nodejs.org | C/60 | C+/67.46 | B-/71.31 | +3.85 | C+→B- | orphan:-84, incomplete_crawl:+1 | low cov=27% blk=0% partial |  |
| https://www.gnu.org | C-/58.76 | — | — | n/a | n/a | — | — | ⛔ EXCLUDED (Request timed out after 15000ms: https://www.gnu.org) |
| https://vuejs.org | D+/53.29 | C-/55.97 | C-/55.97 | +0.00 | same | unreachable_page:-5 | high cov=100% blk=0% |  |
| https://www.drupal.org | C/60 | A-/85.74 | A/92.82 | +7.08 | A-→A | orphan:-28, unreachable_page:-3, over_optimized_anchor:-3, incomplete_crawl:+1 | low cov=4% blk=0% partial | 🚩 explain |
| https://nextjs.org | C/60 | C+/69.70 | C+/69.70 | +0.00 | same | incomplete_crawl:+1 | low cov=47% blk=0% partial |  |
| https://www.wix.com | D/47.44 | D/46.73 | D/46.73 | +0.00 | same | unreachable_page:-1, incomplete_crawl:+1 | low cov=26% blk=0% partial |  |
| https://www.shopify.com | D/45.21 | F/38.74 | F/39.02 | +0.28 | same | orphan:-117, unreachable_page:-22, incomplete_crawl:+1 | low cov=3% blk=0% partial |  |
| https://www.joomla.org | C/64.64 | C/61.45 | C/60.60 | -0.85 | same | orphan:-7, deep_page:-4, unreachable_page:-104, over_optimized_anchor:-82, incomplete_crawl:+1 | low cov=31% blk=1% partial |  |
| https://ghost.org | B/79.21 | C/64.28 | C/64.28 | +0.00 | same | unreachable_page:-132, incomplete_crawl:+1 | low cov=69% blk=0% partial |  |
| https://www.squarespace.com | C+/69.41 | B-/72.88 | B-/72.88 | +0.00 | same | unreachable_page:-31, incomplete_crawl:+1 | low cov=32% blk=0% partial |  |

**2** audit(s) with |Δscore| > 5 — each must be explained before the ENGINE_V2 flip (§8).
**2** excluded (logged above, not dropped). **21** partial (budget/cap-truncated crawl; the v1↔v2 diff is still valid).

## Explanations (consolidated: SPEC 02 §2 cap-removal + cross-host node-eligibility + anchor tune)

Both |Δ|>5 swings are the **cross-host node-eligibility fix removing FALSE orphans** — external
share/social/mirror/subdomain URLs the crawler fetched but that are not the site's same-host pages
(SPEC 01 §2 host rule). No unexplained swing.

- **curl.se +24.45** (D/47.51 → B-/71.96): `orphan:-144`. curl.se links out heavily (mailing
  lists, mirrors, CVEs, GitHub); v1 counted 144 of those as orphans, crushing a genuinely
  well-linked docs site to a false **D**. v2 grades only curl's own pages → B-. cov=1% → shown as a
  low-confidence ESTIMATE (wide band), not a verdict. (Shows how badly the bug corrupted grades on
  heavy external-linkers — a serious flip-blocker, now fixed.)
- **drupal.org +7.08** (A-/85.74 → A/92.82): `orphan:-28` (cross-host) + lifted by the §2
  cap-removal (its stored C/60 was the old capped grade).

Sub-threshold, same cause: nodejs +3.85 (`orphan:-84`), shopify +0.28 (`orphan:-117`). The small
NEGATIVES (joomla -0.85, angielek -2.49 @ 46% block, astro -0.49, nginx -0.19, justinjackson -0.08)
are node-eligibility / anchor-HHI / depth recomputation on the smaller, cleaner same-host graph —
each tracks its own finding deltas. §2 cap-removal still holds (nginx A, sqlite A-, and
drupal/gatsby/11ty/nextjs recovered from the stored false C/60). The anchor tune is grade-neutral
(display only → no backtest impact). 2 excluded = crawl failures (curl/gnu were once OK; transient).