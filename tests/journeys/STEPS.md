# Journey steps — the ids builders cite

This is the step list for `tests/journeys/`. Each step is named by its CC-45 step number (CC-45 brief §5),
so a builder can write "closes J0.5b" in a PR. Where one CC-45 step covers several screens, QA added lettered
sub-steps (J0.5a–i, J0.8a–i, J0.9a–m, J1.12a–b, J2.4a–h) and numbered J4's parts (J4.1–J4.7); a defect the
register files under a parent step is placed on the sub-step CC-45's scorecard names, and a parent's list is
the union of its sub-steps. A step passes when a customer would get what the screen promised, in the time it
promised, on the devices listed.

**Generated, not hand-written.** The "Expected to fail today" column and the defect index at the end are computed
from the CC-45 register (`cc-45/sweep.md` §1, its "Step or stream" column) by `tools/steps.py`, then formatted by Prettier. Rows the
register names by stream only get a defect-named step, `D.F-nnn`, checked by a dedicated test. Re-generate when the
register changes; do not edit the columns by hand.

**Expected-fail.** `expected-fail.json` holds, for each step, the ids its test can observe; it is generated with
this file and it is the only list a test reads (`lib/step.ts`). Ids marked "(judged)" here are checked by hand at the
gate, not by the test. A step's test fails red when it passes while ids are still listed, and when it fails for a
reason that names none of its listed ids. A PR that fixes a defect deletes that id from `expected-fail.json`. This
file's column stays as CC-45 found it.

**Writes.** A step whose cell is anything but exactly "no" is treated as writing: it changes data (a check, an
account, a mail), needs a check it starts itself, or sends writes that must be refused. `lib/target.ts` runs such
a step only on staging's host, and only after the deployment's own headers show staging's database; never on
production, a Vercel preview or localhost. Steps marked "no" may run anywhere.

**Sites checked.** Only `*.lab.crawlmouse.com` and `nahltech.com`: `lib/sites.ts` refuses any other host for a step
that starts a check.

## J0 — Visitor who never signs up

Account: anonymous.

| Step  | The customer                                                                 | Passes when                                                                                 | Devices                         | Writes | Expected to fail today                                                                                                                                                                                                                |
| ----- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| J0.1  | Land on the home page; read it top to bottom                                 | In five seconds it is clear what this is, who it is for and what it costs                   | desktop, phone, Firefox, WebKit | no     | F-060, F-061 (judged), F-062 (judged), F-146                                                                                                                                                                                          |
| J0.2  | Use every header and footer entry once                                       | Every entry opens a finished v2 page (200, v2 shell)                                        | desktop, phone, Firefox, WebKit | no     | F-005, F-006, F-007, F-025, F-027                                                                                                                                                                                                     |
| J0.3  | Start a check from the home form on a lab site                               | A check starts and the live page opens                                                      | desktop, phone, Firefox, WebKit | yes    | —                                                                                                                                                                                                                                     |
| J0.4  | Watch the live page from start to finish without touching it                 | Progress is visible within 5 s, keeps moving, the graph draws, and the result opens         | desktop, phone, Firefox         | yes    | F-002, F-009                                                                                                                                                                                                                          |
| J0.5  | Read the result: every card, every tab, the fix, the link map                | Each part below reads true for the site checked                                             | desktop, phone, Firefox         | yes    | F-004, F-012, F-020, F-021, F-022, F-023, F-057, F-135, F-137, F-138, F-139, F-140, F-141, F-142, F-143, F-144, F-145, F-146, F-148, F-149, F-150, F-151, F-152, F-153, F-155, F-156, F-159, F-160, F-161, F-162 (with its sub-steps) |
| J0.5a | Overview: the door, every card, the grade or the honest withheld state       | Every sentence is true of what was measured                                                 | desktop, phone                  | yes    | F-012, F-020, F-057, F-138, F-139, F-140, F-142, F-145, F-159, F-160                                                                                                                                                                  |
| J0.5b | Crawler access tab                                                           | Each crawler row says what we sent, from where, and what it proves; three states, never two | desktop, phone                  | yes    | F-023, F-135, F-137, F-138, F-141, F-143, F-144, F-145, F-149, F-150, F-152, F-153, F-155, F-156                                                                                                                                      |
| J0.5c | Without JavaScript tab                                                       | A words-without-JavaScript figure, or a stated reason it was not measured                   | desktop, phone                  | yes    | F-012                                                                                                                                                                                                                                 |
| J0.5d | Structure tab                                                                | Orphans, depth and structure fixes match the crawl                                          | desktop, phone                  | yes    | —                                                                                                                                                                                                                                     |
| J0.5e | Content tab                                                                  | Content checks shown or honestly not applicable                                             | desktop, phone                  | yes    | —                                                                                                                                                                                                                                     |
| J0.5f | Signals tab                                                                  | Signals shown with their source                                                             | desktop, phone                  | yes    | —                                                                                                                                                                                                                                     |
| J0.5g | Changes tab                                                                  | A first check says nothing is compared yet; a second lists real changes                     | desktop, phone                  | yes    | —                                                                                                                                                                                                                                     |
| J0.5h | Open a fix fully                                                             | The fix, its packet and its title are true and usable                                       | desktop, phone                  | yes    | F-021, F-148, F-149, F-151, F-162                                                                                                                                                                                                     |
| J0.5i | Link map: hover, click, zoom, list view, search                              | The graph draws, labels show, keys work, list and search agree                              | desktop, phone                  | yes    | F-004, F-022, F-146, F-161                                                                                                                                                                                                            |
| J0.6  | "Email me the result" on a second check; follow the email back               | The mail arrives and its link opens the result                                              | desktop                         | yes    | F-042                                                                                                                                                                                                                                 |
| J0.7  | Return to the result link later                                              | It says how long it is kept and what to do next                                             | desktop, phone                  | no     | —                                                                                                                                                                                                                                     |
| J0.8  | Give it bad input (a–i below)                                                | Each ends in a clear message                                                                | desktop, phone                  | yes    | F-013, F-014, F-015, F-054, F-055 (with its sub-steps)                                                                                                                                                                                |
| J0.8a | An empty box                                                                 | A clear message, no check                                                                   | desktop, phone                  | no     | —                                                                                                                                                                                                                                     |
| J0.8b | `not a url`                                                                  | A clear message, no check                                                                   | desktop, phone                  | no     | —                                                                                                                                                                                                                                     |
| J0.8c | A site that does not exist                                                   | A clear "could not reach" result, not an all-clear                                          | desktop                         | yes    | F-015                                                                                                                                                                                                                                 |
| J0.8d | `localhost`                                                                  | A clear refusal, no check                                                                   | desktop, phone                  | no     | —                                                                                                                                                                                                                                     |
| J0.8e | A lab site that blocks crawlers                                              | The result says what each crawler got back                                                  | desktop                         | yes    | F-014                                                                                                                                                                                                                                 |
| J0.8f | A JavaScript-only lab site                                                   | The result says the content needs JavaScript                                                | desktop                         | yes    | F-013                                                                                                                                                                                                                                 |
| J0.8g | A slow lab site                                                              | The check finishes inside its stated time, with progress throughout                         | desktop                         | yes    | —                                                                                                                                                                                                                                     |
| J0.8h | The same site twice in a row                                                 | The second start is explained (reused or refused)                                           | desktop                         | yes    | F-054                                                                                                                                                                                                                                 |
| J0.8i | Cancel a running check                                                       | The cancel is confirmed and the page says what happened                                     | desktop                         | yes    | F-055                                                                                                                                                                                                                                 |
| J0.9  | Open each named page (a–m below)                                             | Each is a finished v2 page                                                                  | desktop, phone, Firefox         | no     | F-005, F-006, F-007, F-024, F-026, F-027, F-031, F-032, F-033 (judged), F-063, F-072 (judged), F-153 (judged), F-154 (judged), F-158 (with its sub-steps)                                                                             |
| J0.9a | `/pricing`                                                                   | v2 pricing, numbers from the code                                                           | desktop, phone                  | no     | F-007                                                                                                                                                                                                                                 |
| J0.9b | `/agencies`, `/agency-trial`                                                 | v2 agency offer                                                                             | desktop, phone                  | no     | F-024                                                                                                                                                                                                                                 |
| J0.9c | `/help`                                                                      | v2 help                                                                                     | desktop                         | no     | —                                                                                                                                                                                                                                     |
| J0.9d | `/guides`                                                                    | v2 guides                                                                                   | desktop, phone                  | no     | F-006, F-072 (judged)                                                                                                                                                                                                                 |
| J0.9e | A blog post                                                                  | v2 post                                                                                     | desktop, phone                  | no     | F-006, F-072 (judged)                                                                                                                                                                                                                 |
| J0.9f | The research page                                                            | v2 page                                                                                     | desktop                         | no     | F-006                                                                                                                                                                                                                                 |
| J0.9g | `/status`                                                                    | v2 status with a real state                                                                 | desktop                         | no     | F-006, F-063                                                                                                                                                                                                                          |
| J0.9h | `/developers`                                                                | v2 developers page                                                                          | desktop                         | no     | F-027                                                                                                                                                                                                                                 |
| J0.9i | `/ai-readiness-checker`                                                      | v2 page                                                                                     | desktop                         | no     | F-006, F-032                                                                                                                                                                                                                          |
| J0.9j | `/bot`                                                                       | v2 page describing exactly what we send, with the published address                         | desktop                         | no     | F-006, F-031, F-153 (judged), F-154 (judged)                                                                                                                                                                                          |
| J0.9k | Every legal page (privacy, terms, AUP, subprocessors, refunds, DPA, cookies) | v2 pages; none missing                                                                      | desktop                         | no     | F-005, F-006, F-033 (judged)                                                                                                                                                                                                          |
| J0.9l | An address that does not exist                                               | v2 404                                                                                      | desktop, phone                  | no     | F-026                                                                                                                                                                                                                                 |
| J0.9m | `/check/gptbot`, `/check/javascript`, `/check/robots-ai`                     | A real result for the visitor's site, or copy that says it starts an audit                  | desktop                         | no     | F-158                                                                                                                                                                                                                                 |

## J1 — Free customer, beginning to end

Account: a new Free account.

| Step   | The customer                                                                                     | Passes when                                                                | Devices        | Writes | Expected to fail today            |
| ------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | -------------- | ------ | --------------------------------- |
| J1.1   | J0 steps 1–5 on one site                                                                         | As J0.1–J0.5                                                               | desktop, phone | yes    | F-098, F-112, F-113               |
| J1.2   | Keep the result with an email address                                                            | The keep form works without an interactive challenge                       | desktop, phone | yes    | F-102, F-116                      |
| J1.3   | Open the sign-in email; judge it; follow it                                                      | A v2 email; one Continue; signed in                                        | desktop        | yes    | F-003                             |
| J1.4   | Signed in: the site just checked is in the dashboard with its result                             | The kept check is the person's site                                        | desktop, phone | no     | —                                 |
| J1.5   | From the dashboard open the site, the result, each tab, each fix; one fix fully                  | All open, tables fit, numbers formatted                                    | desktop, phone | no     | F-129                             |
| J1.6   | Go home signed in; start a check from the home form                                              | The header knows the person; the check belongs to their account            | desktop, phone | yes    | F-001, F-008                      |
| J1.7   | Add a second site on Free                                                                        | The limit is explained with a clear way to upgrade (v2 pricing)            | desktop, phone | yes    | —                                 |
| J1.8   | Visit every dashboard menu item and setting                                                      | Each opens; locked features say why and how to unlock                      | desktop, phone | no     | F-129                             |
| J1.9   | Theme: System, Light, Dark on the dashboard and on a result                                      | Both follow the choice and keep it                                         | desktop, phone | yes    | F-101                             |
| J1.10  | Run a second check of the same site; read Changes                                                | Changes lists what changed and agrees with the rail                        | desktop        | yes    | F-114, F-147                      |
| J1.11  | Share or publish the report if Free allows; open the public link signed out                      | The offer is clear; a link opens signed out                                | desktop        | yes    | F-123                             |
| J1.12  | Sign out; sign in again from `/login` and once from `/signup` with the same address              | Sign-out exists and confirms; both sign-ins work without an edge challenge | desktop        | yes    | F-128, F-132 (with its sub-steps) |
| J1.12a | Sign out                                                                                         | A sign-out in v2, with a "signed out" note                                 | desktop        | yes    | F-128, F-132                      |
| J1.12b | Sign in from `/login`, then from `/signup`                                                       | Both reach the dashboard                                                   | desktop        | yes    | —                                 |
| J1.13  | Unsubscribe through an email's link; Settings agrees                                             | The link works and Settings shows it off                                   | desktop        | yes    | —                                 |
| J1.14  | Delete the account; confirm; restore inside the window; delete again; sign-in no longer finds it | Each step does what it says                                                | desktop        | yes    | F-131                             |

## J2 — Pro customer, beginning to end

Account: a new account on the Pro trial; seeded `+pro`, `+protrial` on staging.

| Step  | The customer                                                                                                | Passes when                                                                              | Devices | Writes | Expected to fail today                                                                                  |
| ----- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------- | ------ | ------------------------------------------------------------------------------------------------------- |
| J2.1  | A new person: J1 steps 1–4                                                                                  | As J1.1–J1.4                                                                             | desktop | yes    | F-102, F-116, F-117                                                                                     |
| J2.2  | Start the 14-day Pro trial from inside the product                                                          | What you get, for how long and what happens at the end are clear                         | desktop | yes    | F-103                                                                                                   |
| J2.3  | Add sites up to the limit (5), each with its first check; try a sixth; a check reads up to the plan's pages | Five run; the sixth is refused with a clear message; a Pro check reads up to 2,000 pages | desktop | yes    | F-094, F-118, F-157                                                                                     |
| J2.4  | Use every feature the pricing and sign-up pages promise for Pro (a–i below)                                 | Each works as promised                                                                   | desktop | yes    | F-012, F-016, F-096, F-097, F-099, F-107, F-109, F-115, F-121, F-125, F-126, F-136 (with its sub-steps) |
| J2.4a | Weekly checks                                                                                               | Each site shows weekly and the next date                                                 | desktop | no     | F-115                                                                                                   |
| J2.4b | Every fix with its packet (open three, copy one)                                                            | Packets open and copy                                                                    | desktop | no     | F-099                                                                                                   |
| J2.4c | Send one fix to a developer by email                                                                        | A control exists and the mail is sent                                                    | desktop | yes    | F-109                                                                                                   |
| J2.4d | Alerts and each integration, as far as the screen allows                                                    | Rules save; integrations open a page                                                     | desktop | yes    | F-016, F-121, F-136                                                                                     |
| J2.4e | One competitor                                                                                              | The competitor is audited and compared                                                   | desktop | yes    | F-016, F-096                                                                                            |
| J2.4f | Every export (PDF, CSV, JSON, link-map CSV); open each file                                                 | Each file is made and opens                                                              | desktop | yes    | F-107, F-125, F-126                                                                                     |
| J2.4g | Staging audits                                                                                              | The staging URL is audited                                                               | desktop | yes    | F-097                                                                                                   |
| J2.4h | Every page measured for Without JavaScript                                                                  | Pages carry a measured figure                                                            | desktop | yes    | F-012                                                                                                   |
| J2.4i | Daily watch: a crawler newly blocked                                                                        | One full check and one alert the same day                                                | desktop | yes    |                                                                                                         |
| J2.5  | Second check on one site; read Changes and any alert it should cause                                        | Changes is right; a due alert is sent                                                    | desktop | yes    | F-100, F-110, F-136                                                                                     |
| J2.6  | Reports: create, schedule, send; judge the report and its email                                             | Each works or is clearly not on this plan                                                | desktop | yes    | F-122                                                                                                   |
| J2.7  | Open the plan and billing screens with billing off                                                          | They say exactly what applies with billing off                                           | desktop | no     | F-108, F-119                                                                                            |
| J2.8  | J1 steps 8, 9, 12 and 13 again as Pro                                                                       | As J1.8, J1.9, J1.12, J1.13                                                              | desktop | yes    | F-016, F-101                                                                                            |
| J2.9  | Seeded `+protrial`: start its trial; seeded `+pro`: what plan and what it can do                            | Each matches the seed                                                                    | desktop | yes    | F-095, F-102, F-118, F-120                                                                              |

## J3 — Agency customer, beginning to end

Account: a new Agency trial; seeded `+agency`, `+agency-dev`, `+agencytrial`, `+demo` on staging.

| Step | The customer                                                                                        | Passes when                                                | Devices | Writes | Expected to fail today                   |
| ---- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------- | ------ | ---------------------------------------- |
| J3.1 | Start from the agencies page as a new person; start the agency trial                                | The offer is clear; the trial starts                       | desktop | yes    | F-024, F-094, F-098, F-102, F-104, F-117 |
| J3.2 | Set up the agency: name and brand                                                                   | Both save and show                                         | desktop | yes    | F-105, F-106, F-119                      |
| J3.3 | Add five client sites (`client-*.lab.crawlmouse.com`), each with its first check; where is 25 shown | All five run; the 25-site limit is shown in the add flow   | desktop | yes    | F-094, F-104, F-106                      |
| J3.4 | Invite a team member; judge the invite email; accept it in a separate context                       | The member sees and does what the role allows              | desktop | yes    | F-106, F-111                             |
| J3.5 | Change the member's role; remove the member                                                         | Access ends at once                                        | desktop | yes    | F-106                                    |
| J3.6 | Client reports under the agency's brand: create, public link signed out, send, schedule             | Crawlmouse's name is gone wherever white-label is promised | desktop | yes    | F-106                                    |
| J3.7 | J2 steps 4–6 on a client site                                                                       | As J2.4–J2.6                                               | desktop | yes    | F-016, F-099, F-100, F-113, F-123        |
| J3.8 | Plan, seats and billing screens: extra seats, extra sites                                           | They say what applies                                      | desktop | no     | F-094, F-106, F-108                      |
| J3.9 | Seeded `+agency`, `+agency-dev`, `+agencytrial`, `+demo`                                            | Each dashboard matches the seed                            | desktop | no     | F-095, F-102, F-105, F-115, F-124        |

## J4 — Somebody else's data

Account: two accounts A and B, A's removed member, a user with no v2 account, signed out.

| Step | The customer                                                                                                                                                                                  | Passes when                                                                                                           | Devices | Writes                                     | Expected to fail today                                 |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------ | ------------------------------------------------------ |
| J4   | Every address and request of A tried as B, as A's removed member, signed in with no v2 account (a user with no active seat) and signed out; ids changed in addresses and bodies               | Nothing private shown or changed; a refused id and a missing id get the same answer, so neither reveals the id exists | desktop | yes (it sends writes that must be refused) | F-127, F-130, F-133, F-134, F-163 (with its sub-steps) |
| J4.1 | A's site pages (incl. staging)                                                                                                                                                                | B 404 / signed out to sign-in                                                                                         | desktop | yes (it creates test accounts)             | —                                                      |
| J4.2 | A's kept results: every tab, map, fixes, checks                                                                                                                                               | The one 404 page a missing id gets, offering sign-in; nothing shows the id exists                                     | desktop | yes (it creates test accounts)             | F-127                                                  |
| J4.3 | A's changes, alerts, reports, settings, plan, delete, seats, agency, billing                                                                                                                  | B sees only its own account                                                                                           | desktop | yes (it creates test accounts)             | F-130                                                  |
| J4.4 | Export files and fix packets; email-developer                                                                                                                                                 | 404 / 401                                                                                                             | desktop | yes (it creates test accounts)             | —                                                      |
| J4.5 | Share links and report pages                                                                                                                                                                  | Open only what was shared; no pivot                                                                                   | desktop | yes (it creates test accounts)             | F-134                                                  |
| J4.6 | Every API call in A's network log, replayed as B, signed out, and signed in with no v2 account (a user with no active seat), with ids changed; each also with a random id that does not exist | Refused; no write crosses accounts; an existing private id and a missing id answer the same status and body           | desktop | yes (it replays writes)                    | F-163                                                  |
| J4.7 | v1 API routes                                                                                                                                                                                 | 410 or refused                                                                                                        | desktop | yes (it creates test accounts)             | F-133                                                  |

## SMOKE — run on every gate

| Step    | What                                  | Passes when                             | Writes |
| ------- | ------------------------------------- | --------------------------------------- | ------ |
| SMOKE.1 | Home                                  | `/` answers 200 with the v2 page        | no     |
| SMOKE.2 | A check start to finish on a lab site | Finishes; result opens                  | yes    |
| SMOKE.3 | Sign-in                               | A staging account reaches its dashboard | yes    |
| SMOKE.4 | The dashboard                         | Loads with the account's sites          | no     |
| SMOKE.5 | A result with all tabs                | Every tab answers 200                   | no     |
| SMOKE.6 | `robots.txt`                          | Matches the pinned document             | no     |
| SMOKE.7 | The sitemap                           | Answers and lists the pinned URLs       | no     |
| SMOKE.8 | `/api/health`                         | `{ ok: true }` with the expected commit | no     |

## D — defects with no journey step

66 register rows name a stream, not a journey step. Each, except a judged id, gets a dedicated test named `D.F-nnn`, written by
the session that fixes it (RULES §3 step 2), under `tests/journeys/d/`.

D.F-010, D.F-011, D.F-017, D.F-018, D.F-019, D.F-028, D.F-029, D.F-030, D.F-034, D.F-035, D.F-036, D.F-037, D.F-038, D.F-039, D.F-040, D.F-041, D.F-043, D.F-044, D.F-045, D.F-046, D.F-047, D.F-048, D.F-049, D.F-050, D.F-051, D.F-052, D.F-053, D.F-056, D.F-058, D.F-059, D.F-064, D.F-065, D.F-066, D.F-067, D.F-068, D.F-069, D.F-070, D.F-071, D.F-073, D.F-074, D.F-075, D.F-076, D.F-077, D.F-078, D.F-079, D.F-080, D.F-081, D.F-082, D.F-083, D.F-084, D.F-085, D.F-086, D.F-087, D.F-088, D.F-089, D.F-090, D.F-091, D.F-092, D.F-093, D.F-164, D.F-165, D.F-166, D.F-167, D.F-168, D.F-169, D.F-170

Judged, so checked by hand at the gate and absent from `expected-fail.json`: D.F-050 (F-050, judged).

### D steps that write nothing

A D step counts as writing, and runs only on staging, unless this table says exactly `no`. The session that writes
the test asks QA to list it here.

| Step    | Writes |
| ------- | ------ |
| D.F-045 | no     |
| D.F-048 | no     |
| D.F-049 | no     |
| D.F-067 | no     |
| D.F-088 | no     |

## Defect index

Every register row and the steps that prove it closed.

| Defect | Sev     | Steps                                                 |
| ------ | ------- | ----------------------------------------------------- |
| F-001  | blocker | J1.6                                                  |
| F-002  | major   | J0.4                                                  |
| F-003  | major   | J1.3                                                  |
| F-004  | major   | J0.5i                                                 |
| F-005  | major   | J0.2, J0.9k                                           |
| F-006  | major   | J0.2, J0.9d, J0.9e, J0.9f, J0.9g, J0.9i, J0.9j, J0.9k |
| F-007  | blocker | J0.2, J0.9a                                           |
| F-008  | major   | J1.6                                                  |
| F-009  | major   | J0.4                                                  |
| F-010  | major   | D.F-010                                               |
| F-011  | major   | D.F-011                                               |
| F-012  | blocker | J0.5a, J0.5c, J2.4h                                   |
| F-013  | blocker | J0.8f                                                 |
| F-014  | blocker | J0.8e                                                 |
| F-015  | blocker | J0.8c                                                 |
| F-016  | blocker | J2.4d, J2.4e, J2.8, J3.7                              |
| F-017  | blocker | D.F-017                                               |
| F-018  | major   | D.F-018                                               |
| F-019  | major   | D.F-019                                               |
| F-020  | major   | J0.5a                                                 |
| F-021  | major   | J0.5h                                                 |
| F-022  | major   | J0.5i                                                 |
| F-023  | major   | J0.5b                                                 |
| F-024  | blocker | J0.9b, J3.1                                           |
| F-025  | major   | J0.2                                                  |
| F-026  | major   | J0.9l                                                 |
| F-027  | major   | J0.2, J0.9h                                           |
| F-028  | major   | D.F-028                                               |
| F-029  | major   | D.F-029                                               |
| F-030  | major   | D.F-030                                               |
| F-031  | major   | J0.9j                                                 |
| F-032  | major   | J0.9i                                                 |
| F-033  | major   | J0.9k                                                 |
| F-034  | major   | D.F-034                                               |
| F-035  | major   | D.F-035                                               |
| F-036  | major   | D.F-036                                               |
| F-037  | major   | D.F-037                                               |
| F-038  | major   | D.F-038                                               |
| F-039  | major   | D.F-039                                               |
| F-040  | major   | D.F-040                                               |
| F-041  | major   | D.F-041                                               |
| F-042  | major   | J0.6                                                  |
| F-043  | major   | D.F-043                                               |
| F-044  | major   | D.F-044                                               |
| F-045  | major   | D.F-045                                               |
| F-046  | major   | D.F-046                                               |
| F-047  | major   | D.F-047                                               |
| F-048  | blocker | D.F-048                                               |
| F-049  | major   | D.F-049                                               |
| F-050  | major   | D.F-050                                               |
| F-051  | major   | D.F-051                                               |
| F-052  | major   | D.F-052                                               |
| F-053  | minor   | D.F-053                                               |
| F-054  | minor   | J0.8h                                                 |
| F-055  | minor   | J0.8i                                                 |
| F-056  | minor   | D.F-056                                               |
| F-057  | minor   | J0.5a                                                 |
| F-058  | minor   | D.F-058                                               |
| F-059  | minor   | D.F-059                                               |
| F-060  | minor   | J0.1                                                  |
| F-061  | minor   | J0.1                                                  |
| F-062  | minor   | J0.1                                                  |
| F-063  | minor   | J0.9g                                                 |
| F-064  | minor   | D.F-064                                               |
| F-065  | minor   | D.F-065                                               |
| F-066  | minor   | D.F-066                                               |
| F-067  | minor   | D.F-067                                               |
| F-068  | minor   | D.F-068                                               |
| F-069  | minor   | D.F-069                                               |
| F-070  | minor   | D.F-070                                               |
| F-071  | minor   | D.F-071                                               |
| F-072  | minor   | J0.9d, J0.9e                                          |
| F-073  | minor   | D.F-073                                               |
| F-074  | minor   | D.F-074                                               |
| F-075  | minor   | D.F-075                                               |
| F-076  | minor   | D.F-076                                               |
| F-077  | minor   | D.F-077                                               |
| F-078  | minor   | D.F-078                                               |
| F-079  | minor   | D.F-079                                               |
| F-080  | minor   | D.F-080                                               |
| F-081  | minor   | D.F-081                                               |
| F-082  | minor   | D.F-082                                               |
| F-083  | minor   | D.F-083                                               |
| F-084  | minor   | D.F-084                                               |
| F-085  | minor   | D.F-085                                               |
| F-086  | minor   | D.F-086                                               |
| F-087  | minor   | D.F-087                                               |
| F-088  | minor   | D.F-088                                               |
| F-089  | minor   | D.F-089                                               |
| F-090  | minor   | D.F-090                                               |
| F-091  | minor   | D.F-091                                               |
| F-092  | minor   | D.F-092                                               |
| F-093  | minor   | D.F-093                                               |
| F-094  | blocker | J2.3, J3.1, J3.3, J3.8                                |
| F-095  | blocker | J2.9, J3.9                                            |
| F-096  | major   | J2.4e                                                 |
| F-097  | major   | J2.4g                                                 |
| F-098  | major   | J1.1, J3.1                                            |
| F-099  | major   | J2.4b, J3.7                                           |
| F-100  | major   | J2.5, J3.7                                            |
| F-101  | major   | J2.8, J1.9                                            |
| F-102  | major   | J1.2, J2.1, J2.9, J3.1, J3.9                          |
| F-103  | major   | J2.2                                                  |
| F-104  | major   | J3.1, J3.3                                            |
| F-105  | major   | J3.2, J3.9                                            |
| F-106  | major   | J3.2, J3.3, J3.4, J3.5, J3.6, J3.8                    |
| F-107  | major   | J2.4f                                                 |
| F-108  | major   | J2.7, J3.8                                            |
| F-109  | major   | J2.4c                                                 |
| F-110  | major   | J2.5                                                  |
| F-111  | major   | J3.4                                                  |
| F-112  | minor   | J1.1                                                  |
| F-113  | minor   | J1.1, J3.7                                            |
| F-114  | minor   | J1.10                                                 |
| F-115  | minor   | J2.4a, J3.9                                           |
| F-116  | minor   | J1.2, J2.1                                            |
| F-117  | minor   | J2.1, J3.1                                            |
| F-118  | minor   | J2.3, J2.9                                            |
| F-119  | minor   | J2.7, J3.2                                            |
| F-120  | minor   | J2.9                                                  |
| F-121  | minor   | J2.4d                                                 |
| F-122  | minor   | J2.6                                                  |
| F-123  | major   | J3.7, J1.11                                           |
| F-124  | minor   | J3.9                                                  |
| F-125  | minor   | J2.4f                                                 |
| F-126  | minor   | J2.4f                                                 |
| F-127  | major   | J4.2                                                  |
| F-128  | major   | J1.12a                                                |
| F-129  | major   | J1.5, J1.8                                            |
| F-130  | minor   | J4.3                                                  |
| F-131  | minor   | J1.14                                                 |
| F-132  | minor   | J1.12a                                                |
| F-133  | minor   | J4.7                                                  |
| F-134  | minor   | J4.5                                                  |
| F-135  | blocker | J0.5b                                                 |
| F-136  | blocker | J2.4d, J2.5                                           |
| F-137  | major   | J0.5b                                                 |
| F-138  | major   | J0.5a, J0.5b                                          |
| F-139  | major   | J0.5a                                                 |
| F-140  | major   | J0.5a                                                 |
| F-141  | major   | J0.5b                                                 |
| F-142  | major   | J0.5a                                                 |
| F-143  | major   | J0.5b                                                 |
| F-144  | minor   | J0.5b                                                 |
| F-145  | major   | J0.5a, J0.5b                                          |
| F-146  | major   | J0.1, J0.5i                                           |
| F-147  | major   | J1.10                                                 |
| F-148  | major   | J0.5h                                                 |
| F-149  | major   | J0.5b, J0.5h                                          |
| F-150  | minor   | J0.5b                                                 |
| F-151  | major   | J0.5h                                                 |
| F-152  | major   | J0.5b                                                 |
| F-153  | major   | J0.5b, J0.9j                                          |
| F-154  | major   | J0.9j                                                 |
| F-155  | major   | J0.5b                                                 |
| F-156  | major   | J0.5b                                                 |
| F-157  | blocker | J2.3                                                  |
| F-158  | major   | J0.9m                                                 |
| F-159  | major   | J0.5a                                                 |
| F-160  | major   | J0.5a                                                 |
| F-161  | major   | J0.5i                                                 |
| F-162  | minor   | J0.5h                                                 |
| F-163  | major   | J4.6                                                  |
| F-164  | major   | D.F-164                                               |
| F-165  | major   | D.F-165                                               |
| F-166  | major   | D.F-166                                               |
| F-167  | major   | D.F-167                                               |
| F-168  | major   | D.F-168                                               |
| F-169  | major   | D.F-169                                               |
| F-170  | major   | D.F-170                                               |

Rows in the index: 170. Steps named by the register that are not in the tables above: none.
