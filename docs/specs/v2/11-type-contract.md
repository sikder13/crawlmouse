# 11 — The v2 type contract (CC-11)

> Generated from `packages/types/src/v2` by `pnpm --filter @crawlmouse/types exec tsx src/v2/spec/write.ts`. Do not edit by hand: `src/v2/spec.test.ts` fails when this file and the schemas disagree.

## Entities

Each entity lists the screens that read it, with a phrase the contract test finds on that screen, then every field. "Added for" names what required a field beyond the CC-11 brief: a locked screen, `FACTS` (`docs/design/v2/FACTS-proposed.md`), or `brief` (needed to express a state the brief names, or carried over from existing code the brief says to reuse). An empty cell means the field is an id or foreign key, or one the CC-11 brief names; the brief is quoted in the pull request that added this file.

### Account

Fixture collection: `accounts`.

| Screen               | Shows                                         |
| -------------------- | --------------------------------------------- |
| Final-Settings       | "Sign-in links and alerts go here"            |
| Final-Dashboard      | "9 days left"                                 |
| Final-Dashboard-Day0 | "No card on file"                             |
| Final-TrialEnd       | "Pro ends Sun 8 Nov"                          |
| Final-Alerts         | "Keep Pro, $19 a month"                       |
| Final-Reports        | "9 days of Pro left"                          |
| Final-Ag-Matrix      | "Card ending 4242"                            |
| Final-Ag-Branding    | "Reports, portals and emails under your name" |
| Final-Signup         | "One email, and the account is yours"         |
| Final-AgencyTrial    | "shown on client reports"                     |
| Final-CheckEmail     | "We sent a sign-in link to you@company.com"   |
| Final-Account        | "Keep this audit."                            |
| Final-Pricing        | "Up to 2,000 pages per audit"                 |

| Field                                | Type              | Null | Added for         |
| ------------------------------------ | ----------------- | ---- | ----------------- |
| `id`                                 | `uuid`            | no   |                   |
| `email`                              | `email`           | no   | Final-Settings    |
| `name`                               | `string`          | yes  | Final-Settings    |
| `state`                              | `AccountState`    | no   |                   |
| `state_history`                      | `object[]`        | no   | FACTS             |
| `state_history[].state`              | `AccountState`    | no   |                   |
| `state_history[].since`              | `timestamp`       | no   |                   |
| `trial_ends_at`                      | `timestamp`       | yes  | Final-Dashboard   |
| `card_last4`                         | `string`          | yes  | Final-Ag-Matrix   |
| `renews_at`                          | `timestamp`       | yes  | Final-Ag-Matrix   |
| `billing_period_months`              | `integer`         | yes  | Final-Ag-Matrix   |
| `timezone`                           | `string`          | no   | FACTS             |
| `limits`                             | `object`          | no   | Final-Settings    |
| `limits.sites`                       | `integer`         | no   |                   |
| `limits.seats`                       | `integer`         | no   |                   |
| `limits.pages_per_audit`             | `integer`         | no   |                   |
| `limits.competitors_per_site`        | `integer`         | no   |                   |
| `limits.full_renders_per_month`      | `integer`         | no   |                   |
| `email_prefs`                        | `object`          | no   | Final-Settings    |
| `email_prefs.change_notes`           | `boolean`         | no   |                   |
| `email_prefs.trial_reminder`         | `boolean`         | no   |                   |
| `integrations`                       | `object[]`        | no   | Final-Settings    |
| `integrations[].kind`                | `IntegrationKind` | no   |                   |
| `integrations[].connected`           | `boolean`         | no   |                   |
| `integrations[].label`               | `string`          | yes  |                   |
| `api_keys`                           | `object[]`        | no   | Final-Developers  |
| `api_keys[].prefix`                  | `string`          | no   |                   |
| `api_keys[].created_at`              | `timestamp`       | no   |                   |
| `api_keys[].last_used_at`            | `timestamp`       | yes  |                   |
| `branding`                           | `object`          | yes  | Final-Ag-Branding |
| `branding.agency_name`               | `string`          | no   |                   |
| `branding.logo_url`                  | `url`             | yes  |                   |
| `branding.accent_hex`                | `string`          | yes  |                   |
| `branding.portal_domain`             | `string`          | yes  |                   |
| `branding.dns`                       | `object`          | yes  |                   |
| `branding.dns.txt_found`             | `boolean`         | no   |                   |
| `branding.dns.cname_found`           | `boolean`         | no   |                   |
| `branding.dns.certificate_issued_at` | `timestamp`       | yes  |                   |
| `branding.sender_email`              | `email`           | yes  |                   |
| `branding.email_auth`                | `object`          | yes  |                   |
| `branding.email_auth.spf_passes`     | `boolean`         | no   |                   |
| `branding.email_auth.dkim_passes`    | `boolean`         | no   |                   |
| `branding.email_auth.dmarc_policy`   | `string`          | yes  |                   |
| `branding.open_tracking_default`     | `boolean`         | no   |                   |
| `branding.postal_address`            | `string`          | yes  | FACTS             |
| `agency_trial_consent`               | `object`          | yes  | FACTS             |
| `agency_trial_consent.recorded_at`   | `timestamp`       | no   |                   |

### Seat

Fixture collection: `seats`.

| Screen           | Shows                                              |
| ---------------- | -------------------------------------------------- |
| Final-Ag-Seats   | "Who sees which clients and who gets which alerts" |
| Final-Ag-Client  | "Priya (account manager)"                          |
| Final-Ag-Reports | "Priya 2"                                          |

| Field            | Type              | Null | Added for      |
| ---------------- | ----------------- | ---- | -------------- |
| `id`             | `uuid`            | no   |                |
| `account_id`     | `uuid`            | no   |                |
| `email`          | `email`           | no   | Final-Ag-Seats |
| `name`           | `string`          | yes  | Final-Ag-Seats |
| `role`           | `SeatRole`        | no   | Final-Ag-Seats |
| `client_scope`   | `"all" or uuid[]` | no   | Final-Ag-Seats |
| `alert_channels` | `Channel[]`       | no   | Final-Ag-Seats |
| `theme`          | `Theme`           | no   | Final-Settings |
| `invited_at`     | `timestamp`       | no   | Final-Ag-Seats |
| `accepted_at`    | `timestamp`       | yes  | Final-Ag-Seats |

### Site

Fixture collection: `sites`.

| Screen                   | Shows                        |
| ------------------------ | ---------------------------- |
| Final-Site               | "Settings for this site"     |
| Final-Ag-Matrix          | "Example Outfitter"          |
| Final-Ag-Client          | "maya@example-outfitter.com" |
| Final-CheckEmail-NoAudit | "as its first site"          |

| Field                                  | Type        | Null | Added for        |
| -------------------------------------- | ----------- | ---- | ---------------- |
| `id`                                   | `uuid`      | no   |                  |
| `account_id`                           | `uuid`      | yes  |                  |
| `host`                                 | `string`    | no   | Final-Site       |
| `staging_of_site_id`                   | `uuid`      | yes  | Final-Site       |
| `client_name`                          | `string`    | yes  | Final-Ag-Matrix  |
| `client_contact_name`                  | `string`    | yes  | Final-Ag-Client  |
| `client_contact_email`                 | `email`     | yes  | Final-Ag-Client  |
| `schedule`                             | `object`    | yes  | Final-Site       |
| `schedule.cadence`                     | `Cadence`   | no   |                  |
| `schedule.iso_weekday`                 | `integer`   | yes  |                  |
| `schedule.hour_local`                  | `integer`   | yes  |                  |
| `paused`                               | `boolean`   | no   | Final-TrialEnd   |
| `competitor_hosts`                     | `string[]`  | no   | Final-Site       |
| `slack_channel`                        | `string`    | yes  | Final-Ag-Client  |
| `owner_seat_id`                        | `uuid`      | yes  | Final-Ag-Client  |
| `client_report`                        | `object`    | yes  | Final-Ag-Client  |
| `client_report.cadence`                | `Cadence`   | no   |                  |
| `client_report.iso_weekday`            | `integer`   | no   |                  |
| `client_report.time_local`             | `string`    | no   |                  |
| `client_report.timezone`               | `string`    | no   | Final-Ag-Reports |
| `client_report.send_when_unchanged`    | `boolean`   | no   |                  |
| `client_report.open_tracking`          | `boolean`   | no   |                  |
| `client_report.page_slug`              | `string`    | no   | Final-Ag-Client  |
| `client_report.paused_by_recipient_at` | `timestamp` | yes  | FACTS            |
| `created_at`                           | `timestamp` | no   |                  |

### Check

Fixture collection: `checks`.

| Screen              | Shows                             |
| ------------------- | --------------------------------- |
| Final-Result        | "Everything we checked"           |
| Final-Result-Dark   | "Everything we checked"           |
| Final-Crawl         | "Read robots.txt and the sitemap" |
| Final-Public        | "What each crawler got back"      |
| Final-Segment       | "Responses kept as evidence"      |
| Final-Seg-JS        | "Text without JavaScript, site"   |
| Final-Seg-Structure | "Average click depth"             |
| Final-Seg-Content   | "Pages with a quotable opening"   |
| Final-Seg-Signals   | "Where we looked"                 |
| Final-Seg-Changes   | "Your audit history"              |
| Final-Home          | "What's in the way"               |
| Final-Developers    | "Available now, on Pro"           |
| Final-Dashboard     | "Crawler access now"              |
| Final-Site          | "Grades, six checks"              |

| Field                                          | Type                | Null | Variant            | Added for           |
| ---------------------------------------------- | ------------------- | ---- | ------------------ | ------------------- |
| `id`                                           | `uuid`              | no   |                    |                     |
| `site_id`                                      | `uuid`              | no   |                    |                     |
| `previous_check_id`                            | `uuid`              | yes  |                    |                     |
| `status`                                       | `CheckStatus`       | no   |                    |                     |
| `trigger`                                      | `CheckTrigger`      | no   |                    | Final-Site          |
| `grade_version`                                | `string`            | no   |                    |                     |
| `queued_at`                                    | `timestamp`         | no   |                    | Final-Crawl         |
| `started_at`                                   | `timestamp`         | yes  |                    | Final-Crawl         |
| `finished_at`                                  | `timestamp`         | yes  |                    | Final-Home          |
| `tested_at`                                    | `timestamp`         | yes  |                    | Final-Segment       |
| `expires_at`                                   | `timestamp`         | yes  |                    | Final-Result        |
| `deferred_until`                               | `timestamp`         | yes  |                    | brief               |
| `failure_reason`                               | `string`            | yes  |                    | brief               |
| `result_email`                                 | `object`            | yes  |                    | Final-Crawl         |
| `result_email.sent_at`                         | `timestamp`         | yes  |                    |                     |
| `result_email.link_expires_at`                 | `timestamp`         | no   |                    |                     |
| `coverage`                                     | `object`            | yes  |                    |                     |
| `coverage.pages_discovered`                    | `integer`           | no   |                    |                     |
| `coverage.pages_crawled`                       | `integer`           | no   |                    |                     |
| `coverage.pages_sampled`                       | `integer`           | no   |                    |                     |
| `coverage.templates`                           | `object[]`          | no   |                    |                     |
| `coverage.templates[].template_key`            | `string`            | no   |                    |                     |
| `coverage.templates[].label`                   | `string`            | no   |                    |                     |
| `coverage.templates[].pages`                   | `integer`           | no   |                    |                     |
| `coverage.sample_strategy`                     | `object`            | no   |                    |                     |
| `coverage.sample_strategy.method`              | `SampleMethod`      | no   |                    |                     |
| `coverage.sample_strategy.max_pages`           | `integer`           | no   |                    |                     |
| `coverage.gradeable`                           | `integer`           | no   |                    | brief               |
| `coverage.excluded`                            | `object[]`          | no   |                    | brief               |
| `coverage.excluded[].kind`                     | `PageKind`          | no   |                    |                     |
| `coverage.excluded[].count`                    | `integer`           | no   |                    |                     |
| `technical_seo`                                | `object`            | yes  |                    |                     |
| `technical_seo.score`                          | `number`            | yes  |                    |                     |
| `technical_seo.grade`                          | `GradeLetter`       | yes  |                    |                     |
| `technical_seo.breakdown`                      | `object`            | no   |                    |                     |
| `technical_seo.breakdown.orphanRatioScore`     | `number`            | no   |                    |                     |
| `technical_seo.breakdown.depthScore`           | `number`            | no   |                    |                     |
| `technical_seo.breakdown.anchorDiversityScore` | `number`            | no   |                    |                     |
| `technical_seo.breakdown.structureScore`       | `number`            | no   |                    |                     |
| `technical_seo.refusal`                        | `object`            | no   |                    |                     |
| `technical_seo.refusal.refused`                | `boolean`           | no   |                    |                     |
| `technical_seo.refusal.triggers`               | `RefusalTrigger[]`  | no   |                    |                     |
| `technical_seo.refusal.confidenceCapped`       | `boolean`           | no   |                    |                     |
| `technical_seo.refusal.unevaluable`            | `RefusalTrigger[]`  | no   |                    |                     |
| `technical_seo.site_structure_score`           | `number`            | yes  |                    | Final-Seg-Structure |
| `ai_readability`                               | `one of 2 variants` | yes  |                    |                     |
| `ai_readability.withheld`                      | `false`             | no   | `withheld = false` |                     |
| `ai_readability.total`                         | `number`            | no   | `withheld = false` |                     |
| `ai_readability.grade`                         | `GradeLetter`       | no   | `withheld = false` |                     |
| `ai_readability.components`                    | `object`            | no   | `withheld = false` |                     |
| `ai_readability.components.access`             | `object`            | no   | `withheld = false` |                     |
| `ai_readability.components.access.score`       | `number`            | no   | `withheld = false` |                     |
| `ai_readability.components.access.max`         | `40`                | no   | `withheld = false` |                     |
| `ai_readability.components.access.heuristic`   | `false`             | no   | `withheld = false` |                     |
| `ai_readability.components.readable`           | `object`            | no   | `withheld = false` |                     |
| `ai_readability.components.readable.score`     | `number`            | no   | `withheld = false` |                     |
| `ai_readability.components.readable.max`       | `30`                | no   | `withheld = false` |                     |
| `ai_readability.components.readable.heuristic` | `false`             | no   | `withheld = false` |                     |
| `ai_readability.components.quotable`           | `object`            | no   | `withheld = false` |                     |
| `ai_readability.components.quotable.score`     | `number`            | no   | `withheld = false` |                     |
| `ai_readability.components.quotable.max`       | `20`                | no   | `withheld = false` |                     |
| `ai_readability.components.quotable.heuristic` | `true`              | no   | `withheld = false` |                     |
| `ai_readability.components.signals`            | `object`            | no   | `withheld = false` |                     |
| `ai_readability.components.signals.score`      | `number`            | no   | `withheld = false` |                     |
| `ai_readability.components.signals.max`        | `10`                | no   | `withheld = false` |                     |
| `ai_readability.components.signals.heuristic`  | `false`             | no   | `withheld = false` |                     |
| `ai_readability.access_range`                  | `null`              | no   | `withheld = false` |                     |
| `ai_readability.withheld`                      | `true`              | no   | `withheld = true`  |                     |
| `ai_readability.total`                         | `null`              | no   | `withheld = true`  |                     |
| `ai_readability.grade`                         | `null`              | no   | `withheld = true`  |                     |
| `ai_readability.components`                    | `object`            | no   | `withheld = true`  |                     |
| `ai_readability.components.access`             | `object`            | no   | `withheld = true`  |                     |
| `ai_readability.components.access.score`       | `null`              | no   | `withheld = true`  |                     |
| `ai_readability.components.access.max`         | `40`                | no   | `withheld = true`  |                     |
| `ai_readability.components.access.heuristic`   | `false`             | no   | `withheld = true`  |                     |
| `ai_readability.components.readable`           | `object`            | no   | `withheld = true`  |                     |
| `ai_readability.components.readable.score`     | `number`            | no   | `withheld = true`  |                     |
| `ai_readability.components.readable.max`       | `30`                | no   | `withheld = true`  |                     |
| `ai_readability.components.readable.heuristic` | `false`             | no   | `withheld = true`  |                     |
| `ai_readability.components.quotable`           | `object`            | no   | `withheld = true`  |                     |
| `ai_readability.components.quotable.score`     | `number`            | no   | `withheld = true`  |                     |
| `ai_readability.components.quotable.max`       | `20`                | no   | `withheld = true`  |                     |
| `ai_readability.components.quotable.heuristic` | `true`              | no   | `withheld = true`  |                     |
| `ai_readability.components.signals`            | `object`            | no   | `withheld = true`  |                     |
| `ai_readability.components.signals.score`      | `number`            | no   | `withheld = true`  |                     |
| `ai_readability.components.signals.max`        | `10`                | no   | `withheld = true`  |                     |
| `ai_readability.components.signals.heuristic`  | `false`             | no   | `withheld = true`  |                     |
| `ai_readability.access_range`                  | `object`            | no   | `withheld = true`  |                     |
| `ai_readability.access_range.min`              | `number`            | no   | `withheld = true`  |                     |
| `ai_readability.access_range.max`              | `number`            | no   | `withheld = true`  |                     |
| `structure`                                    | `object`            | yes  |                    | Final-Seg-Structure |
| `structure.internal_links`                     | `integer`           | no   |                    |                     |
| `structure.orphan_pages`                       | `integer`           | no   |                    |                     |
| `structure.js_only_pages`                      | `integer`           | no   |                    |                     |
| `structure.pages_deeper_than_3`                | `integer`           | no   |                    |                     |
| `structure.avg_click_depth`                    | `number`            | no   |                    |                     |
| `structure.hubs`                               | `integer`           | no   |                    |                     |
| `structure.hub_pagerank_share`                 | `number`            | no   |                    |                     |
| `structure.generic_anchor_share`               | `number`            | no   |                    |                     |
| `without_js`                                   | `object`            | yes  |                    | Final-Seg-JS        |
| `without_js.site_text_share`                   | `number`            | no   |                    |                     |
| `content`                                      | `object`            | yes  |                    | Final-Seg-Content   |
| `content.score`                                | `number`            | no   |                    |                     |
| `content.checks`                               | `object[]`          | no   |                    |                     |
| `content.checks[].check`                       | `ContentCheck`      | no   |                    |                     |
| `content.checks[].by_template`                 | `object[]`          | no   |                    |                     |
| `content.checks[].by_template[].template_key`  | `string`            | no   |                    |                     |
| `content.checks[].by_template[].passing`       | `integer`           | no   |                    |                     |
| `content.checks[].by_template[].total`         | `integer`           | no   |                    |                     |
| `signals`                                      | `object[]`          | no   |                    | Final-Seg-Signals   |
| `signals[].signal`                             | `SignalKind`        | no   |                    |                     |
| `signals[].state`                              | `DetectionState`    | no   |                    |                     |
| `signals[].counts_toward_grade`                | `boolean`           | no   |                    |                     |
| `signals[].evidence`                           | `string`            | no   |                    |                     |
| `crawlers`                                     | `object[]`          | no   |                    | Final-Segment       |
| `crawlers[].ua`                                | `string`            | no   |                    |                     |
| `crawlers[].group`                             | `CrawlerGroup`      | no   |                    |                     |
| `crawlers[].scored`                            | `boolean`           | no   |                    |                     |
| `crawlers[].verdict`                           | `Verdict`           | no   |                    |                     |
| `crawlers[].evidence_class`                    | `EvidenceClass`     | no   |                    |                     |
| `crawlers[].status`                            | `integer`           | yes  |                    |                     |
| `crawlers[].pages_measured`                    | `integer`           | no   |                    |                     |
| `crawlers[].cause`                             | `AccessCause`       | yes  |                    |                     |
| `crawlers[].text_share`                        | `number`            | yes  |                    |                     |
| `crawlers[].confidence`                        | `Confidence`        | no   |                    |                     |
| `crawlers[].by_template`                       | `object[]`          | no   |                    |                     |
| `crawlers[].by_template[].template_key`        | `string`            | no   |                    |                     |
| `crawlers[].by_template[].verdict`             | `Verdict`           | no   |                    |                     |
| `crawlers[].by_template[].status`              | `integer`           | yes  |                    |                     |
| `stack`                                        | `object`            | yes  |                    | Final-Fix           |
| `stack.frontend`                               | `object`            | yes  |                    |                     |
| `stack.frontend.name`                          | `string`            | no   |                    |                     |
| `stack.frontend.version`                       | `string`            | yes  |                    |                     |
| `stack.frontend.router`                        | `string`            | yes  |                    |                     |
| `stack.frontend.detected_from`                 | `string`            | no   |                    |                     |
| `stack.backend`                                | `object`            | yes  |                    |                     |
| `stack.backend.cms`                            | `CmsName`           | no   |                    |                     |
| `stack.backend.detected_from`                  | `string`            | no   |                    |                     |
| `stack.edge`                                   | `object`            | yes  |                    |                     |
| `stack.edge.vendor`                            | `string`            | no   |                    |                     |
| `stack.edge.detected_from`                     | `string`            | no   |                    |                     |
| `competitors`                                  | `object[]`          | no   |                    | Final-Seg-Signals   |
| `competitors[].host`                           | `string`            | no   |                    |                     |
| `competitors[].crawlers_with_access`           | `integer`           | no   |                    |                     |
| `competitors[].crawlers_tested`                | `integer`           | no   |                    |                     |
| `competitors[].text_share`                     | `number`            | no   |                    |                     |
| `competitors[].product_schema`                 | `boolean`           | no   |                    |                     |
| `competitors[].technical_seo`                  | `object`            | no   |                    |                     |
| `competitors[].technical_seo.score`            | `number`            | no   |                    |                     |
| `competitors[].technical_seo.grade`            | `GradeLetter`       | no   |                    |                     |
| `competitors[].ai_readability`                 | `object`            | yes  |                    |                     |
| `competitors[].ai_readability.score`           | `number`            | no   |                    |                     |
| `competitors[].ai_readability.grade`           | `GradeLetter`       | no   |                    |                     |
| `competitors[].signals_present`                | `integer`           | yes  |                    |                     |
| `progress`                                     | `object`            | yes  |                    | Final-Crawl         |
| `progress.steps`                               | `object[]`          | no   |                    |                     |
| `progress.steps[].phase`                       | `CheckPhase`        | no   |                    |                     |
| `progress.steps[].state`                       | `StepState`         | no   |                    |                     |
| `progress.pages_crawled`                       | `integer`           | no   |                    |                     |
| `progress.pages_estimated`                     | `integer`           | yes  |                    |                     |
| `progress.links_found`                         | `integer`           | no   |                    |                     |
| `progress.elapsed_ms`                          | `integer`           | no   |                    |                     |
| `progress.recent_fetches`                      | `object[]`          | no   |                    |                     |
| `progress.recent_fetches[].url`                | `url`               | no   |                    |                     |
| `progress.recent_fetches[].status`             | `integer`           | no   |                    |                     |
| `progress.recent_fetches[].links`              | `integer`           | no   |                    |                     |

### PageResult

Fixture collection: `page_results`.

| Screen              | Shows                                               |
| ------------------- | --------------------------------------------------- |
| Final-Seg-JS        | "How much of each page survives without JavaScript" |
| Final-Seg-Structure | "Suggested parent"                                  |
| Final-LinkMap       | "Crawlers that reach it"                            |

| Field                       | Type             | Null | Added for           |
| --------------------------- | ---------------- | ---- | ------------------- |
| `check_id`                  | `uuid`           | no   |                     |
| `url`                       | `url`            | no   | Final-Seg-JS        |
| `template_key`              | `string`         | no   | Final-Seg-JS        |
| `kind`                      | `PageKind`       | no   | brief               |
| `status_code`               | `integer`        | no   | Final-LinkMap       |
| `depth`                     | `integer`        | yes  | Final-LinkMap       |
| `links_in`                  | `integer`        | no   | Final-LinkMap       |
| `links_out`                 | `integer`        | no   | Final-LinkMap       |
| `pagerank_share`            | `number`         | yes  | Final-LinkMap       |
| `is_orphan`                 | `boolean`        | no   | Final-Seg-Structure |
| `js_only`                   | `boolean`        | no   | Final-LinkMap       |
| `found_via`                 | `FoundVia`       | no   | Final-Seg-Structure |
| `sitemap_lastmod`           | `date`           | yes  | Final-Seg-Structure |
| `suggested_parent_url`      | `url`            | yes  | Final-Seg-Structure |
| `sampled`                   | `boolean`        | no   | Final-Seg-JS        |
| `without_js`                | `object`         | yes  | Final-Seg-JS        |
| `without_js.raw_words`      | `integer`        | no   |                     |
| `without_js.rendered_words` | `integer`        | no   |                     |
| `without_js.text_share`     | `number`         | no   |                     |
| `without_js.state`          | `JsTextState`    | no   |                     |
| `crawlers_reached`          | `integer`        | yes  | Final-LinkMap       |
| `crawlers_reading_text`     | `integer`        | yes  | Final-Seg-Structure |
| `content_failures`          | `ContentCheck[]` | yes  | Final-Seg-Content   |

### LinkEdge

Fixture collection: `link_edges`.

| Screen        | Shows                          |
| ------------- | ------------------------------ |
| Final-LinkMap | "Linked from"                  |
| Final-Reports | "the link map as an edge list" |

| Field               | Type      | Null | Added for           |
| ------------------- | --------- | ---- | ------------------- |
| `check_id`          | `uuid`    | no   |                     |
| `from_url`          | `url`     | no   | Final-LinkMap       |
| `to_url`            | `url`     | no   | Final-LinkMap       |
| `anchor_text`       | `string`  | no   | Final-LinkMap       |
| `is_generic_anchor` | `boolean` | no   | Final-LinkMap       |
| `js_only`           | `boolean` | no   | Final-Seg-Structure |

### AccessTest

Fixture collection: `access_tests`.

| Screen        | Shows                   |
| ------------- | ----------------------- |
| Final-Segment | "error code: 1020"      |
| Final-Seg-JS  | "what the server sent"  |
| Final-Reports | "Every response as CSV" |

| Field                     | Type            | Null | Added for     |
| ------------------------- | --------------- | ---- | ------------- |
| `id`                      | `uuid`          | no   |               |
| `check_id`                | `uuid`          | no   |               |
| `ua`                      | `string`        | yes  | FACTS         |
| `page_url`                | `url`           | no   | Final-Segment |
| `template_key`            | `string`        | no   | Final-Segment |
| `tested_at`               | `timestamp`     | no   | Final-Segment |
| `verdict`                 | `Verdict`       | no   | FACTS         |
| `evidence_class`          | `EvidenceClass` | no   |               |
| `identity_sent`           | `string`        | no   |               |
| `source_ip_class`         | `SourceIpClass` | no   |               |
| `limitations`             | `string[]`      | no   |               |
| `cause`                   | `AccessCause`   | yes  | FACTS         |
| `request_headers`         | `object[]`      | no   | Final-Segment |
| `request_headers[].name`  | `string`        | no   |               |
| `request_headers[].value` | `string`        | no   |               |
| `raw_status`              | `integer`       | yes  |               |
| `final_url`               | `url`           | yes  |               |
| `headers`                 | `object[]`      | no   |               |
| `headers[].name`          | `string`        | no   |               |
| `headers[].value`         | `string`        | no   |               |
| `byte_count`              | `integer`       | yes  |               |
| `word_count`              | `integer`       | yes  |               |
| `body_excerpt`            | `string`        | yes  | Final-Segment |

### Fix

Fixture collection: `fixes`.

| Screen               | Shows                                            |
| -------------------- | ------------------------------------------------ |
| Final-Fix            | "The packet"                                     |
| Final-Public         | "The three fixes with the largest effect"        |
| Final-Dashboard-Day0 | "Start with the fix that pays most"              |
| Final-Ag-Client      | "Open fixes"                                     |
| Final-Agencies       | "Link the 7 orphan pages from their collections" |
| Final-Seg-Content    | "Fixes for quotable content"                     |

| Field                              | Type                  | Null | Variant            | Added for            |
| ---------------------------------- | --------------------- | ---- | ------------------ | -------------------- |
| `id`                               | `uuid`                | no   |                    |                      |
| `site_id`                          | `uuid`                | no   |                    |                      |
| `fingerprint`                      | `string`              | no   |                    |                      |
| `number`                           | `integer`             | no   |                    | Final-Site           |
| `type`                             | `FixType`             | no   |                    |                      |
| `section`                          | `FixSection`          | no   |                    | Final-Site           |
| `title`                            | `string`              | no   |                    | Final-Fix            |
| `detail`                           | `string`              | yes  |                    | Final-Seg-Structure  |
| `recommendation_class`             | `RecommendationClass` | no   |                    |                      |
| `status`                           | `FixStatus`           | no   |                    |                      |
| `last_state`                       | `DetectionState`      | no   |                    |                      |
| `last_measured_check_id`           | `uuid`                | no   |                    |                      |
| `first_seen_check_id`              | `uuid`                | no   |                    |                      |
| `confidence`                       | `Confidence`          | no   |                    |                      |
| `affected_pages`                   | `integer`             | no   |                    |                      |
| `template_key`                     | `string`              | yes  |                    |                      |
| `crawler_uas`                      | `string[]`            | no   |                    | Final-Segment        |
| `rank`                             | `integer`             | yes  |                    | Final-Dashboard-Day0 |
| `effect`                           | `object`              | no   |                    |                      |
| `effect.technical_seo`             | `number`              | no   |                    |                      |
| `effect.ai_readability`            | `number`              | yes  |                    |                      |
| `effect.ai_readability_pending_on` | `string[]`            | no   |                    |                      |
| `effect.estimate`                  | `true`                | no   |                    |                      |
| `effort`                           | `one of 2 variants`   | yes  |                    | Final-Public         |
| `effort.kind`                      | `"minutes"`           | no   | `kind = minutes`   |                      |
| `effort.minutes`                   | `integer`             | no   | `kind = minutes`   |                      |
| `effort.kind`                      | `"templates"`         | no   | `kind = templates` |                      |
| `effort.templates`                 | `integer`             | no   | `kind = templates` |                      |
| `effort.deploys`                   | `integer`             | no   | `kind = templates` |                      |
| `before_after`                     | `object[]`            | no   |                    | Final-Fix            |
| `before_after[].measure`           | `FixMeasure`          | no   |                    |                      |
| `before_after[].today`             | `number or boolean`   | no   |                    |                      |
| `before_after[].after`             | `number or boolean`   | no   |                    |                      |
| `before_after[].after_bound`       | `EstimateBound`       | no   |                    |                      |
| `before_after[].after_is_estimate` | `true`                | no   |                    |                      |
| `packet`                           | `object`              | yes  |                    | Final-Fix            |
| `packet.framework`                 | `PacketFramework`     | no   |                    |                      |
| `packet.frameworks`                | `PacketFramework[]`   | no   |                    |                      |
| `packet.context`                   | `string[]`            | no   |                    |                      |
| `packet.change`                    | `string[]`            | no   |                    |                      |
| `packet.keep`                      | `string[]`            | no   |                    |                      |
| `packet.verify`                    | `object`              | no   |                    |                      |
| `packet.verify.command`            | `string`              | no   |                    |                      |
| `packet.verify.expect`             | `string`              | no   |                    |                      |
| `packet.verify.ua`                 | `string`              | yes  |                    |                      |

### FixEvent

Fixture collection: `fix_events`.

| Screen           | Shows                     |
| ---------------- | ------------------------- |
| Final-Site       | "marked done Wed"         |
| Final-Ag-Reports | "Fix marked done after"   |
| Final-TrialEnd   | "fix 0 closed Sat 31 Oct" |

| Field        | Type                 | Null | Variant                   | Added for |
| ------------ | -------------------- | ---- | ------------------------- | --------- |
| `id`         | `uuid`               | no   | `kind = marked_done`      |           |
| `fix_id`     | `uuid`               | no   | `kind = marked_done`      |           |
| `at`         | `timestamp`          | no   | `kind = marked_done`      |           |
| `kind`       | `"marked_done"`      | no   | `kind = marked_done`      |           |
| `by_seat_id` | `uuid`               | yes  | `kind = marked_done`      |           |
| `id`         | `uuid`               | no   | `kind = verified`         |           |
| `fix_id`     | `uuid`               | no   | `kind = verified`         |           |
| `at`         | `timestamp`          | no   | `kind = verified`         |           |
| `kind`       | `"verified"`         | no   | `kind = verified`         |           |
| `check_id`   | `uuid`               | no   | `kind = verified`         | brief     |
| `id`         | `uuid`               | no   | `kind = unable_to_verify` |           |
| `fix_id`     | `uuid`               | no   | `kind = unable_to_verify` |           |
| `at`         | `timestamp`          | no   | `kind = unable_to_verify` |           |
| `kind`       | `"unable_to_verify"` | no   | `kind = unable_to_verify` |           |
| `check_id`   | `uuid`               | no   | `kind = unable_to_verify` | brief     |
| `id`         | `uuid`               | no   | `kind = reopened`         |           |
| `fix_id`     | `uuid`               | no   | `kind = reopened`         |           |
| `at`         | `timestamp`          | no   | `kind = reopened`         |           |
| `kind`       | `"reopened"`         | no   | `kind = reopened`         |           |
| `check_id`   | `uuid`               | no   | `kind = reopened`         | brief     |

### Change

Fixture collection: `changes`.

| Screen            | Shows                                    |
| ----------------- | ---------------------------------------- |
| Final-Dashboard   | "What changed, by site"                  |
| Final-Alerts      | "Everything that was sent, newest first" |
| Final-Seg-Changes | "Cause we found"                         |
| Final-Home        | "robots.txt changed at 07:40"            |

| Field                       | Type            | Null | Added for         |
| --------------------------- | --------------- | ---- | ----------------- |
| `id`                        | `uuid`          | no   |                   |
| `site_id`                   | `uuid`          | no   |                   |
| `check_id`                  | `uuid`          | no   |                   |
| `previous_check_id`         | `uuid`          | yes  |                   |
| `detected_at`               | `timestamp`     | no   | Final-Dashboard   |
| `kind`                      | `ChangeKind`    | no   | Final-Seg-Changes |
| `subject`                   | `ChangeSubject` | no   | Final-Alerts      |
| `summary`                   | `string`        | no   | Final-Dashboard   |
| `where`                     | `string`        | no   | Final-Seg-Changes |
| `pages_affected`            | `integer`       | no   | Final-Dashboard   |
| `ua`                        | `string`        | yes  | Final-Dashboard   |
| `grade_deltas`              | `object[]`      | no   | Final-Alerts      |
| `grade_deltas[].grade`      | `GradeName`     | no   |                   |
| `grade_deltas[].from_score` | `number`        | no   |                   |
| `grade_deltas[].to_score`   | `number`        | no   |                   |
| `grade_deltas[].from_grade` | `GradeLetter`   | no   |                   |
| `grade_deltas[].to_grade`   | `GradeLetter`   | no   |                   |
| `cause`                     | `object`        | yes  | Final-Seg-Changes |
| `cause.text`                | `string`        | no   |                   |
| `cause.changed_at`          | `timestamp`     | yes  |                   |
| `cause.diff`                | `object`        | yes  |                   |
| `cause.diff.removed`        | `string[]`      | no   |                   |
| `cause.diff.added`          | `string[]`      | no   |                   |
| `fix_id`                    | `uuid`          | yes  | Final-Dashboard   |
| `notified`                  | `object`        | yes  | Final-Alerts      |
| `notified.channels`         | `Channel[]`     | no   |                   |
| `notified.slack_channel`    | `string`        | yes  |                   |
| `notified.sent_at`          | `timestamp`     | no   |                   |

### AlertRule

Fixture collection: `alert_rules`.

| Screen       | Shows                  |
| ------------ | ---------------------- |
| Final-Alerts | "Rules, all sites"     |
| Final-Site   | "Alerts for this site" |

| Field                 | Type            | Null | Added for    |
| --------------------- | --------------- | ---- | ------------ |
| `id`                  | `uuid`          | no   |              |
| `account_id`          | `uuid`          | no   |              |
| `site_id`             | `uuid`          | yes  |              |
| `kind`                | `AlertRuleKind` | no   | Final-Alerts |
| `enabled`             | `boolean`       | no   | Final-Alerts |
| `threshold_points`    | `number`        | yes  | Final-Alerts |
| `channels`            | `Channel[]`     | no   | Final-Alerts |
| `last_fired_at`       | `timestamp`     | yes  | Final-Site   |
| `last_fired_check_id` | `uuid`          | yes  | Final-Site   |

### Report

Fixture collection: `reports`.

| Screen           | Shows                                               |
| ---------------- | --------------------------------------------------- |
| Final-Reports    | "Reports made"                                      |
| Final-Ag-Reports | "Client reports"                                    |
| Final-Site       | "Public link"                                       |
| Final-Agencies   | "The prospect one-pager, as the client receives it" |

| Field              | Type           | Null | Added for        |
| ------------------ | -------------- | ---- | ---------------- |
| `id`               | `uuid`         | no   |                  |
| `account_id`       | `uuid`         | no   |                  |
| `site_id`          | `uuid`         | no   |                  |
| `kind`             | `ReportKind`   | no   | Final-Reports    |
| `format`           | `ReportFormat` | no   | Final-Reports    |
| `status`           | `ReportStatus` | no   | Final-Ag-Reports |
| `made_by`          | `ReportMaker`  | no   | Final-Reports    |
| `created_at`       | `timestamp`    | no   | Final-Reports    |
| `covers_check_ids` | `uuid[]`       | no   | Final-Reports    |
| `byte_count`       | `integer`      | yes  | Final-Reports    |
| `share_expires_at` | `timestamp`    | yes  | Final-Reports    |
| `public_slug`      | `string`       | yes  | Final-Site       |
| `scheduled_for`    | `timestamp`    | yes  | Final-Ag-Reports |
| `sent_at`          | `timestamp`    | yes  | Final-Ag-Reports |
| `recipient_email`  | `email`        | yes  | Final-Ag-Reports |
| `owner_seat_id`    | `uuid`         | yes  | Final-Ag-Reports |
| `headline`         | `string`       | yes  | Final-Ag-Reports |
| `open_tracking`    | `boolean`      | no   | Final-Ag-Reports |
| `opened_at`        | `timestamp`    | yes  | Final-Ag-Reports |

### CrawlerRegistryEntry

Seed data: `packages/engine/src/v2/crawler-registry.ts`.

| Screen        | Shows                                        |
| ------------- | -------------------------------------------- |
| Final-Pricing | "Every plan audits as the same six crawlers" |
| Final-Crawl   | "Googlebot and Bingbot render JavaScript"    |

| Field                 | Type                   | Null | Added for    |
| --------------------- | ---------------------- | ---- | ------------ |
| `token`               | `string`               | no   |              |
| `group`               | `CrawlerGroup`         | no   |              |
| `scored`              | `boolean`              | no   | FACTS        |
| `operator`            | `string`               | no   | Final-Result |
| `purpose`             | `string`               | no   |              |
| `robots_token`        | `string`               | no   |              |
| `ua_string`           | `string`               | yes  |              |
| `verification_method` | `VerificationMethod[]` | no   |              |
| `ip_list_url`         | `url`                  | yes  | brief        |
| `testable`            | `boolean`              | no   |              |
| `needs_owner_logs`    | `boolean`              | no   |              |
| `source_url`          | `url`                  | no   |              |
| `source_notes`        | `string[]`             | no   | brief        |
| `as_of`               | `date`                 | yes  |              |

## Fields added beyond the brief

| Entity               | Field                                  | Added for            |
| -------------------- | -------------------------------------- | -------------------- |
| Account              | `email`                                | Final-Settings       |
| Account              | `name`                                 | Final-Settings       |
| Account              | `state_history`                        | FACTS                |
| Account              | `trial_ends_at`                        | Final-Dashboard      |
| Account              | `card_last4`                           | Final-Ag-Matrix      |
| Account              | `renews_at`                            | Final-Ag-Matrix      |
| Account              | `billing_period_months`                | Final-Ag-Matrix      |
| Account              | `timezone`                             | FACTS                |
| Account              | `limits`                               | Final-Settings       |
| Account              | `email_prefs`                          | Final-Settings       |
| Account              | `integrations`                         | Final-Settings       |
| Account              | `api_keys`                             | Final-Developers     |
| Account              | `branding`                             | Final-Ag-Branding    |
| Account              | `branding.postal_address`              | FACTS                |
| Account              | `agency_trial_consent`                 | FACTS                |
| Seat                 | `email`                                | Final-Ag-Seats       |
| Seat                 | `name`                                 | Final-Ag-Seats       |
| Seat                 | `role`                                 | Final-Ag-Seats       |
| Seat                 | `client_scope`                         | Final-Ag-Seats       |
| Seat                 | `alert_channels`                       | Final-Ag-Seats       |
| Seat                 | `invited_at`                           | Final-Ag-Seats       |
| Seat                 | `accepted_at`                          | Final-Ag-Seats       |
| Seat                 | `theme`                                | Final-Settings       |
| Site                 | `host`                                 | Final-Site           |
| Site                 | `staging_of_site_id`                   | Final-Site           |
| Site                 | `client_name`                          | Final-Ag-Matrix      |
| Site                 | `client_contact_name`                  | Final-Ag-Client      |
| Site                 | `client_contact_email`                 | Final-Ag-Client      |
| Site                 | `schedule`                             | Final-Site           |
| Site                 | `paused`                               | Final-TrialEnd       |
| Site                 | `competitor_hosts`                     | Final-Site           |
| Site                 | `slack_channel`                        | Final-Ag-Client      |
| Site                 | `owner_seat_id`                        | Final-Ag-Client      |
| Site                 | `client_report`                        | Final-Ag-Client      |
| Site                 | `client_report.timezone`               | Final-Ag-Reports     |
| Site                 | `client_report.page_slug`              | Final-Ag-Client      |
| Site                 | `client_report.paused_by_recipient_at` | FACTS                |
| Check                | `trigger`                              | Final-Site           |
| Check                | `queued_at`                            | Final-Crawl          |
| Check                | `started_at`                           | Final-Crawl          |
| Check                | `finished_at`                          | Final-Home           |
| Check                | `tested_at`                            | Final-Segment        |
| Check                | `expires_at`                           | Final-Result         |
| Check                | `deferred_until`                       | brief                |
| Check                | `failure_reason`                       | brief                |
| Check                | `result_email`                         | Final-Crawl          |
| Check                | `coverage.gradeable`                   | brief                |
| Check                | `coverage.excluded`                    | brief                |
| Check                | `technical_seo.site_structure_score`   | Final-Seg-Structure  |
| Check                | `structure`                            | Final-Seg-Structure  |
| Check                | `without_js`                           | Final-Seg-JS         |
| Check                | `content`                              | Final-Seg-Content    |
| Check                | `signals`                              | Final-Seg-Signals    |
| Check                | `crawlers`                             | Final-Segment        |
| Check                | `stack`                                | Final-Fix            |
| Check                | `competitors`                          | Final-Seg-Signals    |
| Check                | `progress`                             | Final-Crawl          |
| PageResult           | `url`                                  | Final-Seg-JS         |
| PageResult           | `template_key`                         | Final-Seg-JS         |
| PageResult           | `kind`                                 | brief                |
| PageResult           | `status_code`                          | Final-LinkMap        |
| PageResult           | `depth`                                | Final-LinkMap        |
| PageResult           | `links_in`                             | Final-LinkMap        |
| PageResult           | `links_out`                            | Final-LinkMap        |
| PageResult           | `pagerank_share`                       | Final-LinkMap        |
| PageResult           | `is_orphan`                            | Final-Seg-Structure  |
| PageResult           | `js_only`                              | Final-LinkMap        |
| PageResult           | `found_via`                            | Final-Seg-Structure  |
| PageResult           | `sitemap_lastmod`                      | Final-Seg-Structure  |
| PageResult           | `suggested_parent_url`                 | Final-Seg-Structure  |
| PageResult           | `sampled`                              | Final-Seg-JS         |
| PageResult           | `without_js`                           | Final-Seg-JS         |
| PageResult           | `crawlers_reached`                     | Final-LinkMap        |
| PageResult           | `crawlers_reading_text`                | Final-Seg-Structure  |
| PageResult           | `content_failures`                     | Final-Seg-Content    |
| LinkEdge             | `from_url`                             | Final-LinkMap        |
| LinkEdge             | `to_url`                               | Final-LinkMap        |
| LinkEdge             | `anchor_text`                          | Final-LinkMap        |
| LinkEdge             | `is_generic_anchor`                    | Final-LinkMap        |
| LinkEdge             | `js_only`                              | Final-Seg-Structure  |
| AccessTest           | `ua`                                   | FACTS                |
| AccessTest           | `page_url`                             | Final-Segment        |
| AccessTest           | `template_key`                         | Final-Segment        |
| AccessTest           | `tested_at`                            | Final-Segment        |
| AccessTest           | `verdict`                              | FACTS                |
| AccessTest           | `cause`                                | FACTS                |
| AccessTest           | `request_headers`                      | Final-Segment        |
| AccessTest           | `body_excerpt`                         | Final-Segment        |
| Fix                  | `number`                               | Final-Site           |
| Fix                  | `section`                              | Final-Site           |
| Fix                  | `title`                                | Final-Fix            |
| Fix                  | `detail`                               | Final-Seg-Structure  |
| Fix                  | `crawler_uas`                          | Final-Segment        |
| Fix                  | `rank`                                 | Final-Dashboard-Day0 |
| Fix                  | `effort`                               | Final-Public         |
| Fix                  | `before_after`                         | Final-Fix            |
| Fix                  | `packet`                               | Final-Fix            |
| FixEvent             | `check_id`                             | brief                |
| Change               | `detected_at`                          | Final-Dashboard      |
| Change               | `kind`                                 | Final-Seg-Changes    |
| Change               | `subject`                              | Final-Alerts         |
| Change               | `summary`                              | Final-Dashboard      |
| Change               | `where`                                | Final-Seg-Changes    |
| Change               | `pages_affected`                       | Final-Dashboard      |
| Change               | `ua`                                   | Final-Dashboard      |
| Change               | `grade_deltas`                         | Final-Alerts         |
| Change               | `cause`                                | Final-Seg-Changes    |
| Change               | `fix_id`                               | Final-Dashboard      |
| Change               | `notified`                             | Final-Alerts         |
| AlertRule            | `kind`                                 | Final-Alerts         |
| AlertRule            | `enabled`                              | Final-Alerts         |
| AlertRule            | `threshold_points`                     | Final-Alerts         |
| AlertRule            | `channels`                             | Final-Alerts         |
| AlertRule            | `last_fired_at`                        | Final-Site           |
| AlertRule            | `last_fired_check_id`                  | Final-Site           |
| Report               | `kind`                                 | Final-Reports        |
| Report               | `format`                               | Final-Reports        |
| Report               | `status`                               | Final-Ag-Reports     |
| Report               | `made_by`                              | Final-Reports        |
| Report               | `created_at`                           | Final-Reports        |
| Report               | `covers_check_ids`                     | Final-Reports        |
| Report               | `byte_count`                           | Final-Reports        |
| Report               | `share_expires_at`                     | Final-Reports        |
| Report               | `public_slug`                          | Final-Site           |
| Report               | `scheduled_for`                        | Final-Ag-Reports     |
| Report               | `sent_at`                              | Final-Ag-Reports     |
| Report               | `recipient_email`                      | Final-Ag-Reports     |
| Report               | `owner_seat_id`                        | Final-Ag-Reports     |
| Report               | `headline`                             | Final-Ag-Reports     |
| Report               | `open_tracking`                        | Final-Ag-Reports     |
| Report               | `opened_at`                            | Final-Ag-Reports     |
| CrawlerRegistryEntry | `scored`                               | FACTS                |
| CrawlerRegistryEntry | `operator`                             | Final-Result         |
| CrawlerRegistryEntry | `ip_list_url`                          | brief                |
| CrawlerRegistryEntry | `source_notes`                         | brief                |

## Rules

Every rule a schema enforces beyond shape, from `rules.ts`. A two-way rule ("X exactly when Y") can break in either direction, and has test cases that break it each way.

| Rule                      | Message                                                                           | Breaks    |
| ------------------------- | --------------------------------------------------------------------------------- | --------- |
| `billing_period`          | billing is monthly (1) or annual (12)                                             | one way   |
| `history_current`         | the last state_history entry must be the current state                            | one way   |
| `history_forward`         | state_history must move forward in time                                           | one way   |
| `trial_consent`           | trial consent is recorded exactly when the account has had an Agency trial        | both ways |
| `trial_ends`              | trial_ends_at is set exactly while on a trial                                     | both ways |
| `branding_dns`            | dns status exists exactly when a report domain is set                             | both ways |
| `branding_email_auth`     | email checks exist exactly when a sender is set                                   | both ways |
| `branding_postal`         | a sender address needs a postal address for the footer                            | one way   |
| `time_zone`               | not an IANA time zone                                                             | one way   |
| `crawled_text_budget`     | crawled text is over its UTF-8 byte budget                                        | one way   |
| `crawled_text_surrogate`  | crawled text has a lone surrogate, which cannot be stored                         | one way   |
| `verification_alone`      | none_published stands alone                                                       | one way   |
| `verification_unique`     | verification methods are listed once each                                         | one way   |
| `ip_list_url`             | ip_list_url is set exactly when an IP list is published                           | both ways |
| `effect_pending`          | an AI effect is either estimated, or not yet estimated because of named fixes     | both ways |
| `fix_last_state`          | last_state does not fit the status                                                | one way   |
| `fix_rank`                | every live fix has a rank and a resolved fix has none                             | both ways |
| `packet_framework`        | the packet framework must be one of its switch options                            | one way   |
| `coverage_gradeable`      | gradeable and excluded pages cannot exceed the pages crawled                      | one way   |
| `coverage_crawled`        | pages_crawled cannot exceed pages_discovered                                      | one way   |
| `coverage_sampled`        | pages_sampled cannot exceed the crawl or the sample cap                           | one way   |
| `crawler_scored`          | exactly the ai_search crawlers are scored (FACTS I6)                              | both ways |
| `check_progress`          | progress is present exactly while running                                         | both ways |
| `check_not_started`       | not started yet                                                                   | one way   |
| `check_started`           | started_at is required                                                            | one way   |
| `check_finished_at`       | finished_at is set exactly when the check has ended                               | both ways |
| `check_deferred_until`    | deferred_until is set exactly when deferred                                       | both ways |
| `check_failure_reason`    | failure_reason is set exactly when failed                                         | both ways |
| `check_coverage`          | coverage is set exactly when the crawl has finished                               | both ways |
| `check_both_grades`       | a finished check carries both grades                                              | one way   |
| `check_grades_when_ended` | only a finished or partial check carries grades                                   | one way   |
| `check_result_link`       | the result link expires after it is sent                                          | one way   |
| `i4_withheld`             | AI readability is withheld when fewer than two scored crawlers were measured (I4) | one way   |
| `i4_given`                | AI readability is given when two or more scored crawlers were measured (I4)       | one way   |
| `score_grade_pair`        | score and grade are both present or both null                                     | both ways |
| `refusal_score`           | a refused grade has no score; a given one has                                     | both ways |
| `access_range_order`      | access_range.min must not exceed max                                              | one way   |
| `total_sum`               | total is not the sum of its components                                            | one way   |
| `schedule_timed`          | a timed schedule has a weekday; on_deploy has none                                | both ways |
| `schedule_pair`           | a schedule sets its weekday and its hour together                                 | both ways |
| `unkept_audit`            | an unkept audit has no schedule, client report or owner                           | one way   |
| `client_report_cadence`   | client reports go out weekly or monthly                                           | one way   |
| `alert_threshold`         | only the text-drop rule has a threshold, and it always has one                    | both ways |
| `alert_fired_pair`        | a firing records both when and which check                                        | both ways |
| `report_sent`             | sent_at is set exactly when sent                                                  | both ways |
| `report_send_time`        | a scheduled or held report has a send time                                        | one way   |
| `report_slug`             | only a public link has a slug                                                     | both ways |
| `report_open_tracking`    | an open is known only with tracking on                                            | one way   |
| `observed_owner_logs`     | observed evidence comes from owner logs, and only it does                         | both ways |

## Enums

| Enum                  | Coverage                   | Values                                                                                                                                                                                                                                                                           |
| --------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Verdict`             | every value in a fixture   | allowed, allowed_thin, disallowed_by_robots, blocked_by_ua_rule, challenged_ua, refused_unverified, rate_limited, payment_required, edge_blocks_automation, redirected_away, not_measured                                                                                        |
| `EvidenceClass`       | every value in a fixture   | declared, simulated, observed                                                                                                                                                                                                                                                    |
| `CrawlerGroup`        | every value in a fixture   | search_engine, ai_search, ai_training                                                                                                                                                                                                                                            |
| `DetectionState`      | every value in a fixture   | detected, not_detected, indeterminate                                                                                                                                                                                                                                            |
| `FixStatus`           | every value in a fixture   | open, marked_done, verified_resolved, unable_to_verify, reopened                                                                                                                                                                                                                 |
| `RecommendationClass` | every value in a fixture   | confirmed_defect, documented_requirement, best_practice, experimental                                                                                                                                                                                                            |
| `CheckStatus`         | every value in a fixture   | queued, running, finished, partial, failed, deferred                                                                                                                                                                                                                             |
| `AccountState`        | every value in a fixture   | free, pro_trial, pro, agency_trial, agency, past_due                                                                                                                                                                                                                             |
| `Confidence`          | every value in a fixture   | confirmed, likely, inconclusive                                                                                                                                                                                                                                                  |
| `SourceIpClass`       | every value in a fixture   | fly_egress, browser_rendering, owner_logs                                                                                                                                                                                                                                        |
| `GradeName`           | every value in a fixture   | technical_seo, ai_readability                                                                                                                                                                                                                                                    |
| `FixSection`          | every value in a fixture   | crawler_access, without_js, structure, content                                                                                                                                                                                                                                   |
| `FixType`             | every value in a fixture   | robots_txt_blocks_crawler, edge_rule_blocks_crawler, client_rendered_template, orphan_pages, quotable_opening, generic_anchor_text, deep_pages, specs_as_images, missing_author_date, js_only_navigation, redirect_chain, duplicate_pagination, canonical_mismatch, hreflang_gap |
| `FixMeasure`          | every value in a fixture   | words_without_js, crawlers_reading_text, quotable_opening, text_share                                                                                                                                                                                                            |
| `EstimateBound`       | every value in a fixture   | exact, approx, at_least                                                                                                                                                                                                                                                          |
| `PacketFramework`     | every value in a fixture   | nextjs, shopify_liquid, shopify_hydrogen, wordpress, webflow, generic                                                                                                                                                                                                            |
| `CheckTrigger`        | every value in a fixture   | first_audit, manual, scheduled, deploy, fix_recheck                                                                                                                                                                                                                              |
| `CheckPhase`          | every value in a fixture   | robots_and_sitemap, homepage, crawl, crawler_tests, without_js, grading                                                                                                                                                                                                          |
| `StepState`           | every value in a fixture   | done, now, next                                                                                                                                                                                                                                                                  |
| `SampleMethod`        | every value in a fixture   | stratified_by_template, census                                                                                                                                                                                                                                                   |
| `AccessCause`         | every value in a fixture   | cloudflare_1020, bot_fight_mode, client_rendered_template, robots_txt_disallow, automation_challenge, rate_limit_429, pay_per_crawl_402, cross_host_redirect, verified_bot_only                                                                                                  |
| `SignalKind`          | every value in a fixture   | schema_org, content_signals, web_bot_auth, llms_txt, mcp_server_card, markdown_negotiation, agent_skills_index                                                                                                                                                                   |
| `ContentCheck`        | every value in a fixture   | direct_answer_150, question_headings, schema_with_description, author_and_date, specs_as_text                                                                                                                                                                                    |
| `JsTextState`         | every value in a fixture   | readable, partial, empty_shell                                                                                                                                                                                                                                                   |
| `FoundVia`            | every value in a fixture   | link, sitemap, javascript                                                                                                                                                                                                                                                        |
| `Cadence`             | every value in a fixture   | weekly, monthly, on_deploy                                                                                                                                                                                                                                                       |
| `ChangeKind`          | every value in a fixture   | opened, resolved, changed                                                                                                                                                                                                                                                        |
| `ChangeSubject`       | every value in a fixture   | crawler_access, text_without_js, grade, orphans, content, deploy                                                                                                                                                                                                                 |
| `Channel`             | every value in a fixture   | email, slack                                                                                                                                                                                                                                                                     |
| `AlertRuleKind`       | every value in a fixture   | crawler_blocked, text_drop, grade_letter_moved, new_orphans, fix_regressed, any_change                                                                                                                                                                                           |
| `ReportKind`          | every value in a fixture   | audit_pdf, compare, raw_export, public_link, client_report, prospect_one_pager                                                                                                                                                                                                   |
| `ReportFormat`        | every value in a fixture   | pdf, csv, json, edge_list, html                                                                                                                                                                                                                                                  |
| `ReportStatus`        | every value in a fixture   | ready, scheduled, held, sent                                                                                                                                                                                                                                                     |
| `ReportMaker`         | every value in a fixture   | user, scheduled_check, report_schedule                                                                                                                                                                                                                                           |
| `SeatRole`            | every value in a fixture   | owner, account_manager, developer                                                                                                                                                                                                                                                |
| `Theme`               | every value in a fixture   | system, light, dark                                                                                                                                                                                                                                                              |
| `IntegrationKind`     | every value in a fixture   | slack, search_console, vercel, cloudflare_analytics, vercel_drain                                                                                                                                                                                                                |
| `WithheldCollection`  | every value in a fixture   | page_results, link_edges, access_tests                                                                                                                                                                                                                                           |
| `GradeLetter`         | pinned to v1 or the engine | A, A-, B+, B, B-, C+, C, C-, D+, D, D-, F                                                                                                                                                                                                                                        |
| `PageKind`            | pinned to v1 or the engine | content, auth, search, pagination, archive, feed, status, utility, duplicate, thin                                                                                                                                                                                               |
| `CmsName`             | pinned to v1 or the engine | shopify, wordpress, webflow, wix, squarespace, framer, ghost, custom                                                                                                                                                                                                             |
| `RefusalTrigger`      | pinned to v1 or the engine | too_few_gradeable_pages, site_too_small_to_measure, too_few_gradeable_after_exclusion, nothing_read, no_observed_links                                                                                                                                                           |
| `VerificationMethod`  | registry seed only         | ip_list, reverse_dns, none_published                                                                                                                                                                                                                                             |

## Open items for the engine stream

- How `template_key` is derived. The screens group pages by template (`/collections/{slug}`); the v1 engine's `templateKeyFor` keeps short slugs literal (`/collections/tents`), so it does not produce that grouping as it stands. See `TemplateKeySchema` in `common.ts`.
- AI readability's letter scale. No document defines it, so the contract does not pin AI letters to scores; Technical SEO letters are pinned to `scoreToLetter`. Choosing the scale moves band boundaries, which OPERATING-RULES §5 Amendment 2 treats as re-curving.
- Where the result-email recipient is kept until the check finishes. It is deliberately not on `Check`, which public reports and the API read; a private delivery record belongs to the stream that sends the email.
- Every value a fixture lists in `engine_derived` is regenerated by the engine at CC-19.

## Fixtures

Records per collection in each frozen fixture under `apps/web/lib/fixtures/v2/`. `engine_derived` counts the JSON pointers to values FACTS marks ENGINE-DERIVED.

| Fixture                | as_of                | accounts | seats | sites | checks | page_results | link_edges | access_tests | fixes | fix_events | changes | alert_rules | reports | engine_derived |
| ---------------------- | -------------------- | -------- | ----- | ----- | ------ | ------------ | ---------- | ------------ | ----- | ---------- | ------- | ----------- | ------- | -------------- |
| `bad-site.json`        | 2026-10-30T10:05:00Z | 1        | 1     | 5     | 15     | 16           | 11         | 10           | 15    | 4          | 6       | 6           | 4       | 169            |
| `clean-site.json`      | 2026-10-27T15:42:00Z | 0        | 0     | 1     | 2      | 2            | 2          | 2            | 0     | 0          | 0       | 0           | 0       | 4              |
| `challenged-site.json` | 2026-11-02T12:00:00Z | 2        | 5     | 3     | 7      | 1            | 0          | 9            | 2     | 3          | 1       | 2           | 6       | 9              |
