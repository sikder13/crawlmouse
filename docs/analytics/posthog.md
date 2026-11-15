# PostHog setup

<!-- Rendered by `pnpm ops:posthog:docs` from scripts/ops/posthog/spec.ts. Do not edit by hand. -->

Applied by `pnpm ops:posthog` (run `pnpm ops:posthog --dry-run` first). Objects are matched by name, and each name starts with `[cm]`.

## API

- Host: https://us.posthog.com, `Authorization: Bearer <POSTHOG_PERSONAL_API_KEY>`.
- Project: `POSTHOG_PROJECT_ID`. Both are read from the environment or `scripts/.env.local`.
- Personal API key scopes: `project:read`, `project:write`, `action:read`, `action:write`, `cohort:read`, `cohort:write`, `feature_flag:read`, `feature_flag:write`, `survey:read`, `survey:write`, `dashboard:read`, `dashboard:write`, `insight:read`, `insight:write`.

## Test-account filter

An insight that filters out test accounts counts an event only when each of these holds:

- person `internal` ≠ `true`
- event `internal` ≠ `true`
- event `$host` does not match `\.vercel\.app$`
- event `$host` is none of `localhost`, `127.0.0.1`

## Actions

| Action           | Matches                                                                                                       | Description                                                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [cm] Activation  | `check_finished` where event `source` is not set                                                              | A check finished on the public check path (the home page's form and its copies), not the pipeline's copy of the event.                                                                                                                 |
| [cm] Sign-up     | `account_created`                                                                                             | An account created: the first login that confirmed the email (account_created, sent by the Continue page).                                                                                                                             |
| [cm] Trial start | `trial_started` where event `kind` = `pro`, or `subscription_started` where event `trial` = `true`            | The no-card Pro trial started, or a card trial's subscription started.                                                                                                                                                                 |
| [cm] Paid        | `subscription_started` where event `trial` = `false`, or `trial_converted` where event `via` = `subscription` | A paying subscription, counted once: a checkout that charged (subscription_started, trial false, which a no-card trial's paying checkout sends too), or a card trial's subscription turning active (trial_converted via subscription). |

## Cohorts

| Cohort                      | A person is in it when                                                                                                                                                                                                                                                                                                                                                                                                              | Description                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [cm] Trialists              | person `plan` is one of `pro_trial`, `agency_trial`                                                                                                                                                                                                                                                                                                                                                                                 | People whose account is in a trial.                                       |
| [cm] Paying Pro             | person `plan` = `pro`                                                                                                                                                                                                                                                                                                                                                                                                               | People whose account is on paid Pro.                                      |
| [cm] Paying Agency          | person `plan` = `agency`                                                                                                                                                                                                                                                                                                                                                                                                            | People whose account is on paid Agency.                                   |
| [cm] Came from blog         | person `ft_landing_path` matches `^/blog(/\|$)`                                                                                                                                                                                                                                                                                                                                                                                     | People whose first landing was on the blog.                               |
| [cm] Came from social       | person `ft_utm_medium` = `social`; or person `ft_referrer_host` is one of `linkedin.com`, `www.linkedin.com`, `lnkd.in`, `x.com`, `twitter.com`, `t.co`, `facebook.com`, `www.facebook.com`, `m.facebook.com`, `l.facebook.com`, `reddit.com`, `www.reddit.com`, `old.reddit.com`, `news.ycombinator.com`, `www.producthunt.com`, `producthunt.com`, `bsky.app`, `www.threads.net`, `threads.net`, `www.youtube.com`, `youtube.com` | People whose first touch was tagged social, or referred by a social host. |
| [cm] Agencies with a client | person `plan` is one of `agency_trial`, `agency` and sent `first_client_added` in the last 365 days                                                                                                                                                                                                                                                                                                                                 | People on an Agency account who added its first client.                   |

## Feature flags

| Flag                 | Key                  | Matches                     | Description                                                                                                                  |
| -------------------- | -------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [cm] survey-eligible | `cm-survey-eligible` | person `internal` = `false` | Identified people who are not internal: a person the browser never identified has no `internal` property, so does not match. |

## Surveys

### [cm] First result

After a person's first result page.

- Type: a popover, shown after the browser event `result_viewed`.
- Schedule: `once`.
- Who: people the flag [cm] survey-eligible admits.

| #   | Question                                                     | Type            | Choices           | Optional | Answer property                                         |
| --- | ------------------------------------------------------------ | --------------- | ----------------- | -------- | ------------------------------------------------------- |
| 1   | Did this show you something you didn't know about your site? | `single_choice` | Yes / Partly / No | no       | `$survey_response_27522018-6edd-d89f-3db4-0686709355f0` |
| 2   | What were you hoping to find?                                | `open`          | —                 | yes      | `$survey_response_a7077069-d190-f1a6-43cd-5b2b72876a13` |

### [cm] Fix clarity

After Mark done is confirmed (fix_done_confirmed).

- Type: a popover, shown after the browser event `fix_done_confirmed`.
- Schedule: `once`.
- Who: people the flag [cm] survey-eligible admits.

| #   | Question                           | Type            | Choices                | Optional | Answer property                                         |
| --- | ---------------------------------- | --------------- | ---------------------- | -------- | ------------------------------------------------------- |
| 1   | Was the fix clear enough to apply? | `single_choice` | Yes / Needed help / No | no       | `$survey_response_d0d7be2b-367d-f217-8c38-675b531b488e` |
| 2   | What would have made it clearer?   | `open`          | —                      | yes      | `$survey_response_a9d7ef8a-3d0d-d9a0-3dc1-d5daff788c77` |

### [cm] PMF

Sean Ellis's question, to people with some use of the product.

- Type: a popover, shown when the targeting holds.
- Schedule: `once`.
- Who: people the flag [cm] survey-eligible admits, and person `checks_finished` ≥ `3` and person `account_age_days` ≥ `14`.

| #   | Question                                                  | Type            | Choices                                         | Optional | Answer property                                         |
| --- | --------------------------------------------------------- | --------------- | ----------------------------------------------- | -------- | ------------------------------------------------------- |
| 1   | How would you feel if you could no longer use Crawlmouse? | `single_choice` | Very disappointed / Somewhat / Not disappointed | no       | `$survey_response_c36a6175-dee2-f234-2c1c-618cd05ab611` |
| 2   | What is the main benefit you get?                         | `open`          | —                                               | yes      | `$survey_response_11ff53f5-c3d0-5d7e-6266-7a25b0f1ed13` |
| 3   | Who do you think would benefit most?                      | `open`          | —                                               | yes      | `$survey_response_e3f55ea6-61e7-150f-ce56-80c2fbb2e556` |

### [cm] Upgrade blocker

Late in a trial that has not paid: the account's state is still a trial.

- Type: a popover, shown when the targeting holds.
- Schedule: `once`.
- Who: people the flag [cm] survey-eligible admits, and person `plan` is one of `pro_trial`, `agency_trial` and person `trial_day` ≥ `10` and person `trial_day` ≤ `14`.

| #   | Question                                                 | Type   | Choices | Optional | Answer property                                         |
| --- | -------------------------------------------------------- | ------ | ------- | -------- | ------------------------------------------------------- |
| 1   | What, if anything, is stopping you from choosing a plan? | `open` | —       | no       | `$survey_response_c2416bff-9dd7-e0f5-e1c8-6d41b9acb818` |

### [cm] Feedback

Opened by the account rail's Feedback button.

- Type: a widget, opened by a click on `[data-cm-feedback]`.
- Schedule: `always`.
- Who: people the flag [cm] survey-eligible admits.

| #   | Question                        | Type            | Choices                          | Optional | Answer property                                         |
| --- | ------------------------------- | --------------- | -------------------------------- | -------- | ------------------------------------------------------- |
| 1   | What would you like to tell us? | `open`          | —                                | no       | `$survey_response_5f6fbc9e-ea57-d84a-c846-1d557ef80964` |
| 2   | What kind of feedback is it?    | `single_choice` | Bug / Missing / Confusing / Idea | yes      | `$survey_response_152a1fd9-998d-f56f-79c4-cdfefa9cfb02` |

## Dashboards

Each insight looks back 90 days and filters out test accounts.

### [cm] Acquisition

Where visitors, checks and sign-ups come from.

| Insight                               | Kind   | What                                                                                              | Breakdown                 | Description                                                                                                       |
| ------------------------------------- | ------ | ------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [cm] Visitors by referring domain     | trend  | A: `$pageview` (dau), by week                                                                     | event `$referring_domain` | Unique visitors. A visitor not yet identified has no ft\_ properties, so this reads the page view's own referrer. |
| [cm] Visitors by UTM source           | trend  | A: `$pageview` (dau), by week                                                                     | event `utm_source`        | Unique visitors, by the page view's own utm_source.                                                               |
| [cm] Checks by first-touch source     | trend  | A: `check_started`, by week                                                                       | person `ft_utm_source`    | Checks started, by the person’s first-touch utm_source.                                                           |
| [cm] Checks by first-touch referrer   | trend  | A: `check_started`, by week                                                                       | person `ft_referrer_host` | Checks started, by the person’s first-touch referrer host.                                                        |
| [cm] Sign-ups by first-touch source   | trend  | A: action [cm] Sign-up (first_time_for_user), by week                                             | person `ft_utm_source`    | People signing up for the first time, by first-touch utm_source.                                                  |
| [cm] Sign-ups by first-touch referrer | trend  | A: action [cm] Sign-up (first_time_for_user), by week                                             | person `ft_referrer_host` | People signing up for the first time, by first-touch referrer host.                                               |
| [cm] Blog post to sign-up             | funnel | 1. `$pageview` where event `$pathname` matches `^/blog/` → 2. action [cm] Sign-up; within 30 days | event `$pathname`         | From a blog page view to a sign-up, by the blog page.                                                             |

### [cm] Activation

From the home page to a sign-up.

| Insight              | Kind   | What                                                                                                                                                | Breakdown | Description                                                                |
| -------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------- |
| [cm] Home to sign-up | funnel | 1. `home_viewed` → 2. `check_started` → 3. action [cm] Activation → 4. `result_viewed` → 5. `keep_clicked` → 6. action [cm] Sign-up; within 14 days | —         | Home, check started, check finished, result viewed, Keep clicked, sign-up. |

### [cm] Revenue

Trials, payments, cancellations and failures.

| Insight                      | Kind   | What                                                                                     | Breakdown        | Description                                               |
| ---------------------------- | ------ | ---------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------- |
| [cm] Trial to paid           | funnel | 1. action [cm] Trial start → 2. action [cm] Paid; within 21 days                         | —                | A trial start, then a payment.                            |
| [cm] New paid subscriptions  | trend  | A: action [cm] Paid, by week                                                             | event `plan`     | First payments and trial conversions, by plan.            |
| [cm] New subscription amount | trend  | A: `subscription_started` where event `trial` = `false` (sum of `amount_cents`), by week | event `currency` | The sum of a paying checkout's amount_cents, by currency. |
| [cm] Cancellations           | trend  | A: `subscription_canceled`; B: `subscription_ended`, by week                             | event `plan`     | Cancellations scheduled and subscriptions ended, by plan. |
| [cm] Failed payments         | trend  | A: `payment_failed`, by week                                                             | event `plan`     | Failed invoice payments, by plan.                         |

### [cm] Retention

Whether signed-up people come back and keep checking.

| Insight                                | Kind      | What                                                                                      | Breakdown       | Description                                                                                                                |
| -------------------------------------- | --------- | ----------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [cm] Weekly return of signed-up people | retention | starts with action [cm] Sign-up, returns with `$pageview`; 8 weeks                        | —               | People who signed up, returning to any page, by week.                                                                      |
| [cm] Re-checks                         | trend     | A: `check_started` where event `trigger` is one of `manual`, `fix_recheck`, by week       | event `trigger` | Checks a person started on a kept site, by trigger.                                                                        |
| [cm] Alerts acted on                   | funnel    | 1. `alert_sent` → 2. `fix_marked_done`; within 7 days; counted by `properties.account_id` | —               | An alert sent, then a fix marked done within 7 days, counted by account: alert_sent is keyed to the account, not a person. |

### [cm] Agency

Clients, reports and seats.

| Insight                           | Kind  | What                                                                                                     | Breakdown | Description                                        |
| --------------------------------- | ----- | -------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------- |
| [cm] Clients added                | trend | A: `first_client_added`; B: `site_added` where person `plan` is one of `agency_trial`, `agency`, by week | —         | First clients and sites added on Agency accounts.  |
| [cm] Reports generated and shared | trend | A: `report_generated`; B: `report_shared`; C: `share_link_opened`, by week                               | —         | Reports generated, shared, and share links opened. |
| [cm] Seats                        | trend | A: `seat_invited`; B: `seat_accepted`; C: `seats_bought` (sum of `seats`) as "seats bought", by week     | —         | Seats invited, accepted and bought.                |

### [cm] Product health

How checks end and how long they take.

| Insight               | Kind  | What                                                                                                                                                                | Breakdown      | Description                                                                                                    |
| --------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------- |
| [cm] Check outcomes   | trend | A: `check_finished` where event `source` is not set, by day                                                                                                         | event `status` | Public-path checks by status. The event carries no failure reason; reasons are in Postgres (analytics.checks). |
| [cm] Check duration   | trend | A: `check_finished` where event `source` is not set (median of `durationMs`), by day                                                                                | —              | The median durationMs of public-path checks.                                                                   |
| [cm] Withheld results | trend | A: `check_finished` where event `source` is not set and event `withheld` = `true`; B: `check_finished` where event `source` is not set, by week; plotted as `A / B` | —              | The share of public-path checks whose AI readability was withheld.                                             |

### [cm] Voice of customer

What people answer, next to who they are.

| Insight                              | Kind  | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Breakdown              | Description                                                                                                     |
| ------------------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| [cm] Survey response rate            | trend | A: `survey sent` where event `$survey_name` matches `^\\[cm\\] `; B: `survey shown` where event `$survey_name` matches `^\\[cm\\] `, by week; plotted as `A / B`                                                                                                                                                                                                                                                                                                                                                                                                                                     | event `$survey_name`   | Surveys sent over surveys shown, per survey.                                                                    |
| [cm] PMF very disappointed           | trend | A: `survey sent` where event `$survey_name` = `[cm] PMF` and event `$survey_response_c36a6175-dee2-f234-2c1c-618cd05ab611` = `Very disappointed` as "Very disappointed"; B: `survey sent` where event `$survey_name` = `[cm] PMF`, by month; plotted as `A / B`                                                                                                                                                                                                                                                                                                                                      | —                      | The share of PMF answers that are "Very disappointed".                                                          |
| [cm] PMF very disappointed by plan   | trend | A: `survey sent` where event `$survey_name` = `[cm] PMF` and event `$survey_response_c36a6175-dee2-f234-2c1c-618cd05ab611` = `Very disappointed` as "Very disappointed"; B: `survey sent` where event `$survey_name` = `[cm] PMF`, by month; plotted as `A / B`                                                                                                                                                                                                                                                                                                                                      | person `plan`          | The share of PMF answers that are "Very disappointed", by the person's plan.                                    |
| [cm] PMF very disappointed by source | trend | A: `survey sent` where event `$survey_name` = `[cm] PMF` and event `$survey_response_c36a6175-dee2-f234-2c1c-618cd05ab611` = `Very disappointed` as "Very disappointed"; B: `survey sent` where event `$survey_name` = `[cm] PMF`, by month; plotted as `A / B`                                                                                                                                                                                                                                                                                                                                      | person `ft_utm_source` | The share of PMF answers that are "Very disappointed", by first-touch utm_source.                               |
| [cm] First result answers by source  | trend | A: `survey sent` where event `$survey_name` = `[cm] First result` and event `$survey_response_27522018-6edd-d89f-3db4-0686709355f0` = `Yes` as "Yes"; B: `survey sent` where event `$survey_name` = `[cm] First result` and event `$survey_response_27522018-6edd-d89f-3db4-0686709355f0` = `Partly` as "Partly"; C: `survey sent` where event `$survey_name` = `[cm] First result` and event `$survey_response_27522018-6edd-d89f-3db4-0686709355f0` = `No` as "No", by month                                                                                                                       | person `ft_utm_source` | First-result answers, one series per choice, by first-touch utm_source.                                         |
| [cm] Fix clarity answers             | trend | A: `survey sent` where event `$survey_name` = `[cm] Fix clarity` and event `$survey_response_d0d7be2b-367d-f217-8c38-675b531b488e` = `Yes` as "Yes"; B: `survey sent` where event `$survey_name` = `[cm] Fix clarity` and event `$survey_response_d0d7be2b-367d-f217-8c38-675b531b488e` = `Needed help` as "Needed help"; C: `survey sent` where event `$survey_name` = `[cm] Fix clarity` and event `$survey_response_d0d7be2b-367d-f217-8c38-675b531b488e` = `No` as "No", by month                                                                                                                | —                      | Fix-clarity answers, one series per choice. Not by fix type: `survey sent` does not carry the trigger's `type`. |
| [cm] Latest free-text answers        | table | the latest 50 `survey sent` events where `coalesce(properties['$survey_response_a7077069-d190-f1a6-43cd-5b2b72876a13'], properties['$survey_response_a9d7ef8a-3d0d-d9a0-3dc1-d5daff788c77'], properties['$survey_response_11ff53f5-c3d0-5d7e-6266-7a25b0f1ed13'], properties['$survey_response_e3f55ea6-61e7-150f-ce56-80c2fbb2e556'], properties['$survey_response_c2416bff-9dd7-e0f5-e1c8-6d41b9acb818'], properties['$survey_response_5f6fbc9e-ea57-d84a-c846-1d557ef80964']) is not null` and `properties.$survey_name like '[cm] %'`; columns time, survey, answer, feedback kind, plan, source | —                      | The latest free-text answers, with the person’s plan and source.                                                |
