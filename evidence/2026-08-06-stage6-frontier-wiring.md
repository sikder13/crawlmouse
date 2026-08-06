# SPEC 5.1a Stage 6 — wiring the durable frontier, and what the wiring found

Captured 2026-08-06. Everything below was measured; nothing is projected.

---

## 1. The lesson: a test double that is MORE CAPABLE than the real dependency hides the defect it was written to catch

The wired crawl had six green tests. They were green because the in-memory `MemoryStore` implemented
`least()`-on-depth and preserved a row's state on re-discovery — **and the deployed path could do
neither.** The worker reaches Postgres through supabase-js, and a PostgREST upsert emits
`SET col = excluded.col` for every key in the payload; the engine's frontier record carries
`state: 'discovered'`, so re-staging a row that had already reached `fetched` would have **reset it**.
The double was not modelling the deployed path. It was modelling the path we would have written.

**No test failure found this.** It was found by asking what PostgREST actually emits. That is the SPEC 05
"passes against a stub, proves nothing about the deployed path" class in a new costume, and the costume is
what makes it dangerous: a stub that is obviously impoverished invites suspicion, while a double that is
*better* than the real thing reads as a clean implementation.

The remedy is the same one this project keeps arriving at: **move the rule to where the test executes it
for real.** `upsert_frontier_batch` now lowers depth via `least()` and never names `state`, and the
integration test runs that SQL against a real PostgreSQL. `MemoryStore` was then rewritten to be a
*faithful* double rather than a better one — its update path copies the previous row and replaces `depth`
alone, so there is no expression through which it could reset a settled row even by accident.

Re-running the full sweep and all eight crawler mutations after that rewrite changed **no test's
outcome**, which is the honest result and worth stating precisely: the double was never wrong about the
*algorithm*, only about the *dependency*. Under the rejected alternative — omitting `state` from the
payload and trusting PostgREST's SET-list construction — all six would have stayed green against an
implementation that resets state, with nothing local able to execute the difference.

## 2. Where the divergence actually was: a partially-settled round, not "mid-round"

Predicted: mid-round interruption diverges when the page cap binds. Measured, on an 85-page
four-template fixture:

| scenario | deaths | result |
|---|---|---|
| kill at a round boundary (`claim`, child-upsert) | 10 | identical digest |
| mid-round, page cap NOT binding (cap 200) | 12 | identical digest, `discovered=85 selected=85` |
| mid-round, page cap BINDING (cap 40) | 10 | **2 diverged**, both at `settle` |

The two divergences: digest `11f5f602ca46` against `91b875ac550f`, page overlap 36/40 and 35/40 — **4–5
pages of 40 replaced at a constant selected count of 40.** The page count holds while the sample moves,
which is the E1 signature in miniature.

The mechanism is narrower than the prediction. Only `settle` produced it, because settling ran as 25
independent single-row writes: a death partway through left some rows `fetched` and the rest `claimed`,
and the released rows re-entered selection a round later against a pool already grown by their siblings'
children — so the §6 quotas balanced across a different set.

A death strictly *inside* the fetch is not reachable through the store hooks, but it leaves the **same
persisted state** as a `claim` kill (whole batch claimed, nothing settled, no children persisted), and a
resume is a function of persisted state rather than of how that state was reached. All 10 kills reaching
that state matched.

**After making the settle atomic**, an exhaustive sweep — every hook, every call index `0..n-1`, three
caps — produced **35 deaths, 0 divergences.**

## 3. Two blockers found by asking what the transport can express

Both were found the same way, and neither by a failing test.

**`FOR UPDATE SKIP LOCKED` is not expressible in PostgREST.** Verified against the installed
`postgrest-js`: no `for update`, no `skip locked`, no `forUpdate`. The repo already contained the
precedent and the argument — `20260601000008_embed_view_increment.sql` exists because "a SQL function is
the only way to express `col = col + 1` atomically via PostgREST."

A conditional `UPDATE ... WHERE state='discovered' RETURNING` was measured and **is** atomically disjoint
under READ COMMITTED. It was rejected on the difference rather than the similarity: SKIP LOCKED *skips* a
locked row, a conditional UPDATE *blocks* on it, which puts a lock wait into the claim path at
`INNGEST_AUDIT_CONCURRENCY = 5`.

**PGlite cannot prove SKIP LOCKED**, measured two ways: `pglite-socket`'s "concurrent connections" are a
multiplexer over one backend — both clients reported `pg_backend_pid = 42`, and the second query then
deadlocked behind the first's open transaction — and `EXPLAIN` output is **byte-identical** with and
without the clause, so the `LockRows` node cannot be asserted on either. That left only prose-matching
`pg_get_functiondef`, which this project rejects. `embedded-postgres` (real server, user process, no
docker, no root, pinned to the 17 line because production is 17.6) gives two real backends:

```
backend pids 1184110 / 1184111 -> DISTINCT
w1 claimed (uncommitted): h0,h1,h2
w2 claimed concurrently:  h3,h4,h5 in 5ms      OVERLAP: NONE
w2 WITHOUT skip locked:   still blocked after 1000ms
```

## 4. Three independent confirmations of the production post-state

The Stage 5 schema was verified from three directions that did not share a method: the owner's own
post-apply check; applying the migration file into PGlite and comparing the index set
(`frontier_audit_state_idx`, `frontier_pkey`, `frontier_politeness_pkey`, `frontier_updated_at_idx` —
exact match); and a live catalog read showing RLS on, **0 policies**, grants to `postgres` and
`service_role` only on both tables.

## 5. Mutation results

Crawler wiring — harness liveness proven with an unconditional throw first:

| mutation | outcome |
|---|---|
| unconditional throw (liveness) | 6 failed |
| **per-row settle** | **1 failed — the exhaustive sweep, and nothing else** |
| `claimed` counted as consumed | 3 failed |
| basis shrunk to unconsumed rows | 2 failed |
| remove delete-at-completion | 1 failed |
| drop step-1 upsert | 1 failed |
| drop the claim | 4 failed |
| children never persisted | 2 failed |

SQL functions, mutating the migration files the integration test applies:

| mutation | outcome |
|---|---|
| remove `SKIP LOCKED` | 1 failed |
| widen sweep predicate 24h → 1h | 1 failed |
| drop `frontier_updated_at_idx` | 1 failed (the **plan** assertion) |
| `least()` → last-write-wins depth | 1 failed |
| remove `REVOKE ... FROM public` | 1 failed |
| remove the settle whitelist | **SURVIVED → real gap** |

**The surviving mutation was a real gap**, as it was the last two times. Nothing asserted that a settle
verb outside the three terminal states is dropped, so a caller could have driven a `fetched` row back to
`discovered` and made the next resume re-fetch a page it had already read. A test was added and the
mutation now fails exactly it.

## 6. Two harness failures worth recording

**A skipped suite read as a pass.** A mutation run that timed out left a dirty PostgreSQL cluster
directory; every subsequent run then failed in `beforeAll` and reported `8 skipped`, which the mutation
script was reading as a result. Both were fixed — the suite clears its data directory unconditionally,
and the script now rejects a skipped suite as a broken harness rather than an outcome. *A test that does
not run is not a test that passed.*

**A deadlock between test and fixture read as a timeout.** Without `SKIP LOCKED` the second claim waits
on the first worker's uncommitted lock, while the test awaits that claim and the commit sits on the far
side of the await. A 2-second `statement_timeout` converts a 400-second hang into an assertion.

## 7. Carried to 5.1b

**`batchDepth = min(batch) + 1`.** Every child of a batch is labelled with the *minimum* depth in that
batch plus one, so a deferred shallow URL lowers it and children already known deeper get re-staged
shallower. This is why re-discovery at a shallower depth is reachable at all. **Measured 0 occurrences
across two fixtures at both caps — possible but unobserved.** Not changed: it feeds `compareCandidates`,
so moving it moves grades. The implementation chosen instead makes reachability irrelevant.
