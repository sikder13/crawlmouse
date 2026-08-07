# GATE 6 — the three reviewer reports (FAILED)

**Frozen SHA:** `ee8369722fed45cb158d7a3a2897aa30f2a0e240`
**Worktrees:** `../cm-g6-1` (correctness), `../cm-g6-2` (security/deploy), `../cm-g6-3` (test quality).
**Date:** 2026-08-07. Suites run per package with `npx vitest run`, never the top-level script.

## Verdict

| lens | R1 correctness | R2 security/deploy | R3 test-quality |
|---|---|---|---|
| correctness | **6** | **8** | 9 |
| security | **8** | **7** | **8** |
| deploy-safety | 9 | 9 | 9 |
| test-quality | **6** | **6** | **6** |
| blocking | **1** | **2** | **2** |

Required: ≥9 every lens, 0 blocking. **Neither met.** Baselines identical across all three: engine
**837** · web **1492** · inngest **145** · scripts **40**; typecheck 5/5, lint 4/4, `next build` passes;
lockfile, `turbo.json` and every `package.json` byte-identical to `origin/main`.

---

## BLOCKER 1 — the AuditView surface guard closes none of the classes it names

Found independently by **R2 and R3**, four distinct ways, all leaving **web 1492/1492 green and
`tsc --noEmit` exit 0**. Every one restores gate 3's blocker in production behaviour: a refused audit
rendering *"usually a site that blocks crawlers or has no crawlable pages"*, the invented cause this
spec exists to delete.

| # | edit | why the guard misses it |
|---|---|---|
| **M1** | `if (state.refused) return <failure card>;` on **ONE LINE** after `chooseSurface` | the return count uses `/^\s*return[\s(]/gm`, which only matches a `return` that BEGINS a line. The multi-line form IS caught (1 red) — the commit closed the one spelling it was shown |
| **M9** | an **additive** `{state.refused && <failure card>}` branch beside the real one | the exact-pairing rule pins what the `refused-v2` branch renders; nothing forbids a SECOND branch. The banned-form list holds `'{refused &&'`; the component's local is `state.refused`. Worse than M1: the honesty card and the invented cause render on the SAME screen |
| **N-SG1** | `chooseSurface(state.refused ? { ...state, refused: false, failed: true } : state, !!v2)` | the guard reads the branch table, never what is FED to the decision |
| **N-SG2b** | `const v2 = state.refused ? null : asClientAuditV2(snapshot)` | same — `refused-v2` requires `v2`, and nulling it routes every refusal to `error` |

**This guard has now been found weaker than its own docstring at four consecutive gates** — gate 3,
gate 4 (W8b), gate 5 (S1/S2), and here in the fix written to close S1 and S2. Each fix closed the
instances it was shown and left the class.

**The structural reason, stated by R3:** `AuditView` is a client component driven by `EventSource`
and this suite has **no jsdom** — it never mounts, in any test. Everything from `chooseSurface`'s
arguments to the pixel rests on this source guard alone. A source matcher is being asked to do a
renderer's job.

---

## BLOCKER 2 — the RPC privilege guard's selection claim is false for the third consecutive gate

`ebad08a` states: *"Selection is now genuinely the operation: a function is governed if it TOUCHES
the frontier tables, whatever it is called."* Measured false eleven ways across two reviewers.

The body is captured only by `([^;]*?\$\$.*?\$\$)?` and matched only against the literal
`'public.frontier'`. When either fails, `body` is `''` and `isFrontierFn` **degrades to
`name.includes('frontier')`** — exactly the mechanism the commit says it replaced.

Each probe below is `public.reap_stale_urls`, `security definer`, **no revoke**, body
`delete from public.frontier` — an unauthenticated PostgREST endpoint that empties the table:

| probe | syntax | result |
|---|---|---|
| EV-A | `as $fn$ … $fn$` — a **tagged** dollar-quote, which is what `pg_dump` and `supabase db diff` emit | **10/10 passed** |
| EV-B | `delete from frontier` unqualified (resolves through the pinned `search_path = public`) | **10/10 passed** |
| EV-C | PG14 `language sql … begin atomic … end;` | **10/10 passed** |
| EV-D | `as 'delete from public.frontier …'` — single-quoted body | **10/10 passed** |
| **N4** | the revoke exists **only as a TRAILING `--` comment** | **10/10 passed** |
| N6 / N7 | `grant execute on ROUTINE …` / `alter ROUTINE … security definer` (valid PG 11+, identical effect) | **10/10 passed** |
| N5 | `grant service_role to anon;` — role membership | **10/10 passed** |

**N4 is the sharpest.** `code()` blanks a line only when it *starts* with `--`, so a trailing comment
survives into the matched text and the guard's most important assertion — a `toContain` for the
revoke — passes against a migration with **zero executable revokes**. That is verbatim gate 4's
evasion 4, closed for `/* */` (with a dedicated test) and left open for `--`. The instance was fixed;
the class was not.

**The pattern, in the guard's own terms:** it stopped carrying its own file list (gate 4), then its
own naming convention (gate 5), and now carries its own **body-syntax assumption**. Same failure, one
radius smaller each time. `ebad08a` is itself the commit that declared a false coverage claim on a
security guard to be a finding.

**No live exposure.** Verified independently from `pg_proc` by two reviewers: all four functions
`prosecdef = false`, `search_path` pinned, ACL `{postgres, service_role}` with no PUBLIC entry,
EXECUTE false for `anon`/`authenticated`/`public`. Frontier tables RLS-on, 0 policies, **0 rows**, and
the functions have **zero call sites**. This is a future-migration control.

---

## BLOCKER 3 (R1) — the `hasPredecessor` fix re-creates gate 4's B1, verbatim

`5b37702` changed the dashboard badge's gate from `previousAuditId !== null` to
`hasPredecessor ?? …`. **`hasPredecessor` answers "does a predecessor EXIST"; `gradeFrom` can only be
filled when the predecessor was LOADED.** In the one state the fix was written for — predecessor
exists, outside the loaded window — `hasPredecessor` is `true` and `gradeFrom` is `null`.

Measured through `loadDashboardSites`' own output:

```
LOADER ROW: {"hasPredecessor":true,
             "delta":{"previousAuditId":null,"gradeFrom":null,"gradeTo":"C","scoreDelta":null,…}}
CARD TEXT :  https://a.com/   Audited Jun 29, 2026   No grade → C ■
```

`No grade → C ■` is byte-for-byte gate 4 / B1's output, produced by the fix for gate 5's finding
about gate 4's B1. `NO_GRADE_LABEL` means *we declined to publish a verdict*; we declined nothing — we
failed to load a row.

**Its own test cannot catch it:** `SiteCard.test.tsx` asserts only `not.toContain('First audit')` for
that exact fixture and never asks what the card says instead.

**Reachability** is structural and named by the fix's own commit message: a predecessor that is not
`completed`, one expired but not yet deleted by the bounded daily TTL cron, or one past `.limit(200)`.
**Production today: 0 of 2** re-audited sites are in the state (B1 was 19 of 20), but **3 audits sit
expired-and-not-yet-deleted**, and the state grows directly with re-audit adoption — the Pro spine.

**The correct shape**, per R1: two gates, not one — the first-audit *copy* on `hasPredecessor === false`,
the delta *badge* on `previousAuditId !== null`, and a third, silent state between them.

---

## Evidence-honesty findings — the ones that matter after the merge-go incident

1. **Handoff §6A, which SPECIFIES THE PR BODY, still reports the pre-cut acceptance totals** —
   *"12 of 17 MET … four NOT MET"* — and **omits B10 entirely**. The sweep it instructs the PR to
   carry reads 11 MET / 1 PARTIAL / **5** not-5.1a's *including B10*. The document that dictates the
   PR body would have published a number the sweep no longer supports, and dropped the one row gate 5
   named as the honesty failure.
2. **Handoff §3.4/§3.5 still describe D4 as shipped, in the present tense** — the field, the emitter,
   copy body (d) and a stated precedence that no longer exists. The ⚠ correction box still reads as a
   pending to-do; the fix never landed, the feature was cut.
3. **"ten known evasions in the RPC privilege guard"** (handoff, twice). Gate 5 recorded **seven** new;
   `ebad08a` records **thirteen** now pinned. Neither is ten.
4. **`evidence/2026-08-07-gate5-reports.md` says "all NINE gate-4 survivors" and then lists TEN** — in
   the file created to make the gate-5 claim checkable rather than assertable.
5. **Commit count reads 107; measured 108** — in the commit titled *"correct the commit count to the
   measured one"*, which measured its own parent.
6. **Sweep B16 cites superseded gate scores** (gate 4's "9/9/8"); gate 5 scored security 8/8/8. **Sweep
   B12 says "25 tests"; measured 26.**
7. §6A item 7 lists four carried tickets; `2026-08-07-attempted-count-not-persisted.md` is not among
   them. The RPC guard's evasions have **no ticket at all**, while the import-graph guard's do.

---

## What held — and it is substantial

**The D4 cut is complete, and verified BY TEST rather than by grep.** R3 reconciled the removed tests
exactly: 5 from the deleted `sitemap-delta-acceptance.test.ts` + 13 from `coverage.test.ts`,
**855 − 18 = 837**. **No test was softened to accommodate the cut**, and the replacements are stronger:
`coverage.test.ts` asserts on **serialized bytes** with an anti-vacuity control, and
`refused-route.test.tsx` drives a **pre-cut row** through the real projection and pins that it renders
no banner (mutating `INFORMATIONAL` back → 1 red). A pre-cut row cannot resurrect the claim.

**The D4 CLASS is gone from the surviving findings** — the transferable half of the ruling. R1
rebuilt both gate-5 fixtures with unique per-page content and ran the real crawler at production scale:

| fixture | caps | orphan / unreachable_page |
|---|---|---|
| hub-and-leaf, 40×10 = 441, zero orphans | 5 / 25 / 60 / 441 | **0 at every cap** |
| paginated blog, 600 posts + 60 `/page/N` | 100 / 500 / 700 | **0 at every cap** |
| category hub, 40×100 = 4040 | 100 / 500 / 4100 | **0 at every cap**, grade 80.23 / 80.36 / **80.38** |

A grade steady to two decimal places across a **41× cap range**, on the shape D4 got most wrong.

**freepltn still refuses on `no_observed_links`**, verified through the real crawler both isolated and
interlinked, at caps 5/20/61, with no reachability substring in the serialized payload.

**R3's independent route-level walkthrough** — real `runAudit` → real `persistAuditResults` → a row
restricted to the real `AUDIT_COLS` → projection → `chooseSurface` → render — resolved all four
triggers correctly, including precedence on a co-firing row, with a graded control. No letter, no
`text-warning`, no "contact support", no "blocks crawlers" on any refused screen.

**Security posture verified live from the catalog by two reviewers**, plus R2's 15-assertion
byte-level serialization probe across four unentitled viewers with a Pro-owner anti-vacuity control:
no letter, no `user_id`, no `failure_reason`, no gated content. SSRF diff empty. `crawlee` still
direct; `ensureCrawleeMemoryHint()` intact. Zero new `process.env` reads, so `build.env` needs nothing.

**The import-graph guard's three claimed controls all verify** — line shift green, real new default
red, edited inventoried line red. R3: *"This guard's docstring is accurate."*

**All seven gate-5 RPC evasions and all six from gate 4 are genuinely closed** (re-run independently),
as are gate-5's S1, S2 and S6, and every kill count claimed by `bb3ab55` (5 / 2 / 1) reproduces exactly.

**Disclosure:** B17, B10, B11, B13, B14/B15 all judged honestly disclosed by all three reviewers. R3
on B10: *"This is the row gate 5 named as breaking the disclosure discipline, and it is fixed. The
failure is downstream"* — §6A, which transcribes it.
