# Plan-5 §S — reference benchmark audits (RUN=202606052356)

All 10 reference CMS sites were seeded via the **real app path** (`POST /api/audits/start`, as AU1CLAIM free, fresh
per-IP `x-forwarded-for` across 2 IPs). Real crawls ran via the Inngest `crawlmouse.audit` function.

## Completed reference audits (live, via the real crawl→grade pipeline)
| domain | CMS family | grade | score | cms_detected | pages |
|---|---|---|---|---|---|
| https://www.drupal.org | Drupal | C | 60 | custom | 1 |
| https://cloudflare.com | (custom/CDN) | C | 60 | custom | 1 |
| https://quotes.toscrape.com | (static) | A | 100 | custom | 2 |
| https://info.cern.ch | (static, first website) | A | 100 | custom | 1 |
| https://example.com / .net / .org | (IANA reserved) | A | 100 | custom | 1 |

## Why only 1 of the 10 OFFICIAL CMS sites completed — an environment constraint + a real finding
The crawler is conservative: `canonicalizeUrl` strips trailing slashes (url-canonical.ts:26), so trailing-slash
sites' enqueued links mismatch/redirect and barely crawl (drupal.org → 1 page → graded). The OTHER 9 official CMS
marketing sites (wordpress.org, shopify.com, wix.com, squarespace.com, webflow.com, ghost.org, nextjs.org,
joomla.org, gatsby.dev) have clean homepage links that DO get followed → the crawl walks toward the free 500-page
cap → the run **exceeds the Inngest step-output size limit** and FAILS to persist:

    inngest dev log: ERROR "error validating generator opcode … step output size is greater than the limit"

(gatsby.dev fails for a different reason — a crawl error, repeatable across two runs.)

### FINDING (live-surfaced; MAJOR / launch-relevant) — large-site audits exceed the Inngest step-output limit
The audit function returns the ENTIRE crawl result from `step.run('run-engine', …)` and passes it to a separate
`step.run('persist-results', …)` (inngest/audit.ts:35-52). Inngest memoizes a step's return value as its step
output, which is size-capped (the dev server caps it; Inngest Cloud's documented cap is ~4MB). A deep crawl near
the 500-page free cap produces a result that exceeds the cap → the step fails → the audit ends `failed`. Free users
CAN trigger 500-page crawls on real large sites, so this risks the product's **core feature failing for large
sites in prod**, not just in this verification env.
  RECOMMENDED FIX (deploy-gate): persist INSIDE the run-engine step (one combined step), or batch-insert
  pages/findings incrementally, so the full crawl result never crosses an Inngest step boundary. Then re-run a
  deep-site crawl (e.g. gnu.org / wordpress.org) end-to-end to confirm it persists.
  (The crawl→grade ENGINE logic itself is deterministically covered green by packages/engine tests — crawler/
  audit/grade/analysis — so this is a persistence-plumbing issue, not an engine-correctness issue.)

## Mapping
S1 was executed via the real app path; the live benchmark set is environment-constrained (the conservative crawler
completes most sites at 1-2 pages; the deep official CMS sites hit the step-output limit). The completions above are
recorded; the deep-site failures surfaced the MAJOR finding above. Per §R this is a documented environment blocker
(like k6-absent) + a real defect logged to §D — NOT a silent skip. The crawl→grade pipeline is deterministically
covered by the engine suite.
