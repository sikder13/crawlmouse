# Customer journeys

The CC-45 journeys (J0–J4, Free, Pro and Agency) as Playwright tests against a **deployed** base URL.
`STEPS.md` is the step list builders cite; `expected-fail.json` says which steps fail today and why.

## Run

```bash
cd tests/journeys
JOURNEY_BASE_URL=https://staging.crawlmouse.com ../../apps/web/node_modules/.bin/playwright test -c playwright.config.ts
```

| Variable                          | Meaning                                                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `JOURNEY_BASE_URL`                | Required. The deployment under test; https, or localhost.                                                                                                          |
| `JOURNEY_ALLOW_WRITES`            | `1` lets steps that write run, on staging only (below).                                                                                                            |
| `JOURNEY_SITE_ORIGIN`             | The site's canonical origin as the deployment states it (`NEXT_PUBLIC_BASE_URL`), for `robots.txt`, the sitemap and absolute menu links. Defaults to production's. |
| `JOURNEY_EXPECT_COMMIT`           | Optional. SMOKE.8 then requires `/api/health`'s commit to start with it.                                                                                           |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | The deployment's Protection Bypass for Automation secret, when it is behind Vercel Deployment Protection.                                                          |

`--project=desktop|phone|firefox` picks a device. Each journey step runs only on the devices its `STEPS.md`
row names; the SMOKE rows have no devices column and run on all three. `-g 'J0.9'` picks steps by id.
CI runs only the pure specs (`guard.spec.ts`, `consistency.spec.ts`), in the `test (scripts)` job; the
browser steps run against a deployment.

## Safety

- **Where a writing step runs.** A step that writes runs only:
  - on staging's host or the staging environment's Vercel alias (`WRITABLE_HOSTS` in `lib/target.ts`);
  - with `JOURNEY_ALLOW_WRITES=1`;
  - after the deployment proves its database. Its Content-Security-Policy, which the build writes from
    `NEXT_PUBLIC_SUPABASE_URL`, must name staging's database host exactly and must not name
    production's project.

  The host is an allowlist. Production under any spelling (`crawlmouse.com.`, the
  `crawlmouse-001.vercel.app` alias), every other Vercel deployment and localhost are read-only. A dev server can
  hold a copied `.env.local`, and an old preview can still hold production's database keys.

- **Whether a step writes is read from `STEPS.md`**, not declared by the spec. A Writes cell must start
  with "yes" or "no", and anything but exactly "no" counts as a write. J4 and J4.6 replay writes that
  must be refused, so they are writes.
- **Deployment Protection.** Before any step, `global-setup.ts` probes `/api/health`. If the deployment
  answers with a redirect to Vercel's sign-in, or a 401 or 403 from Vercel, the run stops with that
  reason unless `VERCEL_AUTOMATION_BYPASS_SECRET` is set. The secret is sent once per origin, on a request
  that does not follow redirects, to get Vercel's bypass cookie; the contexts carry that cookie, scoped
  to the deployment's host (`lib/protection.ts`). A run with the secret or with writes keeps no trace,
  because a trace records headers and URLs.
- **A step that starts a check passes the address through `lib/sites.ts`**, which accepts only
  `*.lab.crawlmouse.com` and `nahltech.com`.
- **Test accounts exist on staging only** (`lib/accounts.ts`). The admin client is built only when
  `SUPABASE_URL` is staging's project and `STAGING_PROJECT_REF` agrees; production's project is refused
  by name. Addresses are `qa+<journey>-<stamp>-<n>@lab.crawlmouse.com`. `signIn` goes through the product's
  own door (the link, then Continue) and throws unless the screen names that address. It asks for a link
  only after the target passes the write guard and shows staging's database.
- **The guard is tested.** `guard.spec.ts` varies what each rule reads: case, trailing dots, ports,
  userinfo, aliases, look-alike hosts and look-alike database hosts. CI enforces the spec; the pinned
  check is `pnpm --filter @crawlmouse/web exec vitest run __tests__/security/ci-workflow.test.ts`.

## Expected-fail

- **Labelled assertions.** An assertion that encodes a registered defect names its id in its message,
  for example `F-007: /pricing is not inside the v2 shell (a v1 page)`. It names the id only when the
  page shows that defect's own symptom:
  - a status label carries the exact status CC-45 saw (`/agencies` 404);
  - a "v1 page" label needs the v1 layout's cream marker.

  When a step fails with a message naming one of the ids `expected-fail.json` lists for it,
  `lib/step.ts` records an expected failure.

- **Everything else fails red.** That covers:
  - a failure that names none of the listed ids, such as a 500 where CC-45 saw a 404, a blank page, an
    unexplained entry or a new break;
  - a soft assertion;
  - a step that passes while ids are still listed.

  J0.2 sees all its causes at once, so it also fails red on any listed id it no longer sees. A step
  that stops at its first failure cannot tell which of its later ids are fixed; those are deleted when
  the step passes.

- **A PR that fixes a defect** deletes that id from `expected-fail.json`. It edits nothing else there.
- **Judged ids.** Some ids a test cannot observe: positioning, legal wording, a published address.
  `STEPS.md` marks them "(judged)" and leaves them out of `expected-fail.json`, parent steps included.
  The gate checks them by hand.
- **Consistency.** `consistency.spec.ts` keeps `expected-fail.json` inside `STEPS.md`:
  - every key is a step;
  - every id is in that step's row and in the defect index;
  - a defect-named step (`D.F-nnn`) lists exactly its own defect.

  A spec that names a step id `STEPS.md` does not list fails at collection.

- **Where the lists come from.** `tools/steps.py` generates `STEPS.md` and `expected-fail.json` from
  the CC-45 register:

  ```bash
  python3 tests/journeys/tools/steps.py <path to cc-45/sweep.md> tests/journeys/STEPS.md
  ```

  The register lives in the plan folder, outside this repository. Re-run it only to rebuild the lists
  from a changed register.

## What is automated today

For the list:

```bash
JOURNEY_BASE_URL=https://crawlmouse.com ../../apps/web/node_modules/.bin/playwright test -c playwright.config.ts --project=desktop --list
```

Besides the pure guard and consistency tests, that lists the read-only steps SMOKE.1, 6, 7 and 8,
J0.1, J0.2, and J0.9a–m. Every other step in `STEPS.md` is written but not yet
automated. Steps that write wait for staging.

## What it cannot see

- **Judgement.** A test checks what can be asserted: status, the v2 shell, the absence of a known-wrong
  sentence. It does not judge whether a page reads well, and it does not check judged ids. The gate's
  verdict (`gate/<pr>.md` in the QA folder) does both by hand.
- **The first failure only.** A step stops at its first failing assertion. While F-006 holds,
  J0.9g/i/j's own content checks (F-063, F-032, F-031) are not reached.
- **Email inboxes.** Mail steps assert the send, not the inbox, until staging has a test inbox.
- **Interactive bot checks.** Turnstile and the Vercel checkpoint are never solved. Staging uses
  Cloudflare's test keys.
- **WebKit.** `STEPS.md` names it for J0, but this machine lacks its system libraries, so there is no
  WebKit project.
- **"Finished v2 page" is read from markers:** `[data-v2-shell]` present and `[data-v2-kept]` absent.
  A page that renders v1 markup inside the v2 shell without the kept marker would pass.

These files import Playwright through `pw.ts`, as `tests/visual` does, and like it they are not
type-checked by CI.
