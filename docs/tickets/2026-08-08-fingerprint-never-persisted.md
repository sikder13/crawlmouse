# `fingerprint` is computed by the crawler and dropped before persistence

**Filed:** 2026-08-08 · **Source:** B17 post-merge live sample · **Severity:** medium (no user-visible
behaviour; §6.7's artifact does not exist) · **Status:** open

## The defect

**0 of 231 production audits have a non-null `fingerprint`** — including fresh 5.1a audits whose
`refusal` and `coverage` both persisted correctly.

Traced end to end:

| stage | state |
|---|---|
| `packages/engine/src/crawler.ts:832` | `budgetHitFingerprint()` builds it; `:849` sets `out.fingerprint` | ✅ |
| `packages/engine/src/audit.ts` | **zero occurrences of `fingerprint`.** `analyzeCrawl` never reads `crawlOut.fingerprint`; the `AuditResult` it returns (`:702`) has no such field | ❌ |
| `inngest/audit.ts:197` | hands that result to `persistAuditResults` | — |
| `inngest/persist-results.ts:182` | `...(result.fingerprint ? { fingerprint: boundFingerprintForPersist(...) } : {})` → **always false** | ❌ |

Every other piece exists: the column, migration `20260804000001`, `boundFingerprintForPersist`, the
`FINGERPRINT_PERSIST_MAX_STRATA` bound, the persist branch, and the stage-4 runbook §4c verification
step — which can therefore never pass.

## Why it was not caught

The unit tests cover `fingerprintFor` and `boundFingerprintForPersist` in isolation, and the persist
tests supply a `fingerprint` on the input object directly. **Nothing asserts that `analyzeCrawl`'s
output carries one**, so the missing propagation sits in the gap between two well-tested halves — the
same shape as the gate-7 finding that `AuditView.tsx` was in no test at all.

## The fix

Propagate it: read `crawlOut.fingerprint` in `analyzeCrawl` and include it on the returned
`AuditResult` (adding the field to the type). Then assert it end to end — an `analyzeCrawl` test whose
crawl output carries a fingerprint and whose result must too.

## Consequence while open

§6.7's artifact — the discovered-URL-set fingerprint intended to separate "the site changed" from
"the crawl sampled differently", the open question `evidence/2026-08-07-…racedays…` was retired over —
does not exist for any audit. Reproducibility attribution cannot use it until this lands.

## Related

- `evidence/2026-08-08-post-merge-b17-live-sample.md` — BLOCKER 2.
- `docs/deploy/spec51a-stage4-migration-runbook.md` §4c — the verification step that cannot pass.
