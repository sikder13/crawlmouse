# ReDoS: super-linear decode in `safeDecodeUrlForDisplay`, reachable on a server-rendered page

**Status:** open · **Priority:** first item of the next batch (owner ruling, 2026-07-31)
**Found by:** hotfix-01 gate round 3 (security lens); measurements re-verified by the controller.
**Deliberately NOT fixed in hotfix-01** — latent, needs a deliberate attacker, Sentry is clean, and
widening scope at gate stage is what caused that hotfix to run three rounds.

## What

`apps/web/lib/url-display.ts:70` runs `out = out.replace(/�+$/u, '') + '…'` whenever the tolerant
decode marks input as truncated. The anchored `+$` backtracks from every start position when the string
holds a long run of U+FFFD that is **not** at the end, giving super-linear (≈quadratic) behaviour.

Trigger shape: a URL path of the form `…/%80%80…%80x%` — the `%80` run is invalid UTF-8 (one U+FFFD each),
the trailing bare `%` sets `truncated`, and the `x` keeps the run off the end.

## Why it is reachable

Measured through the real gates, Node 22:

```
urlChars=  3033  zod.url()=true  new URL()=true  decode=   2ms
urlChars= 30033  zod.url()=true  new URL()=true  decode=  39ms
urlChars=150033  zod.url()=true  new URL()=true  decode= 929ms
urlChars=300033  zod.url()=true  new URL()=true  decode=3634ms
```

- `apps/web/app/api/audits/start/route.ts:23` validates `url: z.string().url()` with **no `.max()`**.
- `validateUrlOrThrow` (`packages/engine/src/ssrf-guard.ts:135`) checks scheme, credentials, DNS and
  private/reserved IPs — it does **not** bound length. The hostile part is the path, which is unchecked.
- `audits.url` is unbounded `text`.
- `apps/web/components/audit/AuditUrlHeader.tsx:12` calls `safeDecodeUrlForDisplay(url)` and is imported by
  `apps/web/app/audit/[id]/page.tsx:4`, an **async server component** — so the cost is Vercel CPU.

**Audit creation IS rate-limited and that contract is intact** — `global:audits:day` fail-closed, then
per-IP (+ Turnstile on breach), then per-domain, in that order (`route.ts:48`, `:71`, `:88`). The issue is
**amplification, not a missing limit**: one gated POST stores the poisoned row, and the resulting
capability URL is then readable an unlimited number of times. `middleware.ts` applies no rate limit (its
matcher excludes only `api|ingest|_next|favicon`), so `GET /audit/<uuid>` is unmetered and unauthenticated.
That makes it a ≤18%-MRR/CPU concern rather than a data-integrity one.

## Fix the CLASS, not the line

**17 invocations across 11 modules** (measured; an earlier version of this ticket said "9 call sites" and
undercounted — in a ticket whose whole instruction is *fix the class*, that would have left surfaces behind).
`FreeFixCard.tsx` alone has 5, and `decodeActionPacketBodyForDisplay` fans out per line. Do all of:

1. Replace the anchored `/�+$/u` with a non-backtracking trailing-U+FFFD trim (walk back from the end).
2. Bound the input: `.max()` on the zod schema at the API boundary **and** a defensive cap inside
   `safeDecodeUrlForDisplay` itself, so no future call site can reintroduce it.
3. Add a length/latency case to `apps/web/__tests__/spec04.2-url-decode-guard.test.tsx`, whose matrix
   currently covers scripts but not size.

## Related

- **FU-12h** — the AI section's expanded body renders `targetUrl` undecoded; that surface is also missing
  from the guard matrix. Same file, same sweep.
- **FU-12i / 12j** — other items logged from the same review round.
