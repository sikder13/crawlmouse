# SPEC 5.1 evidence — the racedays.run "byte-identical" reproducibility control is retired

**Recorded:** 2026-07-31, immediately after SPEC 05 hotfix-01 merged (`c40d548`) and deployed.
**Status:** evidence, **not a bug report.** Nothing here is a regression and nothing is being fixed.
**Filed by owner ruling** so the claim it retires is not carried forward as though it still held.

---

## 1. The measurement

`racedays.run`, audited three times against production:

| date | audit id | pages | score | grade | AI score / band |
|---|---|---|---|---|---|
| 2026-07-27 | — | 419 | 80.32 | B+ | — |
| 2026-07-30 | `15a79871-d3aa-40e6-95c7-69432d6c3b37` | 419 | 80.32 | B+ | 79 / partial |
| **2026-07-31** | `a615b0d5-b7c8-4ea5-9ae7-c96cdbf32f4d` | **418** | **80.60** | B+ | 79 / partial |

Delta: **1 page, +0.28 points, same grade, same AI score, same band.** Retrieval access unchanged —
3 bots reaching, 3 blocked, zero fractional ratios. Crawl duration 68 s.

## 2. The hotfix did not cause it

`packages/engine` runtime behaviour is **byte-identical to the pre-hotfix base `1d67056`**, verified three
independent ways during gate round 5:

1. Comment- and blank-stripped diff of every non-test file under `packages/` → one file, **zero code
   differences** (the only engine changes on the branch are 19 comment lines and 36 test lines).
2. Reviewer 1 confirmed all 19 added non-test lines match `^\+\s*//`, with zero removed lines.
3. Reviewer 2 confirmed the same by diffing the built server chunks between base and head.

The crawl path — `crawler.ts`, `robots.ts`, `sitemap.ts`, `audit.ts` seeding — is untouched by the branch.

## 3. The finding that matters: we cannot tell which cause it is

Two explanations fit the data equally well and **we currently have no way to distinguish them**:

- **Genuine site drift.** `racedays.run` is an event site; one event page expiring between 07-30 and
  07-31 produces exactly this shape. The grade *should* move if the site moved.
- **Crawl-order nondeterminism.** The crawl is budget-bounded and partial (`confidence: low`,
  `partial: true`, coverage ~13%), so which 418–419 of the site's pages get reached depends on frontier
  ordering and timing. The grade moved without the site moving.

**That inability is itself the SPEC 5.1 finding.** A determinism contract that cannot be verified against a
live site is not yet a contract — it is an assumption that happened to hold twice. Two identical runs were
read as proof of reproducibility; they were equally consistent with a site that simply had not changed yet.
The third run does not disprove determinism, and that is the problem: **no run can, under the current
instrumentation.** This is the same epistemic error as the "every production `allowedPageRatio` is 0 or 1"
claim retired earlier in this hotfix — a property of a small sample stated as a property of the world.

## 4. What survives, and what is retired

**Survives — the site-shape-dependence conclusion.** Magnitude here is 1 page / 0.28 points / same grade,
against duskroute's **56-point** swing (`docs/specs/05-follow-ups.md` FU-9,
`evidence/backtest-spec05-stage7.md`). Instability remains strongly site-shape-dependent: giant index pages
monopolising the frontier produce grade-changing swings, ordinary sites produce noise. Nothing here
contradicts that.

**Retired — "racedays.run is a byte-identical reproducibility control."** It is not, and should not be
cited as one. Use it as a *low-variance* case if a comparison case is needed, with the variance stated.

## 5. Recommendation for SPEC 5.1

Persist a **discovered-URL-set fingerprint** per audit — a stable hash over the sorted set of fetched URLs
(plus the counts already stored) — so a re-run can answer the question this record cannot:

- identical fingerprint, different grade → **an engine or grading defect**, and a serious one;
- different fingerprint, different grade → **the input changed**, and the delta is explained rather than
  mysterious. A stored set difference then says *which* pages appeared or vanished, separating site drift
  from sampling drift directly.

This is the same instrument FU-9 already asks for from the other direction — it recommends recording
per-run crawl composition so A15 can certify grade-neutrality on unstable sites. **One artifact serves
both**, and it is a prerequisite for SPEC 06 monitoring, which will otherwise report phantom grade
movement to users on exactly this class of site. Cheap to add (a hash at persist time), and it converts
every future reproducibility question from argument into measurement.

## 6. Related

- `docs/specs/05-follow-ups.md` **FU-9** — the A15 instrument's own instability on sub-15%-coverage sites;
  its "record per-run crawl composition" suggestion is the same fix from the measurement side.
- `evidence/backtest-spec05-stage7.md`, `…-round6.md` — the duskroute series (the 56-point end of the scale).
- `evidence/grade-identity-spec05-hardening.md` — the deterministic fixed-input probe, which is what
  grade-neutrality claims should rest on while live-site determinism remains unverifiable.
- `evidence/reach-percent-display-neutrality.md` §4 — the parallel small-sample generalisation retired
  during the same hotfix.
