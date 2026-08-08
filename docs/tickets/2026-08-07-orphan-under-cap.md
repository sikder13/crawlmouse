# ORPHAN-UNDER-CAP — the page cap manufactures orphans, and they cost real grade points

**Filed:** 2026-08-07 · **Source:** SPEC 5.1a gate 7, blocker B5 · **Severity:** HIGH
**Status:** open — **the TOP item for SPEC 5.1b** · **Not a 5.1a blocker** (owner ruling, below)

## The defect in one line

When the crawl budget cuts the pages that *carry* inbound links, their targets lose every inbound link
and are reported as **orphans that do not exist** — and because Orphans is the heaviest grade component
(40%), the site is graded on an artifact of our own cap.

## The measurement

A WordPress shape with **zero orphans by construction**:

- the sitemap declares the posts,
- the `/page/N` archives are **undeclared** (WordPress does not list them in the post sitemap),
- **every post is linked from its archive** — so every post has an inbound internal link.

**5,501 pages:**

| page cap | critical `orphan` findings | grade |
|---|---|---|
| 500 | **105** | **C / 62.97** |
| 2000 | **0** | **B / 79.28** |

**Sixteen grade points, produced entirely by our own budget.** Same site, same crawler, same run —
only the cap differs. The archives are undeclared, so they are the pages the budget drops; dropping
them severs the only inbound edge each post had.

This is the free tier's default shape: `FREE_PAGE_CAP` is 500, and WordPress is the platform the
product targets most directly.

## Why it is not a 5.1a blocker

Owner ruling, gate 7:

> "5.1a does not fix a pre-existing defect it did not create. The mechanism pre-dates this branch and
> 5.1a makes it BETTER, not worse — stratification reaches hubs the old frontier never did, and the
> refusal gate catches the worst cases. Blocking here would mean 5.1a never ships to fix a defect main
> already has. BUT the false evidence claim is not acceptable."

Both halves matter. The mechanism is on `main` today; 5.1a strictly improves it (stratified selection
reaches hub pages the old frontier missed, and the refusal gate withholds a letter on the worst
coverage). What was not acceptable was `evidence/2026-08-07-gate6-reports.md` claiming the class was
**gone** when its three fixtures merely could not **reach** it — every one of them had its hubs inside
the budget. That claim is corrected in place.

> *The object of the complaint was never the code — it was an evidence file claiming a class absent
> when the fixtures could not reach it. Carry that distinction into 5.1b.*

## What 5.1b has to decide

The finding is not "we crawled fewer pages"; it is **"we asserted a page has no inbound links when we
never looked at the pages that link to it."** Directions, not a decision:

1. **Do not assert `orphan` for a page whose potential linkers were not fetched.** Needs a notion of
   "unobserved in-neighbourhood" — the frontier knows which discovered URLs went unfetched, so this is
   reachable from data 5.1a already persists.
2. **Seed archive/pagination shapes ahead of leaf pages.** Treats the cause: the pages that carry the
   link graph are worth more of the budget than the pages they point at. Interacts with stratification
   and therefore with `batchDepth`, already a 5.1b carry-forward.
3. **Route it through the refusal gate as a trigger.** Consistent with 5.1a's stance — decline to
   assert rather than assert wrongly — but withholding a letter from every capped WordPress site is a
   large conversion cost and needs the measured trigger count first.
4. **Caveat only.** Cheapest, and almost certainly insufficient: the 16 points are already in the
   score by the time any caveat renders.

Option 1 is the narrowest thing that makes the finding honest and is the recommended starting point.

## Fixture requirement for whoever picks this up

**A fixture that cannot reproduce the class must not be used as evidence about it.** The three gate-6
fixtures all keep their hubs inside the budget, which is exactly why they showed 0 orphans at every
cap. Any 5.1b fixture for this must place the linking pages **outside** the budget — undeclared in the
sitemap, discovered late, or beyond the cap — or it proves nothing.

## Related

- `evidence/2026-08-07-gate6-reports.md` §"What held" — the corrected claim.
- `evidence/2026-08-07-d4-cut-and-b5-1-diagnosis.md` — the D4 cut this sits beside.
- `packages/engine/src/audit.ts` — the caveat comment, corrected to stop asserting the opposite.
- `docs/tickets/2026-07-09-engine-linking-grade-honesty.md` — the same family of concern.
