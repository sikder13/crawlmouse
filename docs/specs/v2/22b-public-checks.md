# SPEC 22b — the free check on real data, behind `V2_CHECKS_PUBLIC`

A visitor enters a URL on the home page, a real check runs, and they read the real result with its
segment pages, fix pages and map. This file records the owner's decisions (D1–D13), the rulings that
changed them, and what a reader needs to know that the code does not say in one place. It is written
by hand. The test commands below are run from the repo root and take
`--pool=forks --poolOptions.forks.maxForks=1 --poolOptions.forks.minForks=1`; `vitest` here means
`pnpm --filter @crawlmouse/web exec vitest run`.

## Flags

| Flag               | Unset                                                                                                            | Set                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------- |
| `V2_CHECKS_PUBLIC` | `/`, `/audit/[id]` and `/api/audits/*` are served by v1's code; the routes and pages this step adds answer 404   | the behaviour below |
| `V2_PIPELINE`      | `POST /api/checks` answers 503 `unavailable`; no first audit is requested; the expiry function is not registered | checks run          |

Production keeps both unset in this step. Proof of the unset state: `vitest app/api/checks/route.test.ts
"app/api/checks/[id]/flag.test.ts" app/api/checks/v1-start-pin.test.ts middleware.test.ts
components/v2/screens/home/live-home.test.tsx __tests__/v1-inventory.test.ts`. A production
build of this branch was also compared with one of `origin/main`, flag unset: `/` is prerendered in
both and links the same stylesheets.

Three things change with the flag unset:

- The cookie banner writes the visitor's analytics decision to a `cm_consent` cookie beside
  localStorage (`lib/consent.ts`; owner ruling Q6).
- The Sentry scrubber, on the server and in the browser, replaces the id in an `/audit/{id}` or
  `/audits/{id}` path, as it did for `/checks/{id}` (`vitest lib/auth/sentry-scrub.test.ts`). A v1
  audit id is a capability too.
- The middleware answers a cross-site POST to a new route 403 and a non-JSON one 415 before the
  route's own 404, as it does for the claim route (`vitest __tests__/security/json-body.test.ts`).
  This follows the plan review, not an owner ruling; it is listed for the owner in the pull request.

## Decisions

| #   | Decision                                                                                                                                                      | Where                                                            | Proof                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | One flag, `V2_CHECKS_PUBLIC`                                                                                                                                  | `lib/auth/flags.ts`                                              | the commands under Flags                                                                                                                                |
| D2  | `POST /api/checks {url, requestId}` starts an anonymous check                                                                                                 | `app/api/checks/route.ts`, `_lib/start.ts`                       | `vitest app/api/checks`                                                                                                                                 |
| D3  | One capability rule and one loader                                                                                                                            | `lib/v2/pipeline/public.ts`, `load-for.ts`                       | `vitest lib/v2/pipeline/public.test.ts lib/v2/pipeline/load-for.test.ts`                                                                                |
| D4  | The audit pages on real data                                                                                                                                  | `app/audit/[id]/**`                                              | `vitest "app/audit/[id]" lib/v2/view/real-data.property.test.ts`                                                                                        |
| D5  | `GET /api/checks/[id]/stream`, server-sent events                                                                                                             | `lib/v2/pipeline/stream.ts`, `app/api/checks/[id]/stream/`       | `vitest lib/v2/pipeline/stream.test.ts "app/api/checks/[id]/stream"`                                                                                    |
| D6  | Free three fixes open, the rest locked; Keep carries the check id                                                                                             | `lib/v2/view/free-fixes.ts`, `app/audit/[id]/_lib/`              | `vitest "app/audit/[id]/_lib/real-data.test.tsx"`                                                                                                       |
| D7  | Keep moves the evidence; kept sites get a first audit                                                                                                         | `lib/v2/pipeline/keep.ts`, `first-audit.ts`, `lib/auth/claim.ts` | `vitest lib/v2/pipeline/keep.test.ts lib/v2/pipeline/first-audit.test.ts __tests__/v2/account-door-claim.test.ts __tests__/v2-022b-keep-expiry.test.ts` |
| D8  | Anonymous results expire after 24 hours and are deleted daily                                                                                                 | `lib/v2/pipeline/expire.ts`, `inngest/check-expiry.ts`           | `vitest lib/v2/pipeline/expire.test.ts`; `pnpm --filter @crawlmouse/inngest exec vitest run check-expiry.test.ts`                                       |
| D9  | Notify and cancel                                                                                                                                             | `app/api/checks/[id]/{notify,cancel}/`                           | `vitest "app/api/checks/[id]/notify" "app/api/checks/[id]/cancel"`                                                                                      |
| D10 | `/` serves the v2 home under the flag, with main's head                                                                                                       | `middleware.ts` (`V2_REWRITES`), `app/v2-home/`                  | `vitest middleware.test.ts components/v2/screens/home`                                                                                                  |
| D11 | Honest states                                                                                                                                                 | `lib/v2/view/**`, `app/audit/[id]/_lib/failure-copy.ts`          | `vitest "app/audit/[id]/_lib/real-data.test.tsx"`                                                                                                       |
| D12 | Six funnel events                                                                                                                                             | `lib/analytics-events.ts`, `lib/analytics-server.ts`             | `vitest lib/analytics-server.test.ts app/api/checks/_lib/events.test.ts`                                                                                |
| D13 | Out of this step: `/r/[slug]` on v2, `/check/*`, dashboard and site pages, settings, emails, pricing, sitemap fetching on the worker, production env, flag-on | —                                                                | —                                                                                                                                                       |

## Where the build differs from a decision's wording

- **D2, "creates or reuses the anonymous `sites` row".** One unkept site per request, not per host
  (`publicSiteId(requestId, host)`). A site row shared by every visitor of a host would hand a
  claimer the other visitors' checks. Consequence: the database's one-running-check-per-site rule
  no longer keeps two visitors' checks of one host apart; the per-domain limit bounds how many
  start in an hour, not whether they overlap.
- **D4, "`/audit/[id]` → the crawl screen / the result".** A v2 check is read at
  `/audit/[id]/overview`; `/audit/[id]` redirects there when the id is a v2 check the viewer may
  read, and is v1's page otherwise. A production build links a page's stylesheets for each module
  the page can reach, through `import()` too, so a flag branch in v1's page put v2's CSS on it
  (measured on a production build: one more stylesheet on `/audit/[id]`, two more on `/`).
- **D6, "the Free three fixes in full".** The engine writes no packet and no before/after for a
  fix today (`packages/engine/src/v2/grade/outcomes.ts`), so an open fix shows its title, effect,
  effort and evidence, and one line saying its steps are not written yet. No packet text is made
  up in the web app. **"The primary action is Keep":** the result's orange button is the locked
  design's "Open the fix"; Keep is the bar below it. Not ruled on; listed for the owner in the pull
  request.
- **D7, "the claim calls `requestCheck`".** Only when the kept site has no queued, running,
  deferred, finished or partial check, which is when the claimed check failed.
- **D7, "a failed move".** A copy that fails or passes its 8-second budget does not refuse the
  Keep: ownership commits alone, the stored paths stay under `anon/` and still read, and the
  expiry function's second step moves the objects later.
- **D8, "the page for an expired id is the expired state".** From `expires_at` until the daily
  function deletes the site. After that the id answers 404; no row is kept to tell it from an id
  that never existed.
- **D12.** `check_finished` is sent when a check's end reaches a viewer's stream, so it counts
  the ends someone watched. A count of finished checks belongs to a listener on `check.finished`
  (CC-28).

## Start (D2)

Order: flag 404 → `unavailable` → `paused` → body → host and the SSRF guard → the derived rows →
global ceiling → address bucket and Turnstile → domain bucket → site insert → `requestCheck`
(`vitest app/api/checks/_lib/start.test.ts -t "the order of a start"`).

- A refused host writes no `sites`, `checks` or `rate_limits` row and answers one fixed body, not
  the guard's message (`… -t "hosts that are not public"`). A non-default port is refused: the
  crawl starts at `https://{host}/`.
- The check id and site id are derived from the lower-cased `requestId` and the host. A request
  sent again answers the same check and counts against its own bucket (`start-replay:ip:{ip}`, 30
  an hour, 429 `rate_limited`), not against the three a first start counts against. While that check is `queued` on an
  unkept site the event is sent again under the same id, so a start whose first send failed still
  runs; in another state nothing is sent (`… -t "a start that is sent again"`).
- `requestId` is as good as the check id, which is the capability to read the check. The home form
  makes one with `crypto.randomUUID()` per submit. The route logs neither value
  (`vitest app/api/checks/route.test.ts -t "what is logged"`).
- Limits are v1's keys and numbers, shared with v1: `global:audits:day` (closed when it cannot be
  counted), the address's day and the domain's hour. Turnstile is asked for as v1 asks: once the
  address's day is used up. A signed-in caller gets the larger address limit; no plan is exempt
  from the domain bucket.
- 503 codes come from `lib/v2/unavailable.ts`: `paused`, `unavailable`, `capacity`.
- Other answers: 400 `invalid_request`, `invalid_url`; 429 `captcha_required`, `captcha_failed`,
  `domain_limit`, `rate_limited`; 409 `request_spent` (an account keeps the derived site and the derived check is
  gone); 500 `start_failed`.

## Reading a check (D3, D4, D6, D11)

`readableCheck` answers null for an id that is not a uuid, a check that does not exist, a check of a
removed site, and a kept site's check asked for by anyone but a member of that site; its callers
answer 404. Membership is asked with the caller's own database role, so the rule is the `sites`
row-level policy (`vitest lib/v2/pipeline/public.test.ts`).

`loadCheckFor` gives a page one of five states: `waiting` (queued, running or deferred), `ready`,
`failed`, `expired`, or null. `ready` carries the dataset the views read (the check, and the site's
checks queued at or before it), the map drawing stored when the check was built (or null), and the
plan: `free` for an unkept check, the account's effective tier for a kept one.

Pages: `/audit/[id]/overview`, `access`, `nojs`, `signals`, `content`, `structure`, `changes`,
`fix/[fixId]`, `map`. Each sets `robots: index false, follow true` and its own canonical; there is
no shared layout, because one would wrap v1's page (`vitest "app/audit/[id]/audit-routes.test.tsx"`).

Real data has shapes no preview shows: no page fetched, a partial check, a withheld grade, text
without JavaScript not measured, no stored drawing, a re-check, fewer than three fixes. A property
test builds checks through the engine's builder from generated crawls and renders each view
(`vitest lib/v2/view/real-data.property.test.ts`); the named cases are in
`vitest "app/audit/[id]/_lib/real-data.test.tsx"`.

A failed check shows a sentence for its stored reason, from a table typed by `FailureReason`, so a
new reason without a sentence fails the typecheck (`app/audit/[id]/_lib/failure-copy.ts`).

Controls with no route in this step are not rendered on a real page: Share, Re-run, "Email this fix
to my developer", "What Pro includes". Their routes belong to later steps (D13).

## Progress (D5)

The stream sends the `ProgressEvent` contract of `lib/v2/progress.ts`. `stage`, `counts` and `ended`
come from the check's row; `page_fetched` and `page_linked` come from each stored crawl batch result.
No event is replayed from a recording or estimated.

- The stored progress names four phases. `without_js` and `grading` are closed by the stream only
  when the check has ended `finished` or `partial`: those two transitions are read from the final
  status, not observed while they happen.
- A fetched page whose stored row has no status or timing, or whose links were not read in full
  (`links_read` false, so `links_out` is not its count), cannot fill a `page_fetched` event and is
  not drawn; the screen says "The map shows N of the M pages fetched so far."
  `page_fetched.links` is the stored count of distinct links, where the contract's comment says
  repeats included.
- Budget, measured on contract-shaped batches at the 500-page cap (`vitest
lib/v2/pipeline/stream.budget.test.ts`, which prints the numbers): one batch result
  in memory at a time; a batch over 4 MiB gzipped or 16 MiB inflated is skipped and the stream
  carries steps and counts for it. Storage download time is not in the measurement.
- The route polls every 1.5 s with two requests (the check with its site, and the batches after
  the cursor), closes itself at 240 s inside a 300 s function
  limit, and resumes from `Last-Event-ID`; a cursor that does not parse answers 400. 120 opens an
  hour per address.
- The capability is checked when the stream opens and again when the site's account changes.

## Notify and cancel (D9)

Notify stores `checks.notify_email` while the check is queued, running or deferred, and emits
`check.notify_requested {checkId, siteId}` with no address. Nothing is sent to the address in this
step (CC-28). Limits are v1's numbers; the per-address bucket key holds a hash of the address.
Cancel sends `check.cancel.requested`, then fails the check `canceled` through the pipeline's
`failCheck`, and sends `check.failed` under the id the run's own handler uses. A deferred check
answers 409: `fail_check` moves queued and running checks.

## Keep, first audits, expiry (D7, D8)

Migration `20261111000001_v2_022b_public_checks.sql`: `checks.notify_email` and `checks.copied_for`,
neither granted to a client role (`vitest __tests__/v2-003-check-tables.test.ts -t "catalog
posture"`); `sites_unkept_idx`; seven functions, `security invoker`, executable by `service_role` (`vitest
__tests__/v2-022b-keep-expiry.test.ts`; `pnpm --filter @crawlmouse/scripts exec vitest run
db/rollback.test.ts db/check.test.ts`).

- Keep: the check's objects are named from its owner (`seeds`, `render`, `built`, `map`,
  `batch-N`), copied under the account, read back and compared, then `keep_check` takes the site,
  clears the expiry and rewrites the stored paths by explicit old/new pairs in one transaction, and
  the old objects are removed. `keep_check` refuses a check at or past `expires_at` on the
  database's clock. Before its first copy a claim records its account in `checks.copied_for`, so
  copies left by a Keep that did not commit are removed by the claim or by the daily run.
- First audits: a site named on Sign-up when it is attached, and a claimed site whose claimed check
  failed. One per site (`stableId('first_audit', siteId)`), counted against `global:audits:day` and
  the host's hourly bucket, skipped under `CRAWL_PAUSED` or with `V2_PIPELINE` off. A skipped one
  is not retried by this path.
- Expiry: `crawlmouse.check.expiry`, daily at 05:17 UTC, one run at a time. Step one deletes an
  unkept site, its checks' objects first, once it has a check and none that is unexpired at
  `now − 10 min`, without an expiry, or queued or running; the rest goes by the schema's cascades
  (`vitest lib/v2/pipeline/expire.test.ts -t cascade`). One site per delete statement, 50 sites a batch, 20 batches,
  120 s; a site whose delete fails is reported by id and counted as skipped, and what is left is
  reported. An unkept site with no check is deleted once it is older than 24 hours and 10 minutes.
  Step two moves kept checks' objects that are still under `anon/`. An anonymous result is
  therefore gone between about 24 and 48 hours after its request, when a run reaches it: a run
  deletes 1,000 sites at most, and the day's ceiling on starts is 5,000.

## Home (D10)

`middleware.ts` holds `V2_REWRITES`; with the flag set `/` is rewritten to `/v2-home`, a prerendered
page that renders the v2 home and main's three JSON-LD blocks under the root layout's title,
description, canonical and robots. A direct request to `/v2-home` answers the site's 404 with the
flag set or unset (`vitest middleware.test.ts`). `app/page.tsx` is main's file
(`git diff origin/main -- apps/web/app/page.tsx` prints nothing).

## Events (D12)

| Event            | Sent from                                                                                              | Properties                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `home_viewed`    | the v2 home, `track()`                                                                                 | —                                                                                                                                                   |
| `check_started`  | `POST /api/checks`, server                                                                             | `trigger`, `check_ref`                                                                                                                              |
| `check_finished` | the stream route, server, after the response; once per check per UTC day while the limiter can be read | `trigger`, `status`, `pages`, `durationMs`, `check_ref`, and for a graded check `seo` and `aiReadability` or `withheld`; read from the check's rows |
| `result_viewed`  | the overview of a ready check, `track()`                                                               | `variant`, `check_ref`                                                                                                                              |
| `fix_opened`     | a fix page, `track()`                                                                                  | `type`, `free`, `check_ref`                                                                                                                         |
| `keep_clicked`   | the Keep bar's submit, `track()`                                                                       | `from`, `check_ref`                                                                                                                                 |

Server events go through `captureServerEvent` (`lib/analytics-server.ts`): no person profile, no
GeoIP lookup, a 2-second bound on the send, and nothing sent unless `serverCaptureAllowed` reads consent from the request's
cookies. They name the check by `check_ref`, a hash of its id. Client events go through posthog-js,
which records the page URL as it does on v1's `/audit/[id]`.

## Before the flag is set

- `V2_PIPELINE` on first, with the worker's environment (CC-20b's checklist).
- CC-28 sending: the crawl screen says the result will be emailed, and this step stores the
  address and sends nothing.
- The privacy page's retention sentence (v1 audits 30 days; v2 checks 24 hours, then deleted at the
  next daily run).
- Migration 022b applied by the owner.

## Known gaps

- Concurrent progress streams are bounded by opens per address per hour (120) and each stream's
  240 s, not by a count of open streams; a stream opened with no cursor reads each stored batch.
- The expiry's delete carries its own `account_id is null`; the single-connection test database
  cannot run the interleaving that condition exists for.
- Storage's latency against the Keep's 8-second budget, and Storage's answer to removing a path
  that does not exist, are assumed, not measured.
- The engine's private-address test answers false for some IPv6 spellings that embed an IPv4
  address with a zero 16-bit half (`packages/engine/src/ssrf-guard.ts`). The host rule here refuses
  an IP literal, so the way in is a DNS record, as on v1.
- The v2 home emits the FAQ structured data and does not show the questions.
- A run of the expiry deletes 1,000 sites at most; a day with more expired sites than that leaves
  the rest for the next run. A site with very many rows may pass the database's statement timeout
  and be skipped each day; it is reported by id.
- After a Keep that did not commit, the claimer's account stays in `checks.copied_for` until the
  row goes, and stray copies on a site another account kept are looked for during three days.
- `check.finished` carries `accountId: null` for a check kept while it ran. Nothing reads the
  event today; CC-28's listener must read the owner from the database.
- `check_started` is not sent when the call that made the row failed to send its pipeline event
  and a retry started the run.
- The production wiring of the expiry function (`SERVICE_WIRING.expiry`, `lib/v2/pipeline/functions.ts`)
  is run by no test.

## Rulings recorded here

- The views' dataset type, `ViewDataset`, is defined in `lib/v2/fixtures.ts` (Q3).
- The result page of a kept site's re-check shows a changes door counted from that check's change
  rows (Q10).
- Two visitors' checks of one host can overlap; a per-host run guard belongs to the worker step (Q16).
- `templateNoun` names a template whose label is its key, which every measured check has
  (`lib/v2/format.ts`; rulings round 2, 0.3).
- A challenge of one crawler is worded from that crawler's rows, with the control fetch beside it
  (`lib/v2/view/segment/access.ts`; 0.4).
