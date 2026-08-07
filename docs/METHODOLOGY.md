# Crawlmouse — crawl and grading methodology

> **Internal engineering reference.** This states what the engine guarantees, what it does not, and the
> measured size of the gap. It is deliberately not marketing copy: a user-facing version is a separate
> decision, taken from this document rather than written independently of it.
>
> **Why this file exists.** SPEC 5.1 exists because we once shipped a grade that moved 56 points across
> ten runs of the same unchanged site while reporting the same page count each time. The lesson was not
> "fix the sampler" — it was **do not promise reproducibility we cannot deliver.** Anything claimed here
> must be traceable to a measurement in `evidence/`.

Last updated 2026-08-06 (SPEC 5.1a Stage 6).

---

## 1. What we guarantee: SELECTION is deterministic

Given a set of discovered URLs, **which URLs the crawler chooses to fetch is a pure function of that set
and a fixed seed.** No wall-clock time, no arrival order, no concurrency outcome, and no response
latency may enter the choice. Ties break by canonical URL.

Mechanically: URLs are grouped into strata by template shape (`/event/{slug}`, `/blog/{n}/{n}/{slug}`),
strata are visited in key order, and every stratum receives its first slot before any stratum receives
a second. Within an over-subscribed stratum we keep the smallest `sha256(salt ‖ url)` keys — a hash of
the URL, not a random draw, so the chosen subset is a property of the site rather than of the run.

This is gated in tests against a **fixed discovered set fed directly to the selector**, with no crawl,
no host and no clock involved. That location is forced: a budget-bounded crawl discovers as far as the
remote host's latency allows, so a live run can neither prove nor disprove selection determinism.

## 2. What we do NOT guarantee: BANKING under budget exhaustion

**When the crawl budget expires part-way through, which of the selected URLs finished is decided by
latency, and it is not reproducible.**

Stated plainly because the temptation is to state it softly: selection is deterministic, banking is not.
A page that was chosen may or may not be in the result depending on how fast the server answered that
run. Two runs of an unchanged site can return slightly different page sets.

Measured on a fixed local corpus (200 pages, per-URL latency a property of the URL, one deliberately
slow section), five runs per configuration, instrument proven first on a completing crawl (3 runs, one
distinct set, zero difference):

| corpus | concurrency | distinct banked sets (of 5) | pages differing (union − intersection) |
|---|---|---|---|
| fixed latency | 4 | 3 | **5** of a ~158-page sample |
| fixed latency | **1 (serial)** | 4 | **6** of a ~58-page sample |
| jittered latency | 4 | 5 | **9** of a ~160-page sample |

Two things follow from the numbers rather than from argument:

- **It is the clock, not concurrency.** The serial runs vary too, so this cannot be removed by crawling
  one page at a time. A deadline lands wherever ordinary scheduling noise puts it.
- **Variance grew when we made the crawl reach further.** Before the round clock (§4) the same corpus
  produced *one* distinct set — but only because the crawl died on the same slow section every run and
  banked a third as many pages. That was **determinism by not trying**, and it is not a property worth
  keeping.

### The magnitude, and the honest bound

The failure this replaced was unbounded: the incumbent sampler could return **any 500 of ~7 000
discovered URLs**, and did — duskroute.com, ten runs, every one at exactly 500 pages, F/32.88 to
A−/88.89. A 56-point, six-letter swing with the page count held constant.

Now the variance is confined to the rounds a clock actually interrupts, so it is **bounded in practice
by roughly one batch — 25 pages, about 5 % of a 500-page crawl.** The largest difference measured above
is 9 pages, inside that bound.

**These numbers were RE-MEASURED with the round clock in place, not inherited from before it.**
Variance **grew** when the round clock was added — from 0–1 differing pages to 5–9 — because more round
boundaries mean more points at which a clock decides what finishes. That is the honest direction of
travel and it is stated rather than smoothed: *coverage grew and variance grew with it.* The earlier,
lower numbers came from a crawl that reproducibly **died on the same slow section every run**, banking a
third as many pages. Stability through consistent failure is not reproducibility, and ~158 pages at 5–9
pages of variance is a better product than ~54 pages at 0–1.

**The bound is empirical, not proved.** A host whose response times vary enough to move several round
boundaries could exceed it. We say "roughly one batch on a well-behaved host, larger on a host whose
latency varies a lot" and we do not round that up to "reproducible".

### How the difference stays visible

Every crawl emits a fingerprint: the count of URLs discovered, the count selected, a SHA-256 digest over
the selected set, and a per-stratum table of discovered-vs-selected. This keeps three statements
distinguishable that would otherwise collapse into "the grade changed":

- **identical digest, different grade** → an engine defect;
- **different digest** → a different sample, with the strata table naming which sections moved;
- **different banked set at the same digest** → the latency effect described above.

## 3. Coverage is not page count

**A higher page count is not better coverage.** This is a correctness statement, not a nuance.

Level-sorted truncation — what we used to do — drained alphabetically-early URLs and systematically
never reached a site's slow or deep corners. It reported large page counts made of *fast* pages.
Stratified selection reaches those corners on purpose, and therefore often reports a **smaller** count
that represents the site **better**.

Measured directly: on `info.cern.ch` the old sampler banked 123 pages and graded A−/87.04; the current
engine banks 99 pages and grades B+/81.39. **Better coverage produced a worse grade** — the deep,
poorly-linked pages the old sampler never saw are real, and the site's linking is genuinely weaker than
123 fast pages suggested.

Any coverage metric that treats "more pages" as "better coverage" would score the honest crawl below the
flattering one, and would reintroduce the exact non-monotonicity this work exists to remove.

### Known residual: latency biases the sample against slow sections

Slow sections cost more budget per page than fast ones, so under a fixed wall clock a page's chance of
being fetched falls as its server's response time rises. **The sample is biased against slow parts of a
site even though selection is unbiased** — stratification fixes which URLs are *offered*, not which the
clock lets *finish*. Not corrected as of SPEC 5.1a; recorded so no coverage claim is made without it.

## 4. Why a crawl stops where it does

Three bounds, all constants, none derived from observed throughput. A value derived from throughput
would make crawl composition a function of latency, which is the nondeterminism §1 exists to remove.

| bound | value | what it limits |
|---|---|---|
| crawl wall clock | 240 s (prod) | the whole crawl |
| round batch size | 25 URLs | how many URLs one round may **consume** |
| round budget | 35 s | how much time one round may **spend** |

The round budget must exceed the 30 s navigation timeout, or a round could expire before its first
request could possibly resolve; `constants-invariants.test.ts` fails the build if it does not.

The last two bound different things and neither can do the other's job. A stalled URL costs time *per
URL*, so no batch size bounds it; a round budget bounds the time but not how much of the frontier is
consumed. A round that expires does **not** end the crawl — the loop re-selects from the remaining
frontier and continues until the crawl wall clock is reached.

A URL that does not answer within the 30 s navigation timeout is **not retried**. A timeout is a verdict
rather than a transient throttle: repeating it four times spends 150 s to re-derive what the first 30 s
established. Genuine overload (HTTP 429/503) is a different signal and does keep its adaptive backoff.

## 5. Why we sometimes decline to grade

**Absence of evidence must never read as evidence of quality.** A ratio-based score defaults to perfect
on an empty input set: with no observed internal links, orphan ratio, click depth and anchor diversity
all score full marks *precisely because there is nothing to measure*, producing a high grade from an
empty crawl. Sixteen per cent of the audits in our own corpus were in that state.

The engine will therefore **decline to assert a letter grade**, rather than assert a flattering one,
when any of the following holds:

- too few gradeable pages were read — and we distinguish a small site we read *completely* from a
  large one we could not read, because telling a legitimate three-page brochure "we couldn't read
  enough of your site" is false;
- no fetch succeeded at all;
- no internal links were observed among the gradeable pages.

Each is a fact about the **evidence we hold**, not a judgement about the site. A site that we could not
read is not a bad site, and we should not print a letter that implies we know either way.

A fourth condition — **coverage cannot be estimated at all** — does *not* withhold the letter. It caps
confidence and nothing more. That distinction is deliberate and is stated here because the earlier
version of this section listed it alongside the other three, which was **false about the shipped code**:
a fully-read site whose total we cannot estimate still gets its grade. Whether coverage that cannot be
estimated should also govern the letter is an open question for SPEC 5.1b §9 ("confidence governs, it
does not decorate"); today it does not, and this document will not claim otherwise.
