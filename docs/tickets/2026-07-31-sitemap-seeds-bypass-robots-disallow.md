# HIGH — sitemap seeds bypass the crawler's robots.txt `Disallow` filter

**Status:** open · **Priority:** HIGH · **Owner ruling 2026-07-31:** open the ticket, do not fix now.
**Found by:** SPEC 05 hotfix-01 gate round 4, while establishing that a fractional `allowedPageRatio` is
reachable in production. Independently re-verified by two reviewers and by the controller.

## Why this is HIGH and not a tidy-up

Crawlmouse runs a **public crawler against other people's websites**, and its positioning is honesty —
`PROJECT_OVERVIEW.md` §5 lists `robots.ts` under "respect robots + seed from sitemaps". Fetching paths a
site owner explicitly disallowed is a **compliance and reputation** exposure, not only a correctness bug:
it is the single behaviour most likely to get the crawler blocked, complained about, or written up, and it
undercuts the exact claim the product sells. It also silently corrupts the AI-readiness access component,
because disallowed pages that should never have been fetched still count in the denominator.

## The defect

Robots filtering is applied to **enqueued links only**, never to seeds.

- `packages/engine/src/crawler.ts:274-284` defines the allow check and it is applied at the link-enqueue
  site (`:469`) — `isAllowedByRobots(robots, ROBOTS_UA, path)`.
- `packages/engine/src/audit.ts:207-239` collects sitemap URLs and passes them into `startUrls`
  (`:246`) with **no robots check at all**.

So any sitemap-listed URL that `robots.txt` disallows is fetched, enters `pages`, and is graded.

## Measured reproduction

`robots.txt` = `User-agent: *` / `Disallow: /search` / `Disallow: /cart`, over a 419-page crawl in which 5
crawled paths match those prefixes:

```
all 14 bots -> allowedPageRatio = 0.98807
6 x HIGH  "…can reach only 98% of your pages — blocking a search/citation crawler
           costs you visibility in its answers."
headline: 100 / 100 AI-ready      access bar: 99%
```

Two distinct harms visible in that one output:
1. **We fetched pages the owner disallowed.** That is the compliance issue.
2. Those pages then **depress every bot's `allowedPageRatio`**, producing six HIGH findings on a site whose
   only "fault" is a perfectly ordinary `Disallow: /cart`. The diagnosis is wrong *because* the crawl
   misbehaved.

A second, narrower hole in the same seeding path, found by the same review: the "same origin" gate at
`audit.ts:221` is a bare prefix test —

```js
if (c && c.startsWith(canonicalOrigin)) sameOrigin.push(c);
// 'https://a.com.evil.com/x'.startsWith(new URL('https://a.com/').origin) === true
```

`canonicalOrigin` has no trailing slash, so `a.com.evil.com` passes as same-origin and is handed to
`crawler.run(startUrls)` with no further host check. Fix alongside: `startsWith(canonicalOrigin + '/') ||
c === canonicalOrigin`.

## Fix sketch

1. Apply `isAllowedByRobots(robots, ROBOTS_UA, pathOf(url))` to sitemap seeds before they reach
   `startUrls`, i.e. filter in `audit.ts` where the seed list is assembled — the same predicate the enqueue
   path already uses, so there is one rule, not two.
2. Tighten the origin prefix test as above.
3. Decide and document what a disallowed-but-sitemapped URL means for coverage reporting: it should be
   **excluded from the denominator**, not counted as unreachable, or the access component inherits the
   same distortion from the other direction.
4. Pin with a crawl-level test: a fixture site whose sitemap lists a disallowed path must not fetch it, and
   its retrieval bots must stay at ratio 1.

## Interaction with other work

**FU-12k** changes how the reach percentage is computed and displayed. This ticket changes *the denominator
that feeds it*. They are independent but both touch the access story — if FU-12k lands first, its exact
integer percentages will simply be exact percentages of a still-wrong page set.

## Related
`PROJECT_OVERVIEW.md` §5 · `docs/specs/05-follow-ups.md` FU-12k ·
`evidence/reach-percent-display-neutrality.md` §4 (cites this as its reachability proof)
