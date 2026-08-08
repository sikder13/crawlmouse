# `attempted` is never persisted, so approved refusal copy (e) cannot print its counts

**Filed** 2026-08-07, during the gate-4 fix pass on `engine/spec-5-1a`.
**Severity** medium — no falsehood is published; an approved sentence is silently omitted.
**Owner decision required.** Two of the three ways forward are not mine to take.

## What happens now

SPEC 5.1a approved body (e), for the `nothing_read` trigger, reads:

> Your server didn’t return a single page to us
> **N requests, M refused.** Nothing was read, so there is nothing to grade.
> How to check: … `curl -A "CrawlmouseBot/1.0" <origin>` reproduces what we saw …
> A 403/429 to us likely means AI crawlers are blocked too — GPTBot, ClaudeBot and the rest …

**The bold sentence never renders in production.** `refusalCopy` requires BOTH measurements and omits
the sentence when either is missing, and `attempted` is always missing.

## Why

`attempted` is computed by the engine (`crawl-health.ts` — same-host fetch attempts, `sitePages.length`)
and **no column stores it**. `persist-results.ts` writes `discovered_count`, `fetched_ok_count`,
`blocked_count`, `coverage_pct`, `block_rate`, `confidence`, `partial`. Not `attempted`.

It is not recoverable from what IS stored, and each near-miss is the exact defect class this spec
exists to delete:

| candidate | why it is not `attempted` |
|---|---|
| `page_count` | `crawlOut.pages.length` — every fetched page **including off-host redirects**; `attempted` is `sitePages.length`, same-host only |
| `fetched_ok_count + blocked_count` | omits `dead` (404/410/500/502…). On the measured B2 shape that is 0 vs the true 3 |
| `blocked_count / block_rate` | a number derived from two numbers that are not it, and undefined when `blocked = 0` |

## How it was found

Gate 4 / B2. `refusalCopy` read `crawl.discovered` and printed it as the request count. Measured end
to end through the shipped engine on a host serving 404 + full navigation: `attempted 3, discovered 8`
rendered **"8 requests, 0 refused"** underneath a headline saying the server refused us. Both halves
false, on the honesty screen. `discovered` is `fetched ∪ link targets` — it counts URLs we
deliberately never requested (robots-disallowed, trap-capped, cap-excluded, budget-stranded).

The fix stopped the falsehood by naming `attempted` as its own field and omitting the sentence when
it is null. That is correct and it is also a loss: the screen now carries the how-to-check and the
AI-crawler connection without the counts.

## The three ways forward

1. **Persist it** — additive nullable `audits.attempted_count integer`, written from `ch.attempted`
   in the same spread as its siblings. Restores the approved sentence unchanged, no copy decision.
   **Needs an owner-applied migration** (and a runbook, per the standing rule).
2. **Approve a one-number body** — e.g. *"47 requests were refused."*, true from `blocked_count`
   alone and needing no total. Drafted and then reverted during the fix pass: **the five bodies are
   owner-approved and a surface inventing a sixth is how a copy set starts drifting.** Needs the
   owner's approval, not an engineer's judgement.
3. **Leave it omitted.** Honest, costs the counts, and leaves `blocked_count` / `discovered_count`
   travelling to the client for nothing.

## Carried state

`REFUSAL_COUNT_COLS` (`lib/audit-columns.ts`) keeps both columns SELECTED and pinned by test even
though nothing renders them, because dropping them is invisible today and would re-break the sentence
the day option 1 lands — the shape of gate 4's W1, a mutation that survived the entire suite.
