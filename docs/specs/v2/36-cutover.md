# CC-36 — the v1 → v2 cutover, keyed on the flags

v2 goes live by switching four flags on in order (`docs/ops/go-live.md`): step 2 `V2_PIPELINE`,
step 3 `V2_ACCOUNT_DOOR`, step 4 `V2_CHECKS_PUBLIC`, step 5 `V2_BILLING`. A step is undone by an
Instant Rollback to the deployment before it, which brings back that deployment's environment. So
every change in this step is keyed on a flag: with the flags off a v1 URL, page or job behaves as it
did before this step, and with them on a visitor does not land on a v1 dead end or v1's look.

The inventory this step works from is `docs/ops/v1-inventory.json` (CC-V1AUDIT, measured at
`ee11796d`; verified again on `b82a8e1f`, differences in "Verified" below).

## D1 — one table of retired addresses

`apps/web/lib/v2/cutover.ts` `V1_CUTOVER`, read by `apps/web/middleware.ts` before anything else
reads a request. A row answers only while every flag it names is on; otherwise the middleware does
what it did before and v1 serves the address.

| address                             | flags                             | answer                                                   |
| ----------------------------------- | --------------------------------- | -------------------------------------------------------- |
| `/compare`                          | `V2_CHECKS_PUBLIC`                | 308 `/`                                                  |
| `/compare/:a/:b`                    | `V2_CHECKS_PUBLIC`                | 308 `/audit/:a`                                          |
| `/top/:platform`                    | `V2_CHECKS_PUBLIC`                | 410, a small page drawn with the v2 tokens, linking home |
| `/billing`                          | `V2_CHECKS_PUBLIC`, `V2_BILLING`  | 307 `/settings/plan`                                     |
| `/api/trpc/*`                       | `V2_CHECKS_PUBLIC`                | 404 JSON                                                 |
| `/api/audits/start`                 | `V2_CHECKS_PUBLIC`, `V2_PIPELINE` | 410 JSON naming `/api/checks`                            |
| `/api/audits/:id/cancel`, `/notify` | `V2_CHECKS_PUBLIC`, `V2_PIPELINE` | 410 JSON naming the `/api/checks/<checkId>/…` route      |
| `/api/audits/:id/reaudit`           | `V2_CHECKS_PUBLIC`, `V2_PIPELINE` | 410 JSON, no replacement                                 |

Verify: `pnpm --filter @crawlmouse/web exec vitest run lib/v2/cutover.test.ts middleware.test.ts`.
`cutover.test.ts` fails when a retired page or route of the inventory has no row and is not one of
the exemptions it lists; `middleware.test.ts` walks each row with its flags on (the answer) and with
each of its flags off in turn (passed on, as before this step).

- **Why `/billing` waits for `V2_BILLING`.** Until step 5 it is v1's way to the Stripe portal, which
  the owner's v1 Pro uses; its target is served from step 4. It is a 307, not a 308: after a rollback
  `/settings/plan` is a 404, and a browser keeps a 308. `/billing` is not an indexed address.
- **Why `/top/:platform` is a 410, and from the middleware.** No leaderboard is indexable: the page
  is indexed at 10 qualifying reports (`app/top/[platform]/page.tsx`, `LEADERBOARD_MIN_INDEX`), and
  production holds at most 1 per platform (measured 2026-11-13). Next 15.5 drops a status set on a
  middleware rewrite (`next/dist/server/lib/router-utils/resolve-routes.js`, the rewrite branch), so
  the middleware returns the whole document; `cutover.test.ts` pins its colours to
  `styles/v2/tokens.css`.
- **tRPC.** No component calls a tRPC hook; `app/layout.tsx` mounts the provider only.
- **Not rows:** `/`, `/dashboard` and `/r/:slug` are rewrites (`lib/v2/rewrites.ts`); `/audit/[id]`
  branches in its page (a v2 check goes to its own page, a v1 audit is served).

## D2 — the v1 API routes

None is forwarded to its `/api/checks` counterpart. v2's start takes a `requestId` that a v1 client
does not send and answers `{checkId}` where v1 reads `{auditId}`; the `[id]` routes take a
`checks.id`, and a v1 id is an `audits.id`, so a forwarded call would be a 404 from v2. A 410 names
the route to call instead. Because the middleware answers first, the v1 handler is not reached and
no rate-limit bucket is spent; Turnstile and the limits of `/api/checks` are unchanged.

- **Kept as v1:** `/api/audits/:id/stream`, `/export`, `/llms-txt`. The v1 audit page, still served
  for a v1 audit, reads all three (`app/audit/[id]/AuditView.tsx`, `AuditSurfaceView.tsx`,
  `components/ai/LlmsTxtGenerator.tsx`; `cutover.test.ts` checks each caller). So inventory finding
  A-1 (the stream's unvalidated id and missing limit) is not closed by this step; A-11 (notify) is, at
  step 4.
- **The end date.** `API_ALIAS_LAST_DAY = '2027-02-15'`, 90 days after the earliest planned switch-on
  (2026-11-17). `apiAliasesEnded(now)` is tested at injected dates; one test calls it with the real
  clock and fails after that day, which is when the `gone-api` rows and the v1 handlers they shadow
  are removed.

## D3, D4, D5, D6

Filled in as each lands.
