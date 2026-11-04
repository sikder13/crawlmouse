# SPEC 17 — Content checks, the two v2 grades, and fix effects

> Generated from `packages/engine/src/v2/grade/spec.ts`; `spec.test.ts` fails when this file differs from
> the render. Regenerate: `pnpm --filter @crawlmouse/engine exec tsx src/v2/grade/write-spec.ts`.

Grade version: `2.0.0` (`Check.grade_version`). Grades and components are given to 2 decimal places.

## AI readability

| Component | Max | From                                                 |
| --------- | --- | ---------------------------------------------------- |
| Access    | 40  | the scored crawlers' sampled pages (CC-15's matrix)  |
| Readable  | 30  | the share of words served without JavaScript (CC-14) |
| Quotable  | 20  | the five content checks                              |
| Signals   | 10  | schema.org markup and Content Signals                |

The scored crawlers are the registry's `ai_search` group; the `ai_training` group is shown and not scored.

### Access

share(c) = Σ weight(verdict) / pages with a weight, over crawler c's sampled pages; Access = 40 × mean of share(c) over the measured scored crawlers.

| Verdict              | Weight |
| -------------------- | ------ |
| `allowed`            | 1      |
| `allowed_thin`       | 0.5    |
| `blocked_by_ua_rule` | 0      |

Out of the denominator: `disallowed_by_robots`, `challenged_ua`, `refused_unverified`, `rate_limited`, `payment_required`, `edge_blocks_automation`, `redirected_away`, `not_measured`. Words served are compared with the browser control's words for the same static page, so a page that needs JavaScript reads the same for both and counts in Readable, once.

A scored crawler is measured with 2 pages or more in its denominator. One that robots.txt disallows on the pages whose rules were read (disallowed pages equal to pages read) is blocked by choice: left out of the mean, so a deliberate block lowers nothing. With fewer than 2 measured, Access has no score: `blocked_by_choice` when the scored crawlers are blocked by choice and none is measured or unmeasured; otherwise `too_few_crawlers_measured`, with the range [40 × Σshare / (m + u), 40 × (Σshare + u) / (m + u)] for m measured and u unmeasured crawlers.

### Readable

ratio(t) = median `text_share` of template t's rendered pages; Readable = 30 × Σ pages(t) × ratio(t) / Σ pages(t) over the graded pages. A template with no rendered page makes it a range, its pages counted at 0 and at 1; no graded page, or none rendered, is [0, 30]. Until CC-14 renders pages, `text_share` is null, so Readable is unmeasured on a check.

### Quotable

rate(k) = pages passing check k / pages k was decided on; Quotable = 20 × mean of rate(k) over the checks decided on a page. Graded pages not read for content make it a range: rate(k) between passing / (decided + unread) and (passing + unread) / (decided + unread).

### Signals

| Declaration            | Points | Class           |
| ---------------------- | ------ | --------------- |
| `schema_org`           | 5      | `best_practice` |
| `content_signals`      | 5      | `best_practice` |
| `web_bot_auth`         | 0      | `experimental`  |
| `llms_txt`             | 0      | `experimental`  |
| `mcp_server_card`      | 0      | `experimental`  |
| `markdown_negotiation` | 0      | `experimental`  |
| `agent_skills_index`   | 0      | `experimental`  |

Content Signals: a `Content-Signal:` line in robots.txt naming `search`, `ai-input` or `ai-train` with `yes` or `no`, as a directive or in the comment form Cloudflare writes; robots.txt not read is undecided. schema.org: a graded page carries a typed JSON-LD node. An undecided declaration makes Signals a range.

### The grade and withholding

The total is the sum of the four components, given when the four have a score; its letter is the engine scale (v1 `scoreToLetter`). Otherwise the grade is withheld, `withheld_reasons` names each component without a score, and each such component carries its range.

| Letter | From          |
| ------ | ------------- |
| `A`    | 90.00 or more |
| `A-`   | 85.00 or more |
| `B+`   | 80.00 or more |
| `B`    | 75.00 or more |
| `B-`   | 70.00 or more |
| `C+`   | 65.00 or more |
| `C`    | 60.00 or more |
| `C-`   | 55.00 or more |
| `D+`   | 50.00 or more |
| `D`    | 45.00 or more |
| `D-`   | 40.00 or more |
| `F`    | 0.00 or more  |

| Reason                      | Means                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `too_few_crawlers_measured` | Fewer than two scored crawlers have enough measured pages to give Access a score.                                               |
| `blocked_by_choice`         | robots.txt disallows the scored crawlers on the pages whose rules were read: the site's stated choice, so Access is not scored. |
| `readable_unmeasured`       | A template of the graded pages has no page rendered in a browser, so the share of text served without JavaScript is not known.  |
| `quotable_unmeasured`       | Some graded pages could not be read for the content checks, or no content check applied to a page.                              |
| `signals_unmeasured`        | Whether schema.org markup or Content Signals are present could not be decided.                                                  |

## Technical SEO

score = 0.6 × structure + 40 × crawlability. Structure is v1's grade (packages/engine/src/grade.ts, its components and weights unchanged) of the crawled link graph, 0 to 100, also `site_structure_score`. Crawlability is the mean, over the measures that apply, of: crawled URLs answering 200, and for `redirect_chain`, `canonical_mismatch`, `duplicate_pagination`, `hreflang_gap`, the records decided `not_detected` of those decided. Title and meta description facts join as one more measure once the crawl worker records them (CC-12d). The refusal is v1's `decideRefusal` (SPEC 5.1a), with 5 graded pages as its floor: a refused grade has no score.

## Content checks

A page served for JavaScript to fill in is unread for the five checks. Site chrome (`nav, footer, aside, form, [role="navigation"], [aria-hidden="true"]`) is set aside before a page is read.

| Check                     | Applies to                                                                                                                                     | Passes                                                                                                                                                                                                               | Fix (key)                                  | Class           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------- |
| `direct_answer_150`       | a page of prose: an H1 with 150 words or more after it, and no `Product` JSON-LD                                                               | within the first 150 words after the H1, a block that is not a list item and has 5 words or more holds a sentence of 8 to 60 words ending in a full stop                                                             | `quotable_opening` (`answer:`)             | `experimental`  |
| `question_headings`       | a page of prose with 3 section headings or more: an h2 or h3 after the H1 followed by a `p`, `blockquote`, `dd`, `td` block of 5 words or more | an h2 or h3 after the H1 has a clause ending in a question mark (`?`, the Arabic `؟`, or the full-width form)                                                                                                        | none in the contract: scores Quotable only | `experimental`  |
| `schema_with_description` | a page with a typed JSON-LD node                                                                                                               | a node of a type about the page itself (`…Page`, `…Article`, `BlogPosting`, `Product`, `Service`, `Event`, `TouristTrip` and the others in checks.ts) has a non-empty `description`                                  | none in the contract: scores Quotable only | `best_practice` |
| `author_and_date`         | a page whose JSON-LD has an Article-family node (`og:type=article` alone does not count)                                                       | an author (JSON-LD `author`, `meta[name=author]`, `rel=author`, `itemprop=author`) and a date (JSON-LD `datePublished` with a four-digit year, `article:published_time`, `itemprop=datePublished`, `time[datetime]`) | `missing_author_date` (`byline:`)          | `best_practice` |
| `specs_as_text`           | a page with `Product` JSON-LD                                                                                                                  | fails when an image whose alt text or file name names specifications, and is not a link to another page, is shown with no table or description list and fewer than 2 "Label: value" lines with a digit               | `specs_as_images` (`spec:`)                | `best_practice` |

A template's content fix is detected when 2 or more of its decided pages fail and they are 50 % or more of them; clear at 10 % or less; indeterminate between (hysteresis), or when a page of the template was not read. An opened content fix is `info` (diff/severity.ts).

### The label set

141 pages from the production audit corpus, labelled by a person before the checks existed
(`packages/engine/fixtures/v2/content/labels.json`), with 9 corrections, each recorded with its cause.
Each page carries its URL, fetch date, the features `readPage` read, the labels with their reasons, and the
sha256 of the excerpt the labels were made from. The excerpts are other people's text and are not tracked:
`fixtures/v2/content/fetch.ts` refetches the pages from their URLs and `generate.ts` rebuilds the features.
A check fires when it judges a page `fail`; precision is the share of its firings the person also judged
`fail`, and a check that fires at all must keep it at 95 % or more (labels.test.ts).

| Check                     | Labelled | Failing (person) | Fires | Confirmed | Precision                 | Recall                   |
| ------------------------- | -------- | ---------------- | ----- | --------- | ------------------------- | ------------------------ |
| `direct_answer_150`       | 109      | 11               | 0     | 0         | not measurable: no firing | 0 of 11                  |
| `question_headings`       | 113      | 31               | 20    | 19        | 95 %                      | 19 of 31                 |
| `schema_with_description` | 113      | 17               | 16    | 16        | 100 %                     | 16 of 17                 |
| `author_and_date`         | 141      | 2                | 2     | 2         | 100 %                     | 2 of 2                   |
| `specs_as_text`           | 113      | 0                | 0     | 0         | not measurable: no firing | no failing page labelled |

## Fix effects

Each effect is a counterfactual recompute. Fixes are ranked by their effect applied alone (Technical SEO plus AI readability, larger first; ties by fingerprint); in that order each effect is the grade with it and the fixes above it applied, less the grade without it, so the effects add up to the projected grade. Two fixes whose counterfactuals overlap share one effect, taken by the higher-ranked. Technical SEO is measured on its formula before the refusal. The AI effect is the change in the component the fix moves; when that component has no score before or after, it is null and waits on its reason.

| Fix                         | Counterfactual                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `orphan_pages`              | a link to the page from its `suggested_parent_url`, or from the homepage when it has none |
| `deep_pages`                | a link to the page from the homepage                                                      |
| `generic_anchor_text`       | the hub's outbound links get descriptive anchors                                          |
| `redirect_chain`            | the record becomes `not_detected`                                                         |
| `canonical_mismatch`        | the record becomes `not_detected`                                                         |
| `duplicate_pagination`      | the record becomes `not_detected`                                                         |
| `hreflang_gap`              | the record becomes `not_detected`                                                         |
| `edge_rule_blocks_crawler`  | the crawler's `blocked_by_ua_rule` pages become `allowed`                                 |
| `robots_txt_blocks_crawler` | none: respected intent opens no fix                                                       |
| `quotable_opening`          | the template's failing pages pass the check                                               |
| `missing_author_date`       | the template's failing pages pass the check                                               |
| `specs_as_images`           | the template's failing pages pass the check                                               |
| `client_rendered_template`  | none yet: the fix type needs rendered pages (CC-14)                                       |
| `js_only_navigation`        | none yet: the fix type needs rendered pages (CC-14)                                       |

A structure fix takes its recommendation class from its type; the structure detectors read our own crawl, so its confidence is `likely`:

| Structure fix          | Class                    |
| ---------------------- | ------------------------ |
| `orphan_pages`         | `best_practice`          |
| `deep_pages`           | `best_practice`          |
| `generic_anchor_text`  | `best_practice`          |
| `redirect_chain`       | `best_practice`          |
| `duplicate_pagination` | `best_practice`          |
| `canonical_mismatch`   | `documented_requirement` |
| `hreflang_gap`         | `documented_requirement` |

## Example sites (expected.json)

| Site                                                                              | Technical SEO | AI readability                        | Fixes | Fixes add (SEO / AI) |
| --------------------------------------------------------------------------------- | ------------- | ------------------------------------- | ----- | -------------------- |
| client-rendered, 31 % text, every crawler served                                  | 80.8 B+       | 79.3                                  | 0     | 0 / 0                |
| client-rendered, not yet rendered                                                 | 80.8 B+       | withheld: `readable_unmeasured`       | 0     | 0 / 0                |
| blog: a crawler blocked, one served thin, 8 openings without an answer, 2 orphans | 84.27 B+      | 77.5                                  | 6     | 2.61 / 12.5          |
| blog: one scored crawler measured                                                 | 87.42 A-      | withheld: `too_few_crawlers_measured` | 1     | 0 / waits            |

## Verify

```bash
pnpm --filter @crawlmouse/engine exec vitest run src/v2/grade src/v2/content src/v2/diff/severity.test.ts
```
