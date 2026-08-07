# The durable frontier — cut from SPEC 5.1a, carried to SPEC 06

**Owner ruling 2026-08-06.** Stage 5's wiring was built, gated, found defective, measured, and **cut
from 5.1a on evidence**. This is the single record. Nothing here is discarded — the migrations are
applied, the SQL is rehearsed, and the defect has a ruled fix waiting.

**Read this before wiring `packages/engine/src/analysis/frontier-checkpoint.ts`.** That module is
deliberately not exported from the package index.

---

## 1. Why it was cut: measured value is zero

**Zero of 234 production audits would have resumed rather than restarted.**

| failure | n | would the checkpoint have helped? |
|---|---|---|
| `links insert failed: canceling statement due to statement timeout` | 3 | **No — by construction.** A *persist* failure, which happens after `runCrawl` returned and `deleteAll()` already ran. The frontier is guaranteed empty. |
| `unable to get local issuer certificate` | 2 | No — TLS, before the crawl, deterministic; the retry re-fails identically |
| cert altname mismatch | 1 | No — same class |
| `Request timed out after 15000ms` | 1 | No — the 15s *homepage-fetch* timeout, before the crawl |

Also: 7 `pending` (never advanced to crawling ⇒ no rows) and **0 ever stuck at `crawling`** — no crawl
in the corpus has died mid-flight.

### The design constraint SPEC 06 must solve FIRST

```
crawler.ts:964   deleteAll()          <- the frontier is destroyed here
crawler.ts:975   return out
audit.ts:221     persistAuditResults  <- the 3 real failures happen HERE
```

**The checkpoint deletes its own recovery data immediately before the most common real failure point.**
That is not a bug to patch; it is inherent to persisting pages only at the end.
**Incremental page persistence is the prerequisite for resumability, not an optimisation.** Until pages
are durable as they are fetched, a frontier checkpoint cannot serve the failure that actually occurs.

Two further reasons it bought nothing today:

- **The scenario §8 names is unreachable.** "A timed-out crawl resumes" cannot happen: under v2 a
  budget-exhausted crawl returns *gracefully*, so `deleteAll()` runs; and the v1 wall-clock throw is
  wrapped `NonRetriableError`, so Inngest never retries it. Only crawls that failed for some *other*
  reason ever reach the resume path.
- **`claim` is behaviourally inert** in the single-worker shape production runs. A reviewer reduced it
  to a total no-op and the entire sweep produced byte-identical output. `crawler.ts:825` treated
  `discovered` and `claimed` identically, so the state was written and never read. It becomes
  meaningful only under multi-step continuation — which is SPEC 06.

---

## 2. B-1 — the defect the wiring shipped with, and its ruled fix

**A resumed crawl silently discarded every page the dead attempt fetched, while the fingerprint
certified the sample as identical.**

On resume, a row in `fetched|failed|skipped` was marked visited and charged against `pageCap`
(`crawler.ts:826-829`) — but the page *content* lived only in the dead process's in-memory `pages` map.
It was never re-fetched and never re-entered the output.

Measured end to end through `runAudit`:

```
STRAIGHT  grade=B+   score=80    pages=85  refused=false
RESUMED   grade=null score=null  pages=80  refused=true  triggers=["no_observed_links"]
          fingerprint digest IDENTICAL to the straight-through run
```

Worst case at cap 200: **5 of 85 pages delivered — 94% loss — with `budgetExhausted=false`**, so it
reported a *complete* crawl. Every vanished page took its outbound links with it, manufacturing orphans
for its children. Coverage was corrupted too (`estimateSource` `'none'` → `'frontier'`).

**This is §6.7's own diagnostic inverted** — *"identical digest + different grade is an ENGINE defect"* —
manufactured by our own code.

Reachable in production: `crawlAndPersist` rethrows every non-wall-clock error and `auditFn` has
`retries: 1`, so attempt 2 *is* the resume. Succeeding was worse than failing: it persisted a fragment
as a completed, graded audit.

### The ruled fix (owner, 2026-08-06) — option 3

**Keep `admitted` as the selection record, and re-fetch the already-admitted URLs to repopulate
`pages`.** This preserves B6 exactly (selection and cap accounting unchanged, so the digest still
matches) and returns a complete page set.

> **A RESUME SAVES THE SAMPLE, NOT THE FETCHES.**

The two rejected alternatives, and why:

- **Re-select from the full basis** — breaks B6. Round 1 would select from all 85 rather than from the
  seed, so the sample diverges from a straight-through crawl.
- **Persist pages incrementally** — genuinely makes fetched rows subtract from the work, and is the
  *correct long-term answer*, but it is a new persistence model. It is SPEC 06's actual first task
  (see §1).

---

## 3. The lesson

> **EXHAUSTIVE COVERAGE OF THE WRONG ASSERTION IS NOT COVERAGE.**

The acceptance sweep killed the crawl at **every reachable death point** — 35 deaths across three page
caps, exhaustive by construction, with an anti-vacuity floor on the death count. All 35 reported green.
**23 of those 35 delivered a wrong page set.**

The sweep compared `fingerprint.digest` and nothing else. The harness was right; the observable was
wrong. Adding one assertion — `expect(resumed.pages.length).toBe(straight.pages.length)` — turns 23 of
the 35 green rows red.

Being exhaustive over *death points* while shallow over *observables* reads as rigour and is not. When
a sweep enumerates its inputs completely, check just as hard that it enumerates what it **observes**.

Related, and found the same way: a test double that is **more capable than the real dependency** hides
the defect it was written to catch (`MemoryStore` implemented `least()`-on-depth and state preservation
while a PostgREST upsert could do neither). No test failure found either one.

---

## 4. What is applied, verified, and ready

**Four migrations, all applied to production and verified.** They are additive, RLS-closed and now
**empty by design** — not an oversight:

- `20260805000001` — `frontier` + `frontier_politeness` tables, four indexes. RLS on, **0 policies**,
  grants to `postgres`/`service_role` only.
- `20260806000001` — `claim_frontier`, `delete_orphan_frontier_rows`.
- `20260806000002` — `settle_frontier_batch`, `upsert_frontier_batch`.

All four functions, read from `pg_proc`: `SECURITY INVOKER`, `search_path` pinned, `EXECUTE` false for
anon and authenticated, true for service_role, ACL `{postgres=X/postgres,service_role=X/postgres}` with
**no PUBLIC entry**. Rehearsed against real PostgreSQL 17.10 (production is 17.6), including
`FOR UPDATE SKIP LOCKED` under two genuinely distinct backends.

**Why each is SQL and not a query-builder call** — PostgREST cannot express them, or cannot be tested
if it does:

- `claim_frontier` — `FOR UPDATE SKIP LOCKED` has no PostgREST grammar (verified against the installed
  `postgrest-js`). A conditional `UPDATE … WHERE state='discovered' RETURNING` **is** atomically
  disjoint under READ COMMITTED, but *blocks* where SKIP LOCKED *skips*, putting a lock wait in the
  claim path.
- `settle_frontier_batch` — must be one statement. Per-row settling let a worker die mid-round leaving
  some rows `fetched` and the rest `claimed`; released rows re-entered selection a round later against
  a larger pool, moving composition when the cap binds (**measured: 4–5 pages of 40, twice**).
- `upsert_frontier_batch` — PostgREST emits `SET col = excluded.col` per payload key, so a re-staged row
  carrying `state:'discovered'` would **reset** a `fetched` row. Lowers depth via `least()`, never names
  `state`.
- `delete_orphan_frontier_rows` — owns its cutoff *and* its clock so no caller can widen the predicate.

**The daily cron no longer calls the sweep.** Nothing writes frontier rows, so there is nothing to
sweep; the step was removed, which also disposed of an ordering bug (it ran *before* `delete-expired`,
and a step that exhausts its retries fails the function — so a frontier hiccup would have suspended the
30-day retention sweep, the opposite of what its comment claimed).

---

## 5. Everything else SPEC 06 inherits

**13 surviving mutations** — the shipped code that no test observed:

- `frontierCheckpointEnabled` → `return true` survived all 155 inngest tests. The dark-flag guarantee was pinned by nothing.
- `allDiscovered` returning after the first 1000-row page survived — the pagination the file's own comment calls load-bearing.
- The adapter's `sha256` → `md5` survived: every claim would have matched 0 rows, silently.
- `settleBatch` → no-op survived.
- Dropping `order by f.updated_at` from `delete_orphan_frontier_rows` survived — **and the plan assertion tests a hand-retyped copy of the query, not the shipped function.** Confirmed on real PG 17 that without it the plan becomes a Seq Scan over 20 000 rows. That is a second copy of the rule, the exact class the SQL move was made to avoid.
- Dropping the `audit_id` predicates from `claim_frontier` / `settle_frontier_batch` survived (behaviour is correct, but unasserted on 3 of 4 functions).
- Dropping `and f.state = 'discovered'` from `claim_frontier` survived — the twin of the settle whitelist, which only got a test *after* it survived a mutation.
- Dropping the `source` enum filter from the upsert survived, though the runbook lists it as a green behavioural check.
- `inngest/frontier-store.ts` (118 lines) had **zero test coverage** — and was the only frontier code that would execute in production.

**§8's politeness bullet is unimplemented.** `frontier_politeness` is created by the migration and
written by nothing; `restorePoliteness` is unwired. Stage 5 was incomplete against its own spec section.

**Two divergent resume models coexisted.** `resumeSelection` / `pendingAfterResume` / `claimOrder` were
exported and called by nothing; the wired crawler implemented the rule inline and differently.
`METHODOLOGY.md` then described the *unused* model. The exports are now removed so the v1.2 CLI cannot
adopt the wrong one.

**Deploy weight:** `embedded-postgres@17.10.0-beta.17` (+`pg`) was needed because PGlite cannot test
`SKIP LOCKED` — its "concurrent connections" are a multiplexer over one backend (both clients report the
same `pg_backend_pid`) and `EXPLAIN` is byte-identical with and without the clause. It is 59 MB and
Vercel installs devDependencies for the build, so it was removed with the rest. SPEC 06 will need it
back, scoped to the workspace that uses it.
