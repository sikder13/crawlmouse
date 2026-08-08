# SPEC 5.1a Stage 3 (§6) — carry-forward findings, recorded before Stage 2

**Recorded:** 2026-08-03, at the Stage 1 gate · branch `engine/spec-5-1a`
**Status:** design constraints for Stage 3, produced as a by-product of the Stage 1 measurement. Written
down now because they were found while measuring something else, and findings found sideways are the
ones that get lost.

Source: the six-crawl control on `mohammadalinijhoom.com` in
`evidence/2026-08-03-stage1-crawl-integrity.md` §4, plus `evidence/backtest-stage1-repro-control.md`.

---

## Finding A — composition may depend on the HOST's wall clock, not only on ours

Six crawls of the same site within about fifteen minutes, engine held constant for the last four:

| crawl | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| pages fetched | 31 | 50 | 65 | 80 | 91 | 97 |
| score | 74.18 | 63.49 | 63.43 | 61.54 | 62.25 | 63.24 |

The page count rose **monotonically across all six**, under an identical 120 s budget and an identical
page cap. Six of six in one direction is not what independent random variation looks like.

**Hypothesis, consistent with the data and not yet proven:** the host warms its cache under repeated
crawling, so each successive crawl completes more requests inside the same wall-clock budget. Other
explanations survive — a CDN promoting the origin, connection reuse, the site genuinely growing — and
distinguishing them is not something this panel can do.

**Why it matters regardless of which explanation is right.** §6.6 requires the frontier to be a pure
function of the discovered URL set and the fixed seed, with wall-clock time, arrival order, concurrency
outcomes and response latency all forbidden as inputs. On a budget-bounded crawl, *how many* URLs get
discovered before the budget expires is itself decided by response latency — and here that latency is a
property of the **remote host**, outside our process entirely. Frontier purity makes selection
deterministic **given a discovered set**; it cannot make the discovered set deterministic against a live
host.

### Consequence for B6, which must be designed around this

> **B6 — "re-crawl a fixed corpus twice with no site change and prove identical digests and identical
> grades" — must run against a FIXED LOCAL CORPUS.** A live-site run cannot serve as the gate, because a
> failure there is unattributable between an engine defect and the host's own variability, and a *pass*
> is equally uninformative — it may only mean the host happened to be stable for those two minutes. That
> is exactly the epistemic error the racedays.run control was retired for: two identical runs read as
> proof of determinism when they were equally consistent with a site that had not changed yet.

Design implications to carry into Stage 3:

1. **The gate corpus is served locally** — a fixture site (or a recorded corpus replayed from disk) with
   deterministic latency, large enough that the page cap genuinely truncates. Identical digest and
   identical grade across two runs is then a real contract, because the only remaining variable is us.
2. **Separate discovery from selection, and gate them separately.** Selection can be proven a pure
   function of the discovered set directly, by feeding a fixed discovered set to the selector — no crawl
   involved, no host involved, and it is the property §6.4's hash-of-URL sampling actually claims.
   Discovery under a budget cannot be made deterministic against a live host and should not be asserted
   to be.
3. **Live-site runs are reported as evidence, never as the gate.** `--mode=repro` gives the site's own
   variance; report it beside any live delta so a reader can see whether the delta exceeds the noise. On
   this site it did not.
4. **The fingerprint is what makes live runs interpretable at all** (§6.7). It does not make them a
   gate; it makes their failure explainable. Identical digest + different grade is an engine defect and
   is gateable anywhere; different digest is an input change and is only ever evidence.

## Finding B — the score falls as coverage rises, on a second independent site

Same six crawls. Reaching **more** of the site produced a **lower** grade: 74.18 at 31 pages, ~62 at 91.
The relationship is not noise-shaped; it is directional.

This is **E1's non-monotonicity reproduced outside duskroute.com**, on a site of an entirely different
shape (a throttling WordPress site rather than one with giant index pages). E1 has always been open to
the reading that it was a duskroute pathology. It is not.

**What it strengthens: composition drives the grade, not sample size.** If size drove it, a larger
sample would converge toward the site's true value from either direction, not move steadily one way. A
directional move as coverage grows means the *added* pages differ systematically from the pages already
sampled — and in this case they plainly do: the first 31 pages are whatever is reachable fastest, which
is a hub-and-nav-dominated slice, while the next 60 are the long tail of leaf content that carries the
orphan and anchor problems. The `orphan:+10` and `over_optimized_anchor:+11` finding deltas in the
control rows say exactly that.

Two consequences for Stage 3:

- **I3 (coverage non-inflation) is the right invariant and it currently fails in the observed
  direction.** The property should be stated so it catches *both* signs: increasing coverage on a fixed
  site must not systematically move the grade, and this site moves it downward. A one-sided property
  would pass here while the defect is live.
- **This is the argument for stratified selection, measured rather than asserted.** Round-robin across
  template strata means the first 31 pages already contain leaf content in proportion, so the grade
  should stop tracking how far the crawl got. Whether it does is Stage 3's own measurement, and this
  site is a good panel member for it — its variance is now characterised, which is what makes it usable.

## How to reproduce

```bash
pnpm backtest -- --mode=repro --urls=https://mohammadalinijhoom.com/,https://mohammadalinijhoom.com/ \
  --pageCap=500 --budget-ms=120000 --out=evidence/backtest-stage1-repro-control.md
```

Run it more than twice before drawing conclusions; the point of this record is that two runs are not a
sample.
