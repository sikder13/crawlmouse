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

| Field                                          | Type                   | Null | Variant            | Added for           |
| ---------------------------------------------- | ---------------------- | ---- | ------------------ | ------------------- |
| `id`                                           | `uuid`                 | no   |                    |                     |
| `site_id`                                      | `uuid`                 | no   |                    |                     |
| `previous_check_id`                            | `uuid`                 | yes  |                    |                     |
| `status`                                       | `CheckStatus`          | no   |                    |                     |
| `trigger`                                      | `CheckTrigger`         | no   |                    | Final-Site          |
| `grade_version`                                | `string`               | no   |                    |                     |
| `queued_at`                                    | `timestamp`            | no   |                    | Final-Crawl         |
| `started_at`                                   | `timestamp`            | yes  |                    | Final-Crawl         |
| `finished_at`                                  | `timestamp`            | yes  |                    | Final-Home          |
| `tested_at`                                    | `timestamp`            | yes  |                    | Final-Segment       |
| `expires_at`                                   | `timestamp`            | yes  |                    | Final-Result        |
| `deferred_until`                               | `timestamp`            | yes  |                    | brief               |
| `failure_reason`                               | `string`               | yes  |                    | brief               |
| `result_email`                                 | `object`               | yes  |                    | Final-Crawl         |
| `result_email.sent_at`                         | `timestamp`            | yes  |                    |                     |
| `result_email.link_expires_at`                 | `timestamp`            | no   |                    |                     |
| `coverage`                                     | `object`               | yes  |                    |                     |
| `coverage.pages_discovered`                    | `integer`              | no   |                    |                     |
| `coverage.pages_crawled`                       | `integer`              | no   |                    |                     |
| `coverage.pages_sampled`                       | `integer`              | no   |                    |                     |
| `coverage.templates`                           | `object[]`             | no   |                    |                     |
| `coverage.templates[].template_key`            | `string`               | no   |                    |                     |
| `coverage.templates[].label`                   | `string`               | no   |                    |                     |
| `coverage.templates[].pages`                   | `integer`              | no   |                    |                     |
| `coverage.sample_strategy`                     | `object`               | no   |                    |                     |
| `coverage.sample_strategy.method`              | `SampleMethod`         | no   |                    |                     |
| `coverage.sample_strategy.max_pages`           | `integer`              | no   |                    |                     |
| `coverage.gradeable`                           | `integer`              | no   |                    | brief               |
| `coverage.excluded`                            | `object[]`             | no   |                    | brief               |
| `coverage.excluded[].kind`                     | `PageKind`             | no   |                    |                     |
| `coverage.excluded[].count`                    | `integer`              | no   |                    |                     |
| `coverage.excluded_by_robots`                  | `integer`              | no   |                    | brief               |
| `technical_seo`                                | `object`               | yes  |                    |                     |
| `technical_seo.score`                          | `number`               | yes  |                    |                     |
| `technical_seo.grade`                          | `GradeLetter`          | yes  |                    |                     |
| `technical_seo.breakdown`                      | `object`               | no   |                    |                     |
| `technical_seo.breakdown.orphanRatioScore`     | `number`               | no   |                    |                     |
| `technical_seo.breakdown.depthScore`           | `number`               | no   |                    |                     |
| `technical_seo.breakdown.anchorDiversityScore` | `number`               | no   |                    |                     |
| `technical_seo.breakdown.structureScore`       | `number`               | no   |                    |                     |
| `technical_seo.refusal`                        | `object`               | no   |                    |                     |
| `technical_seo.refusal.refused`                | `boolean`              | no   |                    |                     |
| `technical_seo.refusal.triggers`               | `RefusalTrigger[]`     | no   |                    |                     |
| `technical_seo.refusal.confidenceCapped`       | `boolean`              | no   |                    |                     |
| `technical_seo.refusal.unevaluable`            | `RefusalTrigger[]`     | no   |                    |                     |
| `technical_seo.site_structure_score`           | `number`               | yes  |                    | Final-Seg-Structure |
| `ai_readability`                               | `one of 2 variants`    | yes  |                    |                     |
| `ai_readability.withheld`                      | `false`                | no   | `withheld = false` |                     |
| `ai_readability.withheld_reasons`              | `WithheldReason[]`     | no   | `withheld = false` |                     |
| `ai_readability.total`                         | `number`               | no   | `withheld = false` |                     |
| `ai_readability.grade`                         | `GradeLetter`          | no   | `withheld = false` |                     |
| `ai_readability.components`                    | `object`               | no   | `withheld = false` |                     |
| `ai_readability.components.access`             | `object`               | no   | `withheld = false` |                     |
| `ai_readability.components.access.score`       | `number`               | no   | `withheld = false` |                     |
| `ai_readability.components.access.max`         | `40`                   | no   | `withheld = false` |                     |
| `ai_readability.components.access.heuristic`   | `false`                | no   | `withheld = false` |                     |
| `ai_readability.components.access.range`       | `null`                 | no   | `withheld = false` |                     |
| `ai_readability.components.readable`           | `object`               | no   | `withheld = false` |                     |
| `ai_readability.components.readable.score`     | `number`               | no   | `withheld = false` |                     |
| `ai_readability.components.readable.max`       | `30`                   | no   | `withheld = false` |                     |
| `ai_readability.components.readable.heuristic` | `false`                | no   | `withheld = false` |                     |
| `ai_readability.components.readable.range`     | `null`                 | no   | `withheld = false` |                     |
| `ai_readability.components.quotable`           | `object`               | no   | `withheld = false` |                     |
| `ai_readability.components.quotable.score`     | `number`               | no   | `withheld = false` |                     |
| `ai_readability.components.quotable.max`       | `20`                   | no   | `withheld = false` |                     |
| `ai_readability.components.quotable.heuristic` | `true`                 | no   | `withheld = false` |                     |
| `ai_readability.components.quotable.range`     | `null`                 | no   | `withheld = false` |                     |
| `ai_readability.components.signals`            | `object`               | no   | `withheld = false` |                     |
| `ai_readability.components.signals.score`      | `number`               | no   | `withheld = false` |                     |
| `ai_readability.components.signals.max`        | `10`                   | no   | `withheld = false` |                     |
| `ai_readability.components.signals.heuristic`  | `false`                | no   | `withheld = false` |                     |
| `ai_readability.components.signals.range`      | `null`                 | no   | `withheld = false` |                     |
| `ai_readability.access_range`                  | `null`                 | no   | `withheld = false` |                     |
| `ai_readability.scored_from_fewer_crawlers`    | `integer`              | yes  | `withheld = false` |                     |
| `ai_readability.withheld`                      | `true`                 | no   | `withheld = true`  |                     |
| `ai_readability.withheld_reasons`              | `WithheldReason[]`     | no   | `withheld = true`  |                     |
| `ai_readability.total`                         | `null`                 | no   | `withheld = true`  |                     |
| `ai_readability.grade`                         | `null`                 | no   | `withheld = true`  |                     |
| `ai_readability.components`                    | `object`               | no   | `withheld = true`  |                     |
| `ai_readability.components.access`             | `object`               | no   | `withheld = true`  |                     |
| `ai_readability.components.access.score`       | `number`               | yes  | `withheld = true`  |                     |
| `ai_readability.components.access.max`         | `40`                   | no   | `withheld = true`  |                     |
| `ai_readability.components.access.heuristic`   | `false`                | no   | `withheld = true`  |                     |
| `ai_readability.components.access.range`       | `object`               | yes  | `withheld = true`  |                     |
| `ai_readability.components.access.range.min`   | `number`               | no   | `withheld = true`  |                     |
| `ai_readability.components.access.range.max`   | `number`               | no   | `withheld = true`  |                     |
| `ai_readability.components.readable`           | `object`               | no   | `withheld = true`  |                     |
| `ai_readability.components.readable.score`     | `number`               | yes  | `withheld = true`  |                     |
| `ai_readability.components.readable.max`       | `30`                   | no   | `withheld = true`  |                     |
| `ai_readability.components.readable.heuristic` | `false`                | no   | `withheld = true`  |                     |
| `ai_readability.components.readable.range`     | `object`               | yes  | `withheld = true`  |                     |
| `ai_readability.components.readable.range.min` | `number`               | no   | `withheld = true`  |                     |
| `ai_readability.components.readable.range.max` | `number`               | no   | `withheld = true`  |                     |
| `ai_readability.components.quotable`           | `object`               | no   | `withheld = true`  |                     |
| `ai_readability.components.quotable.score`     | `number`               | yes  | `withheld = true`  |                     |
| `ai_readability.components.quotable.max`       | `20`                   | no   | `withheld = true`  |                     |
| `ai_readability.components.quotable.heuristic` | `true`                 | no   | `withheld = true`  |                     |
| `ai_readability.components.quotable.range`     | `object`               | yes  | `withheld = true`  |                     |
| `ai_readability.components.quotable.range.min` | `number`               | no   | `withheld = true`  |                     |
| `ai_readability.components.quotable.range.max` | `number`               | no   | `withheld = true`  |                     |
| `ai_readability.components.signals`            | `object`               | no   | `withheld = true`  |                     |
| `ai_readability.components.signals.score`      | `number`               | yes  | `withheld = true`  |                     |
| `ai_readability.components.signals.max`        | `10`                   | no   | `withheld = true`  |                     |
| `ai_readability.components.signals.heuristic`  | `false`                | no   | `withheld = true`  |                     |
| `ai_readability.components.signals.range`      | `object`               | yes  | `withheld = true`  |                     |
| `ai_readability.components.signals.range.min`  | `number`               | no   | `withheld = true`  |                     |
| `ai_readability.components.signals.range.max`  | `number`               | no   | `withheld = true`  |                     |
| `ai_readability.access_range`                  | `object`               | yes  | `withheld = true`  |                     |
| `ai_readability.access_range.min`              | `number`               | no   | `withheld = true`  |                     |
| `ai_readability.access_range.max`              | `number`               | no   | `withheld = true`  |                     |
| `ai_readability.scored_from_fewer_crawlers`    | `integer`              | yes  | `withheld = true`  |                     |
| `structure`                                    | `object`               | yes  |                    | Final-Seg-Structure |
| `structure.internal_links`                     | `integer`              | no   |                    |                     |
| `structure.orphan_pages`                       | `integer`              | no   |                    |                     |
| `structure.js_only_pages`                      | `integer`              | no   |                    |                     |
| `structure.pages_deeper_than_3`                | `integer`              | no   |                    |                     |
| `structure.avg_click_depth`                    | `number`               | no   |                    |                     |
| `structure.hubs`                               | `integer`              | no   |                    |                     |
| `structure.hub_pagerank_share`                 | `number`               | no   |                    |                     |
| `structure.generic_anchor_share`               | `number`               | no   |                    |                     |
| `without_js`                                   | `object`               | yes  |                    | Final-Seg-JS        |
| `without_js.site_text_share`                   | `number`               | no   |                    |                     |
| `content`                                      | `object`               | yes  |                    | Final-Seg-Content   |
| `content.score`                                | `number`               | yes  |                    |                     |
| `content.score_withheld`                       | `ContentScoreWithheld` | yes  |                    |                     |
| `content.checks`                               | `object[]`             | no   |                    |                     |
| `content.checks[].check`                       | `ContentCheck`         | no   |                    |                     |
| `content.checks[].counted`                     | `boolean`              | no   |                    |                     |
| `content.checks[].by_template`                 | `object[]`             | no   |                    |                     |
| `content.checks[].by_template[].template_key`  | `string`               | no   |                    |                     |
| `content.checks[].by_template[].passing`       | `integer`              | no   |                    |                     |
| `content.checks[].by_template[].total`         | `integer`              | no   |                    |                     |
| `signals`                                      | `object[]`             | no   |                    | Final-Seg-Signals   |
| `signals[].signal`                             | `SignalKind`           | no   |                    |                     |
| `signals[].state`                              | `DetectionState`       | no   |                    |                     |
| `signals[].counts_toward_grade`                | `boolean`              | no   |                    |                     |
| `signals[].recommendation_class`               | `RecommendationClass`  | no   |                    | PR #48              |
| `signals[].evidence`                           | `string`               | no   |                    |                     |
| `crawlers`                                     | `object[]`             | no   |                    | Final-Segment       |
| `crawlers[].ua`                                | `string`               | no   |                    |                     |
| `crawlers[].group`                             | `CrawlerGroup`         | no   |                    |                     |
| `crawlers[].scored`                            | `boolean`              | no   |                    |                     |
| `crawlers[].verdict`                           | `Verdict`              | no   |                    |                     |
| `crawlers[].evidence_class`                    | `EvidenceClass`        | no   |                    |                     |
| `crawlers[].status`                            | `integer`              | yes  |                    |                     |
| `crawlers[].pages_measured`                    | `integer`              | no   |                    |                     |
| `crawlers[].cause`                             | `AccessCause`          | yes  |                    |                     |
| `crawlers[].text_share`                        | `number`               | yes  |                    |                     |
| `crawlers[].confidence`                        | `Confidence`           | no   |                    |                     |
| `crawlers[].by_template`                       | `object[]`             | no   |                    |                     |
| `crawlers[].by_template[].template_key`        | `string`               | no   |                    |                     |
| `crawlers[].by_template[].verdict`             | `Verdict`              | no   |                    |                     |
| `crawlers[].by_template[].status`              | `integer`              | yes  |                    |                     |
| `stack`                                        | `object`               | yes  |                    | Final-Fix           |
| `stack.frontend`                               | `object`               | yes  |                    |                     |
| `stack.frontend.name`                          | `string`               | no   |                    |                     |
| `stack.frontend.framework`                     | `PacketFramework`      | no   |                    | PR #49              |
| `stack.frontend.version`                       | `string`               | yes  |                    |                     |
| `stack.frontend.router`                        | `string`               | yes  |                    |                     |
| `stack.frontend.detected_from`                 | `string`               | no   |                    |                     |
| `stack.backend`                                | `object`               | yes  |                    |                     |
| `stack.backend.cms`                            | `CmsName`              | no   |                    |                     |
| `stack.backend.detected_from`                  | `string`               | no   |                    |                     |
| `stack.edge`                                   | `object`               | yes  |                    |                     |
| `stack.edge.vendor`                            | `string`               | no   |                    |                     |
| `stack.edge.detected_from`                     | `string`               | no   |                    |                     |
| `competitors`                                  | `object[]`             | no   |                    | Final-Seg-Signals   |
| `competitors[].host`                           | `string`               | no   |                    |                     |
| `competitors[].crawlers_with_access`           | `integer`              | no   |                    |                     |
| `competitors[].crawlers_tested`                | `integer`              | no   |                    |                     |
| `competitors[].text_share`                     | `number`               | no   |                    |                     |
| `competitors[].product_schema`                 | `boolean`              | no   |                    |                     |
| `competitors[].technical_seo`                  | `object`               | no   |                    |                     |
| `competitors[].technical_seo.score`            | `number`               | no   |                    |                     |
| `competitors[].technical_seo.grade`            | `GradeLetter`          | no   |                    |                     |
| `competitors[].ai_readability`                 | `object`               | yes  |                    |                     |
| `competitors[].ai_readability.score`           | `number`               | no   |                    |                     |
| `competitors[].ai_readability.grade`           | `GradeLetter`          | no   |                    |                     |
| `competitors[].signals_present`                | `integer`              | yes  |                    |                     |
| `progress`                                     | `object`               | yes  |                    | Final-Crawl         |
| `progress.steps`                               | `object[]`             | no   |                    |                     |
| `progress.steps[].phase`                       | `CheckPhase`           | no   |                    |                     |
| `progress.steps[].state`                       | `StepState`            | no   |                    |                     |
| `progress.pages_crawled`                       | `integer`              | no   |                    |                     |
| `progress.pages_estimated`                     | `integer`              | yes  |                    |                     |
| `progress.links_found`                         | `integer`              | no   |                    |                     |
| `progress.elapsed_ms`                          | `integer`              | no   |                    |                     |
| `progress.recent_fetches`                      | `object[]`             | no   |                    |                     |
| `progress.recent_fetches[].url`                | `url`                  | no   |                    |                     |
| `progress.recent_fetches[].status`             | `integer`              | no   |                    |                     |
| `progress.recent_fetches[].links`              | `integer`              | no   |                    |                     |

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
| `final_url`                 | `url`            | yes  | PR #47              |
| `redirect`                  | `object`         | yes  | PR #47              |
| `redirect.hops`             | `object[]`       | no   |                     |
| `redirect.hops[].from`      | `url`            | no   |                     |
| `redirect.hops[].status`    | `integer`        | no   |                     |
| `redirect.hops[].location`  | `url`            | yes  |                     |
| `redirect.loop`             | `boolean`        | no   |                     |
| `canonical_declared`        | `object`         | yes  | PR #47              |
| `canonical_declared.href`   | `string`         | yes  |                     |
| `canonical_declared.url`    | `url`            | yes  |                     |
| `hreflang`                  | `object`         | yes  | PR #47              |
| `hreflang.links`            | `object[]`       | no   |                     |
| `hreflang.links[].hreflang` | `string`         | no   |                     |
| `hreflang.links[].href`     | `url`            | no   |                     |
| `hreflang.complete`         | `boolean`        | no   |                     |
| `content_simhash`           | `string`         | yes  | PR #47              |
| `is_html`                   | `boolean`        | no   | brief               |
| `links_read`                | `boolean`        | no   | PR #47              |
| `robots_search`             | `object[]`       | no   | PR #47              |
| `robots_search[].ua`        | `string`         | no   |                     |
| `robots_search[].verdict`   | `Verdict`        | no   |                     |
| `title`                     | `object`         | yes  | CC-12d              |
| `title.text`                | `string`         | yes  |                     |
| `title.chars`               | `integer`        | no   |                     |
| `title.cut`                 | `boolean`        | no   |                     |
| `meta_description`          | `object`         | yes  | CC-12d              |
| `meta_description.text`     | `string`         | yes  |                     |
| `meta_description.chars`    | `integer`        | no   |                     |
| `meta_description.cut`      | `boolean`        | no   |                     |

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

| Field                     | Type                    | Null | Added for     |
| ------------------------- | ----------------------- | ---- | ------------- |
| `id`                      | `uuid`                  | no   |               |
| `check_id`                | `uuid`                  | no   |               |
| `ua`                      | `string`                | yes  | FACTS         |
| `page_url`                | `url`                   | no   | Final-Segment |
| `template_key`            | `string`                | no   | Final-Segment |
| `tested_at`               | `timestamp`             | no   | Final-Segment |
| `verdict`                 | `Verdict`               | no   | FACTS         |
| `evidence_class`          | `EvidenceClass`         | no   |               |
| `identity_sent`           | `string`                | no   |               |
| `source_ip_class`         | `SourceIpClass`         | no   |               |
| `limitations`             | `string[]`              | no   |               |
| `cause`                   | `AccessCause`           | yes  | FACTS         |
| `request_headers`         | `object[]`              | no   | Final-Segment |
| `request_headers[].name`  | `string`                | no   |               |
| `request_headers[].value` | `string`                | no   |               |
| `raw_status`              | `integer`               | yes  |               |
| `final_url`               | `url`                   | yes  |               |
| `headers`                 | `object[]`              | no   |               |
| `headers[].name`          | `string`                | no   |               |
| `headers[].value`         | `string`                | no   |               |
| `byte_count`              | `integer`               | yes  |               |
| `word_count`              | `integer`               | yes  |               |
| `body_excerpt`            | `string`                | yes  | Final-Segment |
| `method`                  | `"GET"`                 | yes  | PR #48        |
| `http_version`            | `"1.1"`                 | yes  | PR #48        |
| `identity_role`           | `IdentityRole`          | no   | PR #54        |
| `tagged`                  | `boolean`               | no   | PR #55        |
| `witness`                 | `object`                | yes  | PR #54        |
| `witness.role`            | `WitnessRole`           | no   |               |
| `witness.ua`              | `string`                | no   |               |
| `fly_region`              | `string`                | yes  | PR #55        |
| `request_signing`         | `RequestSigning`        | yes  | PR #55        |
| `signature_verified`      | `SignatureVerification` | yes  | PR #55        |
| `worker_release`          | `string`                | yes  | PR #55        |
| `timing`                  | `object`                | yes  | PR #55        |
| `timing.dns_ms`           | `integer`               | yes  |               |
| `timing.connect_ms`       | `integer`               | yes  |               |
| `timing.ttfb_ms`          | `integer`               | yes  |               |
| `timing.total_ms`         | `integer`               | no   |               |

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

| Field                                 | Type                         | Null | Variant            | Added for            |
| ------------------------------------- | ---------------------------- | ---- | ------------------ | -------------------- |
| `id`                                  | `uuid`                       | no   |                    |                      |
| `site_id`                             | `uuid`                       | no   |                    |                      |
| `fingerprint`                         | `string`                     | no   |                    |                      |
| `number`                              | `integer`                    | no   |                    | Final-Site           |
| `type`                                | `FixType`                    | no   |                    |                      |
| `section`                             | `FixSection`                 | no   |                    | Final-Site           |
| `title`                               | `string`                     | no   |                    | Final-Fix            |
| `detail`                              | `string`                     | yes  |                    | Final-Seg-Structure  |
| `recommendation_class`                | `RecommendationClass`        | no   |                    |                      |
| `status`                              | `FixStatus`                  | no   |                    |                      |
| `last_state`                          | `DetectionState`             | no   |                    |                      |
| `last_measured_check_id`              | `uuid`                       | no   |                    |                      |
| `first_seen_check_id`                 | `uuid`                       | no   |                    |                      |
| `confidence`                          | `Confidence`                 | no   |                    |                      |
| `affected_pages`                      | `integer`                    | no   |                    |                      |
| `template_key`                        | `string`                     | yes  |                    |                      |
| `crawler_uas`                         | `string[]`                   | no   |                    | Final-Segment        |
| `rank`                                | `integer`                    | yes  |                    | Final-Dashboard-Day0 |
| `effect`                              | `object`                     | no   |                    |                      |
| `effect.technical_seo`                | `number`                     | yes  |                    |                      |
| `effect.technical_seo_pending_on`     | `TechnicalSeoPending[]`      | no   |                    |                      |
| `effect.ai_readability`               | `number`                     | yes  |                    |                      |
| `effect.ai_readability_pending_on`    | `string or WithheldReason[]` | no   |                    |                      |
| `effect.absorbed_by`                  | `integer`                    | yes  |                    |                      |
| `effect.estimate`                     | `true`                       | no   |                    |                      |
| `effort`                              | `one of 2 variants`          | yes  |                    | Final-Public         |
| `effort.kind`                         | `"minutes"`                  | no   | `kind = minutes`   |                      |
| `effort.minutes`                      | `integer`                    | no   | `kind = minutes`   |                      |
| `effort.kind`                         | `"templates"`                | no   | `kind = templates` |                      |
| `effort.templates`                    | `integer`                    | no   | `kind = templates` |                      |
| `effort.deploys`                      | `integer`                    | no   | `kind = templates` |                      |
| `before_after`                        | `object[]`                   | no   |                    | Final-Fix            |
| `before_after[].measure`              | `FixMeasure`                 | no   |                    |                      |
| `before_after[].today`                | `number or boolean`          | no   |                    |                      |
| `before_after[].after`                | `number or boolean`          | no   |                    |                      |
| `before_after[].after_bound`          | `EstimateBound`              | no   |                    |                      |
| `before_after[].after_is_estimate`    | `true`                       | no   |                    |                      |
| `packet`                              | `object`                     | yes  |                    | Final-Fix            |
| `packet.framework`                    | `PacketFramework`            | no   |                    |                      |
| `packet.frameworks`                   | `PacketFramework[]`          | no   |                    |                      |
| `packet.context`                      | `string[]`                   | no   |                    |                      |
| `packet.change`                       | `string[]`                   | no   |                    |                      |
| `packet.keep`                         | `string[]`                   | no   |                    |                      |
| `packet.verify`                       | `object`                     | no   |                    |                      |
| `packet.verify.command`               | `string`                     | no   |                    |                      |
| `packet.verify.expect`                | `string`                     | no   |                    |                      |
| `packet.verify.ua`                    | `string`                     | yes  |                    |                      |
| `packet.verify.see`                   | `object`                     | yes  |                    |                      |
| `packet.verify.see.command`           | `string`                     | no   |                    |                      |
| `packet.verify.see.today`             | `string`                     | no   |                    |                      |
| `packet.verify.see.after`             | `string`                     | no   |                    |                      |
| `packet.packets`                      | `object[]`                   | no   |                    | PR #49               |
| `packet.packets[].framework`          | `PacketFramework`            | no   |                    |                      |
| `packet.packets[].context`            | `string[]`                   | no   |                    |                      |
| `packet.packets[].change`             | `string[]`                   | no   |                    |                      |
| `packet.packets[].keep`               | `string[]`                   | no   |                    |                      |
| `packet.packets[].verify`             | `object`                     | no   |                    |                      |
| `packet.packets[].verify.command`     | `string`                     | no   |                    |                      |
| `packet.packets[].verify.expect`      | `string`                     | no   |                    |                      |
| `packet.packets[].verify.ua`          | `string`                     | yes  |                    |                      |
| `packet.packets[].verify.see`         | `object`                     | yes  |                    |                      |
| `packet.packets[].verify.see.command` | `string`                     | no   |                    |                      |
| `packet.packets[].verify.see.today`   | `string`                     | no   |                    |                      |
| `packet.packets[].verify.see.after`   | `string`                     | no   |                    |                      |
| `gone`                                | `object`                     | yes  |                    | PR #47               |
| `gone.status_code`                    | `integer`                    | no   |                    |                      |

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
| `severity`                  | `Severity`      | yes  | PR #46            |
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

| Field                   | Type                   | Null | Added for    |
| ----------------------- | ---------------------- | ---- | ------------ |
| `token`                 | `string`               | no   |              |
| `group`                 | `CrawlerGroup`         | no   |              |
| `scored`                | `boolean`              | no   | FACTS        |
| `operator`              | `string`               | no   | Final-Result |
| `purpose`               | `string`               | no   |              |
| `robots_token`          | `string`               | no   |              |
| `ua_string`             | `string`               | yes  |              |
| `verification_method`   | `VerificationMethod[]` | no   |              |
| `ip_list_url`           | `url`                  | yes  | brief        |
| `testable`              | `boolean`              | no   |              |
| `needs_owner_logs`      | `boolean`              | no   |              |
| `source_url`            | `url`                  | no   |              |
| `source_notes`          | `string[]`             | no   | brief        |
| `as_of`                 | `date`                 | yes  |              |
| `cloudflare_categories` | `CloudflareCategory[]` | yes  | PR #54       |
| `cloudflare_as_of`      | `date`                 | no   | PR #54       |

### MeasurementLineage

Fixture collection: `lineages`.

| Screen | Shows |
| ------ | ----- |

| Field                      | Type        | Null | Added for |
| -------------------------- | ----------- | ---- | --------- |
| `id`                       | `uuid`      | no   |           |
| `engine_sha`               | `string`    | no   | CC-06b    |
| `detector_ruleset_version` | `string`    | no   | CC-06b    |
| `crawler_registry_version` | `string`    | no   | CC-06b    |
| `worker_release`           | `string`    | yes  | CC-06b    |
| `population_version`       | `string`    | yes  | CC-06b    |
| `created_at`               | `timestamp` | no   | CC-06b    |

### UsageEvent

Fixture collection: `usage_events`.

| Screen | Shows |
| ------ | ----- |

| Field             | Type          | Null | Added for |
| ----------------- | ------------- | ---- | --------- |
| `id`              | `uuid`        | no   |           |
| `account_id`      | `uuid`        | no   |           |
| `kind`            | `UsageKind`   | no   | CC-06b    |
| `check_id`        | `uuid`        | yes  |           |
| `report_id`       | `uuid`        | yes  |           |
| `result`          | `UsageResult` | no   | CC-06b    |
| `billable`        | `boolean`     | no   | CC-06b    |
| `compute_seconds` | `number`      | no   | CC-06b    |
| `request_count`   | `integer`     | no   | CC-06b    |
| `occurred_at`     | `timestamp`   | no   | CC-06b    |

## The worker batch result

What a batch result carries besides its rows, as fields the engine reads (`declaration.ts`; asked for in PR #54). A crawl batch records each declaration file it requested as `DeclarationFetch`: status, media type and byte count, never the body.

### DeclarationFetch

| Field            | Type                      | Null |
| ---------------- | ------------------------- | ---- |
| `origin`         | `url`                     | no   |
| `path`           | `DeclarationPath`         | no   |
| `state`          | `DeclarationState`        | no   |
| `status`         | `integer`                 | yes  |
| `media_type`     | `string`                  | yes  |
| `bytes`          | `integer`                 | yes  |
| `bytes_complete` | `boolean`                 | yes  |
| `not_requested`  | `DeclarationNotRequested` | yes  |
| `from_cache`     | `boolean`                 | no   |

### BatchPartial

Null when the batch did all it was asked.

| Field     | Type                   | Null |
| --------- | ---------------------- | ---- |
| `reasons` | `BatchPartialReason[]` | no   |

The whole result (`worker-batch.ts`), parsed with `BatchResultSchema`: one of two kinds, each strict, so a field not named here is refused.

### Crawl batch result

| Field                                                      | Type                      | Null |
| ---------------------------------------------------------- | ------------------------- | ---- |
| `batch_id`                                                 | `string`                  | no   |
| `check_id`                                                 | `uuid`                    | no   |
| `site_id`                                                  | `uuid`                    | no   |
| `started_at`                                               | `timestamp`               | no   |
| `finished_at`                                              | `timestamp`               | no   |
| `requests`                                                 | `integer`                 | no   |
| `bytes`                                                    | `integer`                 | no   |
| `coverage`                                                 | `object`                  | no   |
| `coverage.urls_requested`                                  | `integer`                 | no   |
| `coverage.urls_complete`                                   | `integer`                 | no   |
| `partial`                                                  | `object`                  | yes  |
| `partial.reasons`                                          | `BatchPartialReason[]`    | no   |
| `findings`                                                 | `one of 8 variants[]`     | no   |
| `findings[].kind`                                          | `"site_stopped"`          | no   |
| `findings[].site`                                          | `string`                  | no   |
| `findings[].reason`                                        | `enum`                    | no   |
| `findings[].at`                                            | `timestamp`               | no   |
| `findings[].until`                                         | `timestamp`               | no   |
| `findings[].requests_refused`                              | `boolean`                 | no   |
| `findings[].kind`                                          | `"budget_spent"`          | no   |
| `findings[].budget`                                        | `enum`                    | no   |
| `findings[].kind`                                          | `"robots_unreachable"`    | no   |
| `findings[].origin`                                        | `string`                  | no   |
| `findings[].why`                                           | `enum`                    | no   |
| `findings[].kind`                                          | `"robots_too_large"`      | no   |
| `findings[].origin`                                        | `string`                  | no   |
| `findings[].why`                                           | `enum`                    | no   |
| `findings[].kind`                                          | `"site_refused"`          | no   |
| `findings[].origin`                                        | `string`                  | no   |
| `findings[].kind`                                          | `"crawl_delay"`           | no   |
| `findings[].origin`                                        | `string`                  | no   |
| `findings[].declared_s`                                    | `number`                  | no   |
| `findings[].honoured`                                      | `boolean`                 | no   |
| `findings[].kind`                                          | `"result_size_limit"`     | no   |
| `findings[].limit_bytes`                                   | `integer`                 | no   |
| `findings[].kind`                                          | `"not_read"`              | no   |
| `findings[].reason`                                        | `enum`                    | no   |
| `findings[].responses`                                     | `integer`                 | no   |
| `robots`                                                   | `object[]`                | no   |
| `robots[].origin`                                          | `string`                  | no   |
| `robots[].identity_sent`                                   | `string`                  | no   |
| `robots[].state`                                           | `enum`                    | no   |
| `robots[].why`                                             | `enum`                    | yes  |
| `robots[].status`                                          | `integer`                 | yes  |
| `robots[].final_url`                                       | `url`                     | yes  |
| `robots[].fetched_at`                                      | `timestamp`               | no   |
| `robots[].from_cache`                                      | `boolean`                 | no   |
| `robots[].crawl_delay_s`                                   | `number`                  | yes  |
| `robots[].body_excerpt`                                    | `string`                  | yes  |
| `robots[].body`                                            | `string`                  | yes  |
| `robots[].body_complete`                                   | `boolean`                 | no   |
| `declarations`                                             | `object[]`                | no   |
| `declarations[].origin`                                    | `url`                     | no   |
| `declarations[].path`                                      | `DeclarationPath`         | no   |
| `declarations[].state`                                     | `DeclarationState`        | no   |
| `declarations[].status`                                    | `integer`                 | yes  |
| `declarations[].media_type`                                | `string`                  | yes  |
| `declarations[].bytes`                                     | `integer`                 | yes  |
| `declarations[].bytes_complete`                            | `boolean`                 | yes  |
| `declarations[].not_requested`                             | `DeclarationNotRequested` | yes  |
| `declarations[].from_cache`                                | `boolean`                 | no   |
| `kind`                                                     | `"crawl"`                 | no   |
| `pages`                                                    | `object[]`                | no   |
| `pages[].check_id`                                         | `uuid`                    | no   |
| `pages[].url`                                              | `url`                     | no   |
| `pages[].outcome`                                          | `enum`                    | no   |
| `pages[].response`                                         | `enum`                    | yes  |
| `pages[].evidence_class`                                   | `EvidenceClass`           | no   |
| `pages[].identity_sent`                                    | `string`                  | no   |
| `pages[].source_ip_class`                                  | `SourceIpClass`           | no   |
| `pages[].limitations`                                      | `string[]`                | no   |
| `pages[].fetched_at`                                       | `timestamp`               | no   |
| `pages[].request_headers`                                  | `object[]`                | no   |
| `pages[].request_headers[].name`                           | `string`                  | no   |
| `pages[].request_headers[].value`                          | `string`                  | no   |
| `pages[].status_code`                                      | `integer`                 | yes  |
| `pages[].final_url`                                        | `url`                     | yes  |
| `pages[].headers`                                          | `object[]`                | no   |
| `pages[].headers[].name`                                   | `string`                  | no   |
| `pages[].headers[].value`                                  | `string`                  | no   |
| `pages[].byte_count`                                       | `integer`                 | yes  |
| `pages[].word_count`                                       | `integer`                 | yes  |
| `pages[].raw_text`                                         | `string`                  | yes  |
| `pages[].canonical_url`                                    | `url`                     | yes  |
| `pages[].links_out`                                        | `integer`                 | yes  |
| `pages[].redirect`                                         | `object`                  | yes  |
| `pages[].redirect.hops`                                    | `object[]`                | no   |
| `pages[].redirect.hops[].from`                             | `url`                     | no   |
| `pages[].redirect.hops[].status`                           | `integer`                 | no   |
| `pages[].redirect.hops[].location`                         | `url`                     | yes  |
| `pages[].redirect.loop`                                    | `boolean`                 | no   |
| `pages[].canonical_declared`                               | `object`                  | yes  |
| `pages[].canonical_declared.href`                          | `string`                  | yes  |
| `pages[].canonical_declared.url`                           | `url`                     | yes  |
| `pages[].hreflang`                                         | `object`                  | yes  |
| `pages[].hreflang.links`                                   | `object[]`                | no   |
| `pages[].hreflang.links[].hreflang`                        | `string`                  | no   |
| `pages[].hreflang.links[].href`                            | `url`                     | no   |
| `pages[].hreflang.complete`                                | `boolean`                 | no   |
| `pages[].content_simhash`                                  | `string`                  | yes  |
| `pages[].is_html`                                          | `boolean`                 | no   |
| `pages[].links_read`                                       | `boolean`                 | no   |
| `pages[].robots_search`                                    | `object[]`                | no   |
| `pages[].robots_search[].ua`                               | `string`                  | no   |
| `pages[].robots_search[].verdict`                          | `Verdict`                 | no   |
| `pages[].title`                                            | `object`                  | yes  |
| `pages[].title.text`                                       | `string`                  | yes  |
| `pages[].title.chars`                                      | `integer`                 | no   |
| `pages[].title.cut`                                        | `boolean`                 | no   |
| `pages[].meta_description`                                 | `object`                  | yes  |
| `pages[].meta_description.text`                            | `string`                  | yes  |
| `pages[].meta_description.chars`                           | `integer`                 | no   |
| `pages[].meta_description.cut`                             | `boolean`                 | no   |
| `pages[].fly_region`                                       | `string`                  | yes  |
| `pages[].request_signing`                                  | `RequestSigning`          | no   |
| `pages[].signature_verified`                               | `SignatureVerification`   | no   |
| `pages[].worker_release`                                   | `string`                  | no   |
| `pages[].timing`                                           | `object`                  | yes  |
| `pages[].timing.dns_ms`                                    | `integer`                 | yes  |
| `pages[].timing.connect_ms`                                | `integer`                 | yes  |
| `pages[].timing.ttfb_ms`                                   | `integer`                 | yes  |
| `pages[].timing.total_ms`                                  | `integer`                 | no   |
| `pages[].content_features`                                 | `object`                  | yes  |
| `pages[].content_features.client_rendered`                 | `boolean`                 | no   |
| `pages[].content_features.has_h1`                          | `boolean`                 | no   |
| `pages[].content_features.words_after_h1`                  | `integer`                 | no   |
| `pages[].content_features.opening`                         | `object[]`                | no   |
| `pages[].content_features.opening[].tag`                   | `string`                  | no   |
| `pages[].content_features.opening[].words`                 | `integer`                 | no   |
| `pages[].content_features.opening[].answer_sentences`      | `integer`                 | no   |
| `pages[].content_features.opening[].question`              | `boolean`                 | no   |
| `pages[].content_features.headings`                        | `object`                  | no   |
| `pages[].content_features.headings.count`                  | `integer`                 | no   |
| `pages[].content_features.headings.questions`              | `integer`                 | no   |
| `pages[].content_features.headings.section_questions`      | `integer`                 | no   |
| `pages[].content_features.json_ld`                         | `object[]`                | no   |
| `pages[].content_features.json_ld[].types`                 | `string[]`                | no   |
| `pages[].content_features.json_ld[].has_description`       | `boolean`                 | no   |
| `pages[].content_features.json_ld[].has_author`            | `boolean`                 | no   |
| `pages[].content_features.json_ld[].has_dated_publication` | `boolean`                 | no   |
| `pages[].content_features.byline`                          | `object`                  | no   |
| `pages[].content_features.byline.meta_author`              | `boolean`                 | no   |
| `pages[].content_features.byline.published_time`           | `boolean`                 | no   |
| `pages[].content_features.byline.rel_author`               | `boolean`                 | no   |
| `pages[].content_features.byline.itemprop_author`          | `boolean`                 | no   |
| `pages[].content_features.byline.itemprop_date`            | `boolean`                 | no   |
| `pages[].content_features.byline.time_datetime`            | `boolean`                 | no   |
| `pages[].content_features.specs`                           | `object`                  | no   |
| `pages[].content_features.specs.structured`                | `integer`                 | no   |
| `pages[].content_features.specs.label_value_lines`         | `integer`                 | no   |
| `pages[].content_features.specs.spec_images`               | `integer`                 | no   |
| `pages[].stack_signals`                                    | `object`                  | yes  |
| `pages[].stack_signals.cms`                                | `CmsName`                 | no   |
| `pages[].stack_signals.detected_from`                      | `string`                  | no   |
| `pages[].stack_signals.frontend_markers`                   | `FrontendMarker[]`        | no   |
| `pages[].main_text_chars`                                  | `integer`                 | yes  |
| `pages[].noindex`                                          | `boolean`                 | yes  |
| `link_edges`                                               | `object[]`                | no   |
| `link_edges[].check_id`                                    | `uuid`                    | no   |
| `link_edges[].from_url`                                    | `url`                     | no   |
| `link_edges[].to_url`                                      | `url`                     | no   |
| `link_edges[].anchor_text`                                 | `string`                  | no   |
| `link_edges[].is_generic_anchor`                           | `boolean`                 | no   |
| `link_edges[].js_only`                                     | `boolean`                 | no   |
| `discovered_urls`                                          | `url[]`                   | no   |

### Access batch result

The rows are `AccessTest` (above).

| Field                                    | Type                      | Null |
| ---------------------------------------- | ------------------------- | ---- |
| `batch_id`                               | `string`                  | no   |
| `check_id`                               | `uuid`                    | no   |
| `site_id`                                | `uuid`                    | no   |
| `started_at`                             | `timestamp`               | no   |
| `finished_at`                            | `timestamp`               | no   |
| `requests`                               | `integer`                 | no   |
| `bytes`                                  | `integer`                 | no   |
| `coverage`                               | `object`                  | no   |
| `coverage.urls_requested`                | `integer`                 | no   |
| `coverage.urls_complete`                 | `integer`                 | no   |
| `partial`                                | `object`                  | yes  |
| `partial.reasons`                        | `BatchPartialReason[]`    | no   |
| `findings`                               | `one of 8 variants[]`     | no   |
| `findings[].kind`                        | `"site_stopped"`          | no   |
| `findings[].site`                        | `string`                  | no   |
| `findings[].reason`                      | `enum`                    | no   |
| `findings[].at`                          | `timestamp`               | no   |
| `findings[].until`                       | `timestamp`               | no   |
| `findings[].requests_refused`            | `boolean`                 | no   |
| `findings[].kind`                        | `"budget_spent"`          | no   |
| `findings[].budget`                      | `enum`                    | no   |
| `findings[].kind`                        | `"robots_unreachable"`    | no   |
| `findings[].origin`                      | `string`                  | no   |
| `findings[].why`                         | `enum`                    | no   |
| `findings[].kind`                        | `"robots_too_large"`      | no   |
| `findings[].origin`                      | `string`                  | no   |
| `findings[].why`                         | `enum`                    | no   |
| `findings[].kind`                        | `"site_refused"`          | no   |
| `findings[].origin`                      | `string`                  | no   |
| `findings[].kind`                        | `"crawl_delay"`           | no   |
| `findings[].origin`                      | `string`                  | no   |
| `findings[].declared_s`                  | `number`                  | no   |
| `findings[].honoured`                    | `boolean`                 | no   |
| `findings[].kind`                        | `"result_size_limit"`     | no   |
| `findings[].limit_bytes`                 | `integer`                 | no   |
| `findings[].kind`                        | `"not_read"`              | no   |
| `findings[].reason`                      | `enum`                    | no   |
| `findings[].responses`                   | `integer`                 | no   |
| `robots`                                 | `object[]`                | no   |
| `robots[].origin`                        | `string`                  | no   |
| `robots[].identity_sent`                 | `string`                  | no   |
| `robots[].state`                         | `enum`                    | no   |
| `robots[].why`                           | `enum`                    | yes  |
| `robots[].status`                        | `integer`                 | yes  |
| `robots[].final_url`                     | `url`                     | yes  |
| `robots[].fetched_at`                    | `timestamp`               | no   |
| `robots[].from_cache`                    | `boolean`                 | no   |
| `robots[].crawl_delay_s`                 | `number`                  | yes  |
| `robots[].body_excerpt`                  | `string`                  | yes  |
| `robots[].body`                          | `string`                  | yes  |
| `robots[].body_complete`                 | `boolean`                 | no   |
| `declarations`                           | `object[]`                | no   |
| `declarations[].origin`                  | `url`                     | no   |
| `declarations[].path`                    | `DeclarationPath`         | no   |
| `declarations[].state`                   | `DeclarationState`        | no   |
| `declarations[].status`                  | `integer`                 | yes  |
| `declarations[].media_type`              | `string`                  | yes  |
| `declarations[].bytes`                   | `integer`                 | yes  |
| `declarations[].bytes_complete`          | `boolean`                 | yes  |
| `declarations[].not_requested`           | `DeclarationNotRequested` | yes  |
| `declarations[].from_cache`              | `boolean`                 | no   |
| `kind`                                   | `"access"`                | no   |
| `access_tests`                           | `object[]`                | no   |
| `access_tests[].id`                      | `uuid`                    | no   |
| `access_tests[].check_id`                | `uuid`                    | no   |
| `access_tests[].ua`                      | `string`                  | yes  |
| `access_tests[].page_url`                | `url`                     | no   |
| `access_tests[].template_key`            | `string`                  | no   |
| `access_tests[].tested_at`               | `timestamp`               | no   |
| `access_tests[].verdict`                 | `Verdict`                 | no   |
| `access_tests[].evidence_class`          | `EvidenceClass`           | no   |
| `access_tests[].identity_sent`           | `string`                  | no   |
| `access_tests[].source_ip_class`         | `SourceIpClass`           | no   |
| `access_tests[].limitations`             | `string[]`                | no   |
| `access_tests[].cause`                   | `AccessCause`             | yes  |
| `access_tests[].request_headers`         | `object[]`                | no   |
| `access_tests[].request_headers[].name`  | `string`                  | no   |
| `access_tests[].request_headers[].value` | `string`                  | no   |
| `access_tests[].raw_status`              | `integer`                 | yes  |
| `access_tests[].final_url`               | `url`                     | yes  |
| `access_tests[].headers`                 | `object[]`                | no   |
| `access_tests[].headers[].name`          | `string`                  | no   |
| `access_tests[].headers[].value`         | `string`                  | no   |
| `access_tests[].byte_count`              | `integer`                 | yes  |
| `access_tests[].word_count`              | `integer`                 | yes  |
| `access_tests[].body_excerpt`            | `string`                  | yes  |
| `access_tests[].method`                  | `"GET"`                   | yes  |
| `access_tests[].http_version`            | `"1.1"`                   | yes  |
| `access_tests[].identity_role`           | `IdentityRole`            | no   |
| `access_tests[].tagged`                  | `boolean`                 | no   |
| `access_tests[].witness`                 | `object`                  | yes  |
| `access_tests[].witness.role`            | `WitnessRole`             | no   |
| `access_tests[].witness.ua`              | `string`                  | no   |
| `access_tests[].fly_region`              | `string`                  | yes  |
| `access_tests[].request_signing`         | `RequestSigning`          | yes  |
| `access_tests[].signature_verified`      | `SignatureVerification`   | yes  |
| `access_tests[].worker_release`          | `string`                  | yes  |
| `access_tests[].timing`                  | `object`                  | yes  |
| `access_tests[].timing.dns_ms`           | `integer`                 | yes  |
| `access_tests[].timing.connect_ms`       | `integer`                 | yes  |
| `access_tests[].timing.ttfb_ms`          | `integer`                 | yes  |
| `access_tests[].timing.total_ms`         | `integer`                 | no   |

### CrawlPage

One URL of a crawl batch, as our crawler fetched it; the check builder assembles `PageResult` from these rows.

| Field                                              | Type                    | Null |
| -------------------------------------------------- | ----------------------- | ---- |
| `check_id`                                         | `uuid`                  | no   |
| `url`                                              | `url`                   | no   |
| `outcome`                                          | `enum`                  | no   |
| `response`                                         | `enum`                  | yes  |
| `evidence_class`                                   | `EvidenceClass`         | no   |
| `identity_sent`                                    | `string`                | no   |
| `source_ip_class`                                  | `SourceIpClass`         | no   |
| `limitations`                                      | `string[]`              | no   |
| `fetched_at`                                       | `timestamp`             | no   |
| `request_headers`                                  | `object[]`              | no   |
| `request_headers[].name`                           | `string`                | no   |
| `request_headers[].value`                          | `string`                | no   |
| `status_code`                                      | `integer`               | yes  |
| `final_url`                                        | `url`                   | yes  |
| `headers`                                          | `object[]`              | no   |
| `headers[].name`                                   | `string`                | no   |
| `headers[].value`                                  | `string`                | no   |
| `byte_count`                                       | `integer`               | yes  |
| `word_count`                                       | `integer`               | yes  |
| `raw_text`                                         | `string`                | yes  |
| `canonical_url`                                    | `url`                   | yes  |
| `links_out`                                        | `integer`               | yes  |
| `redirect`                                         | `object`                | yes  |
| `redirect.hops`                                    | `object[]`              | no   |
| `redirect.hops[].from`                             | `url`                   | no   |
| `redirect.hops[].status`                           | `integer`               | no   |
| `redirect.hops[].location`                         | `url`                   | yes  |
| `redirect.loop`                                    | `boolean`               | no   |
| `canonical_declared`                               | `object`                | yes  |
| `canonical_declared.href`                          | `string`                | yes  |
| `canonical_declared.url`                           | `url`                   | yes  |
| `hreflang`                                         | `object`                | yes  |
| `hreflang.links`                                   | `object[]`              | no   |
| `hreflang.links[].hreflang`                        | `string`                | no   |
| `hreflang.links[].href`                            | `url`                   | no   |
| `hreflang.complete`                                | `boolean`               | no   |
| `content_simhash`                                  | `string`                | yes  |
| `is_html`                                          | `boolean`               | no   |
| `links_read`                                       | `boolean`               | no   |
| `robots_search`                                    | `object[]`              | no   |
| `robots_search[].ua`                               | `string`                | no   |
| `robots_search[].verdict`                          | `Verdict`               | no   |
| `title`                                            | `object`                | yes  |
| `title.text`                                       | `string`                | yes  |
| `title.chars`                                      | `integer`               | no   |
| `title.cut`                                        | `boolean`               | no   |
| `meta_description`                                 | `object`                | yes  |
| `meta_description.text`                            | `string`                | yes  |
| `meta_description.chars`                           | `integer`               | no   |
| `meta_description.cut`                             | `boolean`               | no   |
| `fly_region`                                       | `string`                | yes  |
| `request_signing`                                  | `RequestSigning`        | no   |
| `signature_verified`                               | `SignatureVerification` | no   |
| `worker_release`                                   | `string`                | no   |
| `timing`                                           | `object`                | yes  |
| `timing.dns_ms`                                    | `integer`               | yes  |
| `timing.connect_ms`                                | `integer`               | yes  |
| `timing.ttfb_ms`                                   | `integer`               | yes  |
| `timing.total_ms`                                  | `integer`               | no   |
| `content_features`                                 | `object`                | yes  |
| `content_features.client_rendered`                 | `boolean`               | no   |
| `content_features.has_h1`                          | `boolean`               | no   |
| `content_features.words_after_h1`                  | `integer`               | no   |
| `content_features.opening`                         | `object[]`              | no   |
| `content_features.opening[].tag`                   | `string`                | no   |
| `content_features.opening[].words`                 | `integer`               | no   |
| `content_features.opening[].answer_sentences`      | `integer`               | no   |
| `content_features.opening[].question`              | `boolean`               | no   |
| `content_features.headings`                        | `object`                | no   |
| `content_features.headings.count`                  | `integer`               | no   |
| `content_features.headings.questions`              | `integer`               | no   |
| `content_features.headings.section_questions`      | `integer`               | no   |
| `content_features.json_ld`                         | `object[]`              | no   |
| `content_features.json_ld[].types`                 | `string[]`              | no   |
| `content_features.json_ld[].has_description`       | `boolean`               | no   |
| `content_features.json_ld[].has_author`            | `boolean`               | no   |
| `content_features.json_ld[].has_dated_publication` | `boolean`               | no   |
| `content_features.byline`                          | `object`                | no   |
| `content_features.byline.meta_author`              | `boolean`               | no   |
| `content_features.byline.published_time`           | `boolean`               | no   |
| `content_features.byline.rel_author`               | `boolean`               | no   |
| `content_features.byline.itemprop_author`          | `boolean`               | no   |
| `content_features.byline.itemprop_date`            | `boolean`               | no   |
| `content_features.byline.time_datetime`            | `boolean`               | no   |
| `content_features.specs`                           | `object`                | no   |
| `content_features.specs.structured`                | `integer`               | no   |
| `content_features.specs.label_value_lines`         | `integer`               | no   |
| `content_features.specs.spec_images`               | `integer`               | no   |
| `stack_signals`                                    | `object`                | yes  |
| `stack_signals.cms`                                | `CmsName`               | no   |
| `stack_signals.detected_from`                      | `string`                | no   |
| `stack_signals.frontend_markers`                   | `FrontendMarker[]`      | no   |
| `main_text_chars`                                  | `integer`               | yes  |
| `noindex`                                          | `boolean`               | yes  |

### RobotsEvidence

| Field           | Type        | Null |
| --------------- | ----------- | ---- |
| `origin`        | `string`    | no   |
| `identity_sent` | `string`    | no   |
| `state`         | `enum`      | no   |
| `why`           | `enum`      | yes  |
| `status`        | `integer`   | yes  |
| `final_url`     | `url`       | yes  |
| `fetched_at`    | `timestamp` | no   |
| `from_cache`    | `boolean`   | no   |
| `crawl_delay_s` | `number`    | yes  |
| `body_excerpt`  | `string`    | yes  |
| `body`          | `string`    | yes  |
| `body_complete` | `boolean`   | no   |

### Finding

What limited a batch, once each; `kind` names the variant.

| Field              | Type                   | Null |
| ------------------ | ---------------------- | ---- |
| `kind`             | `"site_stopped"`       | no   |
| `site`             | `string`               | no   |
| `reason`           | `enum`                 | no   |
| `at`               | `timestamp`            | no   |
| `until`            | `timestamp`            | no   |
| `requests_refused` | `boolean`              | no   |
| `kind`             | `"budget_spent"`       | no   |
| `budget`           | `enum`                 | no   |
| `kind`             | `"robots_unreachable"` | no   |
| `origin`           | `string`               | no   |
| `why`              | `enum`                 | no   |
| `kind`             | `"robots_too_large"`   | no   |
| `origin`           | `string`               | no   |
| `why`              | `enum`                 | no   |
| `kind`             | `"site_refused"`       | no   |
| `origin`           | `string`               | no   |
| `kind`             | `"crawl_delay"`        | no   |
| `origin`           | `string`               | no   |
| `declared_s`       | `number`               | no   |
| `honoured`         | `boolean`              | no   |
| `kind`             | `"result_size_limit"`  | no   |
| `limit_bytes`      | `integer`              | no   |
| `kind`             | `"not_read"`           | no   |
| `reason`           | `enum`                 | no   |
| `responses`        | `integer`              | no   |

### Batch result values

| Enum           | Values                                                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| CrawlOutcome   | `fetched`, `robots_disallowed`, `not_requested`, `failed`                                                                               |
| CrawlResponse  | `served`, `refused`, `gone`, `challenged`, `rate_limited`, `payment`, `redirected_away`, `error`                                        |
| RobotsState    | `rules`, `none`, `unreachable`, `too_large`, `refused`                                                                                  |
| RobotsWhy      | `client_error`, `html_soft_404`, `server_error`, `timeout`, `network`, `challenged`, `byte_budget`, `redirect_status`, `bytes`, `rules` |
| SiteStopReason | `three_429_responses`, `four_consecutive_challenged_pages`                                                                              |
| BudgetKind     | `requests`, `bytes`, `seconds`                                                                                                          |
| NotReadReason  | `parse_depth_exceeded`, `reader_thread_crashed`, `reader_deadline`, `reader_error`                                                      |

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
| Check                | `coverage.excluded_by_robots`          | brief                |
| Check                | `signals[].recommendation_class`       | PR #48               |
| Check                | `stack.frontend.framework`             | PR #49               |
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
| PageResult           | `final_url`                            | PR #47               |
| PageResult           | `redirect`                             | PR #47               |
| PageResult           | `canonical_declared`                   | PR #47               |
| PageResult           | `hreflang`                             | PR #47               |
| PageResult           | `content_simhash`                      | PR #47               |
| PageResult           | `links_read`                           | PR #47               |
| PageResult           | `is_html`                              | brief                |
| PageResult           | `robots_search`                        | PR #47               |
| PageResult           | `title`                                | CC-12d               |
| PageResult           | `meta_description`                     | CC-12d               |
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
| AccessTest           | `method`                               | PR #48               |
| AccessTest           | `http_version`                         | PR #48               |
| AccessTest           | `identity_role`                        | PR #54               |
| AccessTest           | `tagged`                               | PR #55               |
| AccessTest           | `witness`                              | PR #54               |
| AccessTest           | `fly_region`                           | PR #55               |
| AccessTest           | `request_signing`                      | PR #55               |
| AccessTest           | `signature_verified`                   | PR #55               |
| AccessTest           | `worker_release`                       | PR #55               |
| AccessTest           | `timing`                               | PR #55               |
| Fix                  | `number`                               | Final-Site           |
| Fix                  | `section`                              | Final-Site           |
| Fix                  | `title`                                | Final-Fix            |
| Fix                  | `detail`                               | Final-Seg-Structure  |
| Fix                  | `crawler_uas`                          | Final-Segment        |
| Fix                  | `rank`                                 | Final-Dashboard-Day0 |
| Fix                  | `effort`                               | Final-Public         |
| Fix                  | `before_after`                         | Final-Fix            |
| Fix                  | `packet`                               | Final-Fix            |
| Fix                  | `packet.packets`                       | PR #49               |
| Fix                  | `gone`                                 | PR #47               |
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
| Change               | `severity`                             | PR #46               |
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
| CrawlerRegistryEntry | `cloudflare_categories`                | PR #54               |
| CrawlerRegistryEntry | `cloudflare_as_of`                     | PR #54               |
| MeasurementLineage   | `engine_sha`                           | CC-06b               |
| MeasurementLineage   | `detector_ruleset_version`             | CC-06b               |
| MeasurementLineage   | `crawler_registry_version`             | CC-06b               |
| MeasurementLineage   | `worker_release`                       | CC-06b               |
| MeasurementLineage   | `population_version`                   | CC-06b               |
| MeasurementLineage   | `created_at`                           | CC-06b               |
| UsageEvent           | `kind`                                 | CC-06b               |
| UsageEvent           | `result`                               | CC-06b               |
| UsageEvent           | `billable`                             | CC-06b               |
| UsageEvent           | `compute_seconds`                      | CC-06b               |
| UsageEvent           | `request_count`                        | CC-06b               |
| UsageEvent           | `occurred_at`                          | CC-06b               |

## Rules

Every rule a schema enforces beyond shape, from `rules.ts`. A two-way rule ("X exactly when Y") can break in either direction, and has test cases that break it each way.

| Rule                        | Message                                                                                                                                                   | Breaks    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `billing_period`            | billing is monthly (1) or annual (12)                                                                                                                     | one way   |
| `history_current`           | the last state_history entry must be the current state                                                                                                    | one way   |
| `history_forward`           | state_history must move forward in time                                                                                                                   | one way   |
| `trial_consent`             | trial consent is recorded exactly when the account has had an Agency trial                                                                                | both ways |
| `trial_ends`                | trial_ends_at is set exactly while on a trial                                                                                                             | both ways |
| `branding_dns`              | dns status exists exactly when a report domain is set                                                                                                     | both ways |
| `branding_email_auth`       | email checks exist exactly when a sender is set                                                                                                           | both ways |
| `branding_postal`           | a sender address needs a postal address for the footer                                                                                                    | one way   |
| `time_zone`                 | not an IANA time zone                                                                                                                                     | one way   |
| `crawled_text_budget`       | crawled text is over its UTF-8 byte budget                                                                                                                | one way   |
| `crawled_text_surrogate`    | crawled text has a lone surrogate, which cannot be stored                                                                                                 | one way   |
| `verification_alone`        | none_published stands alone                                                                                                                               | one way   |
| `verification_unique`       | verification methods are listed once each                                                                                                                 | one way   |
| `ip_list_url`               | ip_list_url is set exactly when an IP list is published                                                                                                   | both ways |
| `cloudflare_unique`         | Cloudflare's categories are listed once each                                                                                                              | one way   |
| `effect_pending`            | an AI effect is either estimated, or not yet estimated because of named fixes or reasons                                                                  | both ways |
| `effect_seo_pending`        | a Technical SEO effect is either estimated, or not estimated because the grade is refused                                                                 | both ways |
| `effect_absorbed`           | a fix absorbed by a higher-ranked one has no positive effect left                                                                                         | one way   |
| `content_score_withheld`    | the Content section has a score, or no score and the reason it has none                                                                                   | both ways |
| `fix_last_state`            | last_state does not fit the status                                                                                                                        | one way   |
| `fix_rank`                  | every live fix has a rank and a resolved fix has none                                                                                                     | both ways |
| `packet_framework`          | the packet framework must be one of its switch options                                                                                                    | one way   |
| `packet_bodies`             | each further packet body is for another framework of the switch, once                                                                                     | one way   |
| `page_gone_status`          | a gone page answered 404 or 410                                                                                                                           | one way   |
| `fix_gone`                  | a fix whose page is gone was last measured indeterminate                                                                                                  | one way   |
| `coverage_gradeable`        | gradeable and excluded pages cannot exceed the pages crawled                                                                                              | one way   |
| `coverage_crawled`          | pages_crawled cannot exceed pages_discovered                                                                                                              | one way   |
| `coverage_sampled`          | pages_sampled cannot exceed the crawl or the sample cap                                                                                                   | one way   |
| `coverage_robots`           | pages crawled and pages excluded by robots.txt cannot exceed the pages discovered                                                                         | one way   |
| `crawler_scored`            | exactly the ai_search crawlers are scored (FACTS I6)                                                                                                      | both ways |
| `check_progress`            | progress is present exactly while running                                                                                                                 | both ways |
| `check_not_started`         | not started yet                                                                                                                                           | one way   |
| `check_started`             | started_at is required                                                                                                                                    | one way   |
| `check_finished_at`         | finished_at is set exactly when the check has ended                                                                                                       | both ways |
| `check_deferred_until`      | deferred_until is set exactly when deferred                                                                                                               | both ways |
| `check_failure_reason`      | failure_reason is set exactly when failed                                                                                                                 | both ways |
| `check_coverage`            | coverage is set exactly when the crawl has finished                                                                                                       | both ways |
| `check_both_grades`         | a finished check carries both grades                                                                                                                      | one way   |
| `check_grades_when_ended`   | only a finished or partial check carries grades                                                                                                           | one way   |
| `check_result_link`         | the result link expires after it is sent                                                                                                                  | one way   |
| `i4_withheld`               | AI readability is withheld when fewer than two scored crawlers were measured (I4)                                                                         | one way   |
| `score_grade_pair`          | score and grade are both present or both null                                                                                                             | both ways |
| `refusal_score`             | a refused grade has no score; a given one has                                                                                                             | both ways |
| `total_sum`                 | total is not the sum of its components                                                                                                                    | one way   |
| `withheld_reasons`          | a withheld grade names why, and a given one names no reason                                                                                               | both ways |
| `component_range`           | a component without a score carries the range it could take, and a scored one none                                                                        | both ways |
| `range_order`               | a component range's min must not exceed its max                                                                                                           | one way   |
| `access_range_mirror`       | access_range is the Access component's range                                                                                                              | one way   |
| `withheld_unmeasured`       | a withheld grade has at least one component without a score                                                                                               | one way   |
| `withheld_reasons_match`    | withheld_reasons names each unscored component once: one Access reason, and readable_unmeasured, quotable_unmeasured or signals_unmeasured for the others | one way   |
| `fewer_crawlers`            | scored_from_fewer_crawlers is set only when Access has a score, and counts fewer than two crawlers (I4)                                                   | one way   |
| `schedule_timed`            | a timed schedule has a weekday; on_deploy has none                                                                                                        | both ways |
| `schedule_pair`             | a schedule sets its weekday and its hour together                                                                                                         | both ways |
| `unkept_audit`              | an unkept audit has no schedule, client report or owner                                                                                                   | one way   |
| `client_report_cadence`     | client reports go out weekly or monthly                                                                                                                   | one way   |
| `alert_threshold`           | only the text-drop rule has a threshold, and it always has one                                                                                            | both ways |
| `alert_fired_pair`          | a firing records both when and which check                                                                                                                | both ways |
| `report_sent`               | sent_at is set exactly when sent                                                                                                                          | both ways |
| `report_send_time`          | a scheduled or held report has a send time                                                                                                                | one way   |
| `report_slug`               | only a public link has a slug                                                                                                                             | both ways |
| `report_open_tracking`      | an open is known only with tracking on                                                                                                                    | one way   |
| `observed_owner_logs`       | observed evidence comes from owner logs, and only it does                                                                                                 | both ways |
| `access_request_line`       | the request method and HTTP version are recorded together                                                                                                 | both ways |
| `access_identity_ua`        | an access row names a crawler exactly when it is a crawler row                                                                                            | both ways |
| `control_untagged`          | the browser control carries no Crawlmouse tag                                                                                                             | one way   |
| `access_witness`            | a witness is named exactly on a blocked_by_ua_rule row decided by our own requests                                                                        | both ways |
| `witness_other`             | a witness is another identity than the crawler refused                                                                                                    | one way   |
| `fly_region`                | a Fly region is recorded exactly when the request left from Fly                                                                                           | both ways |
| `timing_order`              | a request's recorded phases are in order: DNS, connect, first byte, total                                                                                 | one way   |
| `worker_request`            | signing, verification and the worker release are recorded exactly on the worker's own requests                                                            | both ways |
| `worker_request_whole`      | signing, verification and the worker release are recorded together                                                                                        | one way   |
| `declaration_answer`        | a declaration status is recorded exactly when the request was answered                                                                                    | both ways |
| `declaration_bytes`         | a declaration byte count is recorded exactly when the request was answered                                                                                | both ways |
| `declaration_media_type`    | a declaration media type is recorded only from an answer                                                                                                  | one way   |
| `declaration_cache_answer`  | a declaration kept from an earlier batch is an answer or its absence                                                                                      | one way   |
| `declaration_not_requested` | why a declaration was not requested is recorded exactly when it was not requested                                                                         | both ways |
| `head_text_absent`          | a title or description the page does not declare has no length and no cut                                                                                 | one way   |
| `usage_billable`            | only a delivered result is billable                                                                                                                       | one way   |
| `change_severity`           | severity is set exactly on an opened or resolved change                                                                                                   | both ways |
| `change_resolved_info`      | a resolved change is info                                                                                                                                 | one way   |
| `change_baseline`           | a baseline row is about the grade, compares no scores and names no fix                                                                                    | one way   |
| `redirect_status`           | a redirect hop answers 301, 302, 303, 307 or 308                                                                                                          | one way   |
| `redirect_loop`             | a redirect loop has at least one hop                                                                                                                      | one way   |
| `canonical_href`            | a resolved canonical needs the href it was resolved from                                                                                                  | one way   |
| `robots_verdict`            | a robots.txt verdict is allowed, disallowed_by_robots or not_measured                                                                                     | one way   |
| `robots_ua_unique`          | each search engine has one robots.txt verdict                                                                                                             | one way   |
| `links_read_html`           | only an HTML response has its links read                                                                                                                  | one way   |
| `robots_body`               | a robots.txt body is kept exactly when the whole file was read                                                                                            | both ways |
| `frontend_markers_order`    | front-end markers are listed once each, in the order FrontendMarker lists them                                                                            | one way   |

## Enums

| Enum                      | Coverage                                              | Values                                                                                                                                                                                                                                                                                                                             |
| ------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Verdict`                 | every value in a fixture                              | allowed, allowed_thin, disallowed_by_robots, blocked_by_ua_rule, challenged_ua, refused_unverified, rate_limited, payment_required, edge_blocks_automation, redirected_away, not_measured                                                                                                                                          |
| `EvidenceClass`           | every value in a fixture                              | declared, simulated, observed                                                                                                                                                                                                                                                                                                      |
| `CrawlerGroup`            | every value in a fixture                              | search_engine, ai_search, ai_training                                                                                                                                                                                                                                                                                              |
| `DetectionState`          | every value in a fixture                              | detected, not_detected, indeterminate                                                                                                                                                                                                                                                                                              |
| `FixStatus`               | every value in a fixture                              | open, marked_done, verified_resolved, unable_to_verify, reopened                                                                                                                                                                                                                                                                   |
| `RecommendationClass`     | every value in a fixture                              | confirmed_defect, documented_requirement, best_practice, experimental                                                                                                                                                                                                                                                              |
| `CheckStatus`             | every value in a fixture                              | queued, running, finished, partial, failed, deferred                                                                                                                                                                                                                                                                               |
| `AccountState`            | every value in a fixture                              | free, pro_trial, pro, agency_trial, agency, past_due                                                                                                                                                                                                                                                                               |
| `Confidence`              | every value in a fixture                              | confirmed, likely, inconclusive                                                                                                                                                                                                                                                                                                    |
| `SourceIpClass`           | every value in a fixture                              | fly_egress, browser_rendering, owner_logs, other_egress                                                                                                                                                                                                                                                                            |
| `GradeName`               | every value in a fixture                              | technical_seo, ai_readability                                                                                                                                                                                                                                                                                                      |
| `FixSection`              | every value in a fixture                              | crawler_access, without_js, structure, content                                                                                                                                                                                                                                                                                     |
| `FixType`                 | every value in a fixture                              | robots_txt_blocks_crawler, edge_rule_blocks_crawler, client_rendered_template, orphan_pages, quotable_opening, generic_anchor_text, deep_pages, specs_as_images, missing_author_date, js_only_navigation, redirect_chain, duplicate_pagination, canonical_mismatch, hreflang_gap, missing_schema_description, no_question_headings |
| `FixMeasure`              | every value in a fixture                              | words_without_js, crawlers_reading_text, quotable_opening, text_share                                                                                                                                                                                                                                                              |
| `EstimateBound`           | every value in a fixture                              | exact, approx, at_least                                                                                                                                                                                                                                                                                                            |
| `PacketFramework`         | every value in a fixture                              | nextjs, shopify_liquid, shopify_hydrogen, wordpress, webflow, generic                                                                                                                                                                                                                                                              |
| `CheckTrigger`            | every value in a fixture                              | first_audit, manual, scheduled, deploy, fix_recheck                                                                                                                                                                                                                                                                                |
| `CheckPhase`              | every value in a fixture                              | robots_and_sitemap, homepage, crawl, crawler_tests, without_js, grading                                                                                                                                                                                                                                                            |
| `StepState`               | every value in a fixture                              | done, now, next                                                                                                                                                                                                                                                                                                                    |
| `SampleMethod`            | every value in a fixture                              | stratified_by_template, census                                                                                                                                                                                                                                                                                                     |
| `AccessCause`             | every value in a fixture                              | cloudflare_1020, bot_fight_mode, client_rendered_template, robots_txt_disallow, automation_challenge, rate_limit_429, pay_per_crawl_402, cross_host_redirect, verified_bot_only                                                                                                                                                    |
| `SignalKind`              | every value in a fixture                              | schema_org, content_signals, web_bot_auth, llms_txt, mcp_server_card, markdown_negotiation, agent_skills_index, ucp, rsl, agent_card, llms_full                                                                                                                                                                                    |
| `ContentCheck`            | every value in a fixture                              | direct_answer_150, question_headings, schema_with_description, author_and_date, specs_as_text                                                                                                                                                                                                                                      |
| `JsTextState`             | every value in a fixture                              | readable, partial, empty_shell                                                                                                                                                                                                                                                                                                     |
| `FoundVia`                | every value in a fixture                              | link, sitemap, javascript                                                                                                                                                                                                                                                                                                          |
| `Cadence`                 | every value in a fixture                              | weekly, monthly, on_deploy                                                                                                                                                                                                                                                                                                         |
| `ChangeKind`              | every value in a fixture                              | opened, resolved, changed, baseline                                                                                                                                                                                                                                                                                                |
| `ChangeSubject`           | every value in a fixture                              | crawler_access, text_without_js, grade, orphans, content, structure, deploy                                                                                                                                                                                                                                                        |
| `Severity`                | every value in a fixture                              | bad, warn, info                                                                                                                                                                                                                                                                                                                    |
| `Channel`                 | every value in a fixture                              | email, slack                                                                                                                                                                                                                                                                                                                       |
| `AlertRuleKind`           | every value in a fixture                              | crawler_blocked, text_drop, grade_letter_moved, new_orphans, fix_regressed, any_change                                                                                                                                                                                                                                             |
| `ReportKind`              | every value in a fixture                              | audit_pdf, compare, raw_export, public_link, client_report, prospect_one_pager                                                                                                                                                                                                                                                     |
| `ReportFormat`            | every value in a fixture                              | pdf, csv, json, edge_list, html                                                                                                                                                                                                                                                                                                    |
| `ReportStatus`            | every value in a fixture                              | ready, scheduled, held, sent                                                                                                                                                                                                                                                                                                       |
| `ReportMaker`             | every value in a fixture                              | user, scheduled_check, report_schedule                                                                                                                                                                                                                                                                                             |
| `SeatRole`                | every value in a fixture                              | owner, account_manager, developer                                                                                                                                                                                                                                                                                                  |
| `Theme`                   | every value in a fixture                              | system, light, dark                                                                                                                                                                                                                                                                                                                |
| `IntegrationKind`         | every value in a fixture                              | slack, search_console, vercel, cloudflare_analytics, vercel_drain                                                                                                                                                                                                                                                                  |
| `WithheldCollection`      | every value in a fixture                              | page_results, link_edges, access_tests                                                                                                                                                                                                                                                                                             |
| `UsageKind`               | every value in a fixture                              | check_finished, export, api_call                                                                                                                                                                                                                                                                                                   |
| `UsageResult`             | every value in a fixture                              | delivered, refused, withheld, failed                                                                                                                                                                                                                                                                                               |
| `IdentityRole`            | every value in a fixture                              | control, crawler, canary, render                                                                                                                                                                                                                                                                                                   |
| `WitnessRole`             | every value in a fixture                              | crawler, canary                                                                                                                                                                                                                                                                                                                    |
| `RequestSigning`          | every value in a fixture                              | unsigned                                                                                                                                                                                                                                                                                                                           |
| `SignatureVerification`   | every value in a fixture                              | not_observable                                                                                                                                                                                                                                                                                                                     |
| `GradeLetter`             | pinned to v1 or the engine                            | A, A-, B+, B, B-, C+, C, C-, D+, D, D-, F                                                                                                                                                                                                                                                                                          |
| `PageKind`                | pinned to v1 or the engine                            | content, auth, search, pagination, archive, feed, status, utility, duplicate, thin                                                                                                                                                                                                                                                 |
| `CmsName`                 | pinned to v1 or the engine                            | shopify, wordpress, webflow, wix, squarespace, framer, ghost, custom                                                                                                                                                                                                                                                               |
| `RefusalTrigger`          | pinned to v1 or the engine                            | too_few_gradeable_pages, site_too_small_to_measure, too_few_gradeable_after_exclusion, nothing_read, no_observed_links                                                                                                                                                                                                             |
| `WithheldReason`          | pinned to v1 or the engine                            | too_few_crawlers_measured, blocked_by_choice, readable_unmeasured, quotable_unmeasured, signals_unmeasured, crawler_too_few_pages, check_not_scored                                                                                                                                                                                |
| `TechnicalSeoPending`     | pinned to v1 or the engine                            | grade_refused                                                                                                                                                                                                                                                                                                                      |
| `ContentScoreWithheld`    | pinned to v1 or the engine                            | no_check_counted, pages_not_read, no_check_applied                                                                                                                                                                                                                                                                                 |
| `VerificationMethod`      | registry seed only                                    | ip_list, reverse_dns, none_published                                                                                                                                                                                                                                                                                               |
| `CloudflareCategory`      | registry seed only                                    | search, agent, training                                                                                                                                                                                                                                                                                                            |
| `MeasurementStatus`       | computed by a function, every value from the fixtures | measured, not_measurable, unevaluable, withheld                                                                                                                                                                                                                                                                                    |
| `BatchPartialReason`      | worker batch result, pinned by the worker             | budget_requests, budget_bytes, budget_seconds, site_stopped, robots_unreachable, robots_too_large, site_refused, crawl_delay_over_limit, crawl_delay_10s_or_more, result_size                                                                                                                                                      |
| `DeclarationPath`         | worker batch result, pinned by the worker             | /llms.txt, /llms-full.txt, /.well-known/ucp, /.well-known/mcp, /.well-known/agent-card.json, /rsl.xml, /sitemap.xml                                                                                                                                                                                                                |
| `DeclarationState`        | worker batch result, pinned by the worker             | answered, no_response, not_requested                                                                                                                                                                                                                                                                                               |
| `DeclarationNotRequested` | worker batch result, pinned by the worker             | robots_disallowed, budget, site_stopped, site_blocked                                                                                                                                                                                                                                                                              |
| `FrontendMarker`          | worker batch result, pinned by the worker             | next_static_path, next_data_script, shopify_theme_object, shopify_section_class, hydrogen_powered_by_header, wp_content_path, webflow_site_attribute                                                                                                                                                                               |

## Open items for the engine stream

- How `template_key` is derived. The screens group pages by template (`/collections/{slug}`); the v1 engine's `templateKeyFor` keeps short slugs literal (`/collections/tents`), so it does not produce that grouping as it stands. See `TemplateKeySchema` in `common.ts`.
- AI readability's letter scale. No document defines it, so the contract does not pin AI letters to scores; Technical SEO letters are pinned to `scoreToLetter`. Choosing the scale moves band boundaries, which OPERATING-RULES §5 Amendment 2 treats as re-curving.
- Where the result-email recipient is kept until the check finishes. It is deliberately not on `Check`, which public reports and the API read; a private delivery record belongs to the stream that sends the email.
- Every value a fixture lists in `engine_derived` is regenerated by the engine at CC-19.
- The response's HTTP version on `AccessTest`. `method` and `http_version` record the request line as sent (`GET`, `1.1`); the engine's safe-fetch does not return the version the server answered with, and it changes only under OPERATING-RULES §5.

## Fixtures

Records per collection in each frozen fixture under `apps/web/lib/fixtures/v2/`. `engine_derived` counts the JSON pointers to values FACTS marks ENGINE-DERIVED.

| Fixture                | as_of                | accounts | seats | sites | checks | page_results | link_edges | access_tests | fixes | fix_events | changes | alert_rules | reports | engine_derived |
| ---------------------- | -------------------- | -------- | ----- | ----- | ------ | ------------ | ---------- | ------------ | ----- | ---------- | ------- | ----------- | ------- | -------------- |
| `bad-site.json`        | 2026-10-30T10:05:00Z | 1        | 1     | 5     | 15     | 16           | 11         | 13           | 17    | 4          | 8       | 6           | 4       | 185            |
| `clean-site.json`      | 2026-10-27T15:42:00Z | 0        | 0     | 1     | 2      | 2            | 2          | 2            | 0     | 0          | 0       | 0           | 0       | 6              |
| `challenged-site.json` | 2026-11-02T12:00:00Z | 2        | 5     | 3     | 7      | 1            | 0          | 9            | 2     | 3          | 1       | 2           | 6       | 10             |
