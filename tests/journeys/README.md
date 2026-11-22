# Customer journeys

The CC-45 journeys (J0–J4, Free, Pro and Agency) as Playwright tests against a **deployed** base URL.
`STEPS.md` is the step list builders cite; `expected-fail.json` says which steps fail today and why.

## Run

```bash
cd tests/journeys
JOURNEY_BASE_URL=https://staging.crawlmouse.com ../../apps/web/node_modules/.bin/playwright test -c playwright.config.ts
```

| Variable                | Meaning                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `JOURNEY_BASE_URL`      | Required. The deployment under test; https, or localhost.                                                                                                          |
| `JOURNEY_ALLOW_WRITES`  | `1` lets steps that write run, on staging's host only (below).                                                                                                     |
| `JOURNEY_SITE_ORIGIN`   | The site's canonical origin as the deployment states it (`NEXT_PUBLIC_BASE_URL`), for `robots.txt`, the sitemap and absolute menu links. Defaults to production's. |
| `JOURNEY_EXPECT_COMMIT` | Optional. SMOKE.8 then requires `/api/health`'s commit to start with it.                                                                                           |

`--project=desktop|phone|firefox` picks a device; each step runs only on the devices its `STEPS.md` row
names. `-g 'J0.9'` picks steps by id. CI runs only the pure specs (`guard.spec.ts`,
`consistency.spec.ts`), in the `test (scripts)` job; the browser steps run against a deployment.

## Safety

- **A step that writes runs only on staging's own host** (`WRITABLE_HOSTS` in `lib/target.ts`), and only
  with `JOURNEY_ALLOW_WRITES=1`. It is an allowlist: production under any spelling (`crawlmouse.com.`,
  the `crawlmouse-001.vercel.app` alias), every Vercel preview, and localhost are read-only. A dev
  server can hold a copied `.env.local`, and an old preview can still hold production's database keys.
  Whether a step writes is read from `STEPS.md`, not declared by the spec.
- **A step that starts a check passes the address through `lib/sites.ts`**, which accepts only
  `*.lab.crawlmouse.com` and `nahltech.com`.
- `guard.spec.ts` varies the spellings each rule reads: case, trailing dots, ports, userinfo, aliases,
  look-alike hosts. Each refusal in `lib/target.ts` and the rule in `lib/sites.ts` has been removed in
  turn and turned the spec red. CI enforces the spec: the pinned check is
  `pnpm --filter @crawlmouse/web exec vitest run __tests__/security/ci-workflow.test.ts`.

## Expected-fail

- **Labelled assertions.** An assertion that encodes a registered defect names its id in its message,
  for example `F-007: /pricing is inside the v2 shell`. When a step fails with a message naming one of
  the ids `expected-fail.json` lists for it, `lib/step.ts` records an expected failure.
- **Everything else fails red.** That covers a failure that names none of the listed ids, such as a
  page answering 500, an unexplained entry or a new break. It also covers a step that passes while ids
  are still listed. An old defect never hides a new one, and a fixed id cannot stay listed.
- **A PR that fixes a defect** deletes that id from `expected-fail.json`. It edits nothing else there.
- **Judged ids.** Some ids a test cannot observe: positioning, legal wording, a published address.
  `STEPS.md` marks them "(judged)" and leaves them out of `expected-fail.json`. The gate checks them by
  hand.
- **Consistency.** `consistency.spec.ts` keeps `expected-fail.json` inside `STEPS.md`: every key is a
  step, and every id is in that step's row and in the defect index. A spec that names a step id
  `STEPS.md` does not list fails at collection.
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

Today that is the read-only steps SMOKE.1, 6, 7 and 8, J0.2, and J0.9a–l (J0.9m is not yet automated).
Every other step in `STEPS.md` is written but not yet automated. Steps that write wait for staging.

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
- **"Finished v2 page" is read from markers:** `[data-v2-shell]` present and `[data-v2-kept]` absent. A
  page that renders v1 markup inside the v2 shell without the kept marker would pass.

These files import Playwright through `pw.ts`, as `tests/visual` does, and like it they are not
type-checked by CI.
