# Customer journeys

The CC-45 journeys (J0–J4, Free, Pro and Agency) as Playwright tests against a **deployed** base URL.
`STEPS.md` is the step list builders cite. `expected-fail.json` says which steps fail today and why.

## Run

```bash
cd tests/journeys
JOURNEY_BASE_URL=https://staging.crawlmouse.com ../../apps/web/node_modules/.bin/playwright test -c playwright.config.ts
```

| Variable                | Meaning                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `JOURNEY_BASE_URL`      | Required. The deployment under test; https, or localhost.                                                                                     |
| `JOURNEY_WRITE_HOSTS`   | Comma-separated hosts a run may write to. No default.                                                                                         |
| `JOURNEY_ALLOW_WRITES`  | `1` to let steps that write run on a declared host.                                                                                           |
| `JOURNEY_SITE_ORIGIN`   | The site's canonical origin as the deployment states it (`NEXT_PUBLIC_BASE_URL`), for `robots.txt` and the sitemap. Defaults to production's. |
| `JOURNEY_EXPECT_COMMIT` | Optional. SMOKE.8 requires `/api/health` to report a commit starting with it.                                                                 |

`--project=desktop|phone|firefox` picks a device. `-g 'J0.9'` picks steps by id.

## Safety

- **A step that writes runs only where `lib/target.ts` allows.** The host must not be production, it
  must be listed in `JOURNEY_WRITE_HOSTS`, and `JOURNEY_ALLOW_WRITES=1` must be set. Otherwise the
  step is skipped, with the reason. `guard.spec.ts` tests this rule, and each of its four refusals (production host, a declaration naming production, an undeclared host, `JOURNEY_ALLOW_WRITES` not `1`)
  has been shown to fail its test when removed.
- **Do not declare a preview writable while previews hold production's database keys.** They do today
  (QA `questions/001-staging.md`).
- Checks run only against `*.lab.crawlmouse.com` and `nahltech.com`.

## Expected-fail

`lib/step.ts` reads a step's ids from `expected-fail.json` and marks the test `test.fail`. So a step
that is fixed but still listed fails the run ("expected to fail, but passed"). That is the signal to
delete the ids in the PR that fixes them. `consistency.spec.ts` keeps the file's keys and ids inside
what `STEPS.md` lists.

`STEPS.md` and `expected-fail.json` are generated from the CC-45 register by the QA session's
generator (plan folder `v2r/qa/tools/steps.py`). Builders edit only `expected-fail.json`, and only to
delete the ids their PR fixes.

## What is automated today

For the list, run:

```bash
JOURNEY_BASE_URL=https://crawlmouse.com ../../apps/web/node_modules/.bin/playwright test -c playwright.config.ts --project=desktop --list
```

The specs today hold the read-only steps: SMOKE.1, 6, 7, 8; J0.2; and J0.9a–l (J0.9m is not yet
automated). Every other step in `STEPS.md` is written, not yet automated. Steps that write wait for
staging.

## What it cannot see

- **Judgement.** A test checks what can be asserted: status, the v2 shell, the absence of a known-wrong
  sentence. It does not judge whether a page reads well. The gate's verdict (`gate/<pr>.md`) does that
  by hand.
- **Email inboxes.** Mail steps assert the send, not the inbox, until staging has a test inbox.
- **Interactive bot checks.** Turnstile and the Vercel checkpoint are never solved. Staging uses
  Cloudflare's test keys.
- **What "finished v2 page" means.** It is read from markers: `[data-v2-shell]`, no `[data-v2-planned]`
  in `main`, no `[data-v2-kept]`. A page that renders v1 markup inside a v2 shell without those markers
  would pass.

These files import Playwright through `pw.ts`, as `tests/visual` does, and like it they are not
type-checked by CI.
