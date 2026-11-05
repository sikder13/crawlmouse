# SPEC 17 — Content checks, the two v2 grades, and fix effects

> Generated from `packages/engine/src/v2/grade/spec.ts`; `spec.test.ts` fails when this file differs from
> the render. Regenerate: `pnpm --filter @crawlmouse/engine exec tsx src/v2/grade/write-spec.ts`.
> Weights, thresholds, counts and tables of data are read from the code and fixtures; the prose and the
> descriptions of each rule and counterfactual are written in spec.ts and checked against the code by review.

Grade version: `2.0.0` (`Check.grade_version`). Grades and components are given to 2 decimal places.

## AI readability

| Component | Max | From                                                                    |
| --------- | --- | ----------------------------------------------------------------------- |
| Access    | 40  | the scored crawlers' sampled pages (CC-15's matrix)                     |
| Readable  | 30  | the share of words served without JavaScript (CC-14)                    |
| Quotable  | 20  | the counted content checks: none yet (the bar is under "The label set") |
| Signals   | 10  | schema.org markup and Content Signals                                   |

The scored crawlers are the registry's `ai_search` group; the `ai_training` group is shown and not scored.

### Access

share(c) = Σ weight(verdict) / pages with a weight, over crawler c's sampled pages; Access = 40 × mean of share(c) over the measured scored crawlers.

| Verdict              | Weight |
| -------------------- | ------ |
| `allowed`            | 1      |
| `allowed_thin`       | 0.5    |
| `blocked_by_ua_rule` | 0      |

Out of the denominator: `disallowed_by_robots`, `challenged_ua`, `refused_unverified`, `rate_limited`, `payment_required`, `edge_blocks_automation`, `redirected_away`, `not_measured`. Words served are compared with the browser control's words for the same static page, so a page that needs JavaScript reads the same for both and counts in Readable, once.

A scored crawler is measured with 2 pages or more in its denominator. One that robots.txt disallows on the pages whose rules were read (disallowed pages equal to pages read) is blocked by choice: left out of the mean, so the block is not scored as a block, and Access moves to the mean of the others (up when that crawler's share was below it, down when above) while enough crawlers stay measured; otherwise the rule below applies, and Access can be left with no score. With fewer than 2 measured, Access has no score: `blocked_by_choice` when the scored crawlers are blocked by choice and none is measured or unmeasured; otherwise `too_few_crawlers_measured`, with the range [40 × Σshare / (m + u), 40 × (Σshare + u) / (m + u)] for m measured and u unmeasured crawlers.

One exception (owner ruling, 2026-11-05): with fewer than 2 measured but at least one, when every scored crawler that is not measured is blocked by choice, none of them with a page `refused_unverified`, Access is scored from the measured ones, and `scored_from_fewer_crawlers` records how many. The measured crawlers' own pages follow the ordinary rules: a page of theirs refused as unverified is out of the denominator, as it is with two measured. Disallowing a crawler whose share is below the others' mean therefore raises Access, as far as unblocking it would when the others' mean is 1: a disallow is the site's stated intent (R11 decision 5), left out rather than counted against the site. No fix opens for it, and no fix copy may recommend disallowing a crawler.

### Readable

ratio(t) = median `text_share` of template t's rendered pages; Readable = 30 × Σ pages(t) × ratio(t) / Σ pages(t) over the graded pages. A template with no rendered page makes it a range, its pages counted at 0 and at 1; no graded page, or none rendered, is [0, 30]. Until CC-14 renders pages, `text_share` is null, so Readable is unmeasured on a check.

### Quotable

rate(k) = pages passing check k / pages k was decided on; Quotable = 20 × mean of rate(k) over the counted checks decided on a page. A check counts only once it clears the bar under "The label set" (below); no check does yet, so Quotable has no score: it is the range [0, 20], and AI readability is withheld for `quotable_unmeasured`. A counted check's graded pages that were not read for it make Quotable a range: rate(k) between passing / (decided + unread) and (passing + unread) / (decided + unread), over each check decided or unread on a page. Nothing decided and nothing unread is the range [0, 20].

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
| `ucp`                  | 0      | `experimental`  |
| `rsl`                  | 0      | `experimental`  |
| `agent_card`           | 0      | `experimental`  |
| `llms_full`            | 0      | `experimental`  |

Content Signals: a `Content-Signal:` line in robots.txt naming `search`, `ai-input` or `ai-train` (as a key of its own: at the start of the value or after a space, comma or semicolon) with `yes` or `no`, as a directive or in the comment form Cloudflare writes; robots.txt not read is undecided. schema.org: a graded page carries a typed JSON-LD node; with none marked, it is undecided while a graded page was not fetched, or when there is no graded page. An undecided declaration makes Signals a range.

### The grade and withholding

The total is the sum of the four components, given when the four have a score; its letter is the engine scale (v1 `scoreToLetter`). Otherwise the grade is withheld, `withheld_reasons` names each component without a score, and each such component carries its range. AI readability is graded whether or not Technical SEO is refused: the refusal covers the structure grade only, and the copy beside a refused grade must say so (owner ruling, 2026-11-05; UI work, not written yet).

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

| Reason                      | Means                                                                                                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `too_few_crawlers_measured` | Fewer than two scored crawlers have enough measured pages to give Access a score.                                                                                                                    |
| `blocked_by_choice`         | robots.txt disallows the scored crawlers on the pages whose rules were read: the site's stated choice, so Access is not scored.                                                                      |
| `readable_unmeasured`       | A template of the graded pages has no page rendered in a browser, so the share of text served without JavaScript is not known.                                                                       |
| `quotable_unmeasured`       | No content check counts in Quotable (a check counts once it clears the bar on an independent, held-out label set), or a counted check could not be read on some graded pages, or applied to no page. |
| `signals_unmeasured`        | Whether schema.org markup or Content Signals are present could not be decided.                                                                                                                       |
| `crawler_too_few_pages`     | For a fix's effect only: the fix's crawler has fewer than two pages that decide its share, so how much Access it adds is not known.                                                                  |
| `check_not_scored`          | For a fix's effect only: the fix's content check is reported but not counted in Quotable (it has not cleared the bar on an independent, held-out label set), so it adds no points yet.               |

## Technical SEO

score = 0.6 × structure + 40 × crawlability. Structure is v1's grade (packages/engine/src/grade.ts, its components and weights unchanged) of the link graph whose nodes are the crawled pages answering 200 (a 404 or a redirect is a crawl outcome, not a node: v1's SPEC 01 path), 0 to 100, also `site_structure_score`. Crawlability is the share of crawled URLs that answer 200 and carry no crawlability defect (owner rulings, 2026-11-05). A defect is counted on the URL that carries it, once however many it carries, so one defective URL on a site of N crawled URLs moves the score by 40/N:

| Defect                                               | The URL that carries it                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a detected `redirect_chain` record                   | the redirecting URL (the pages linking to it are where the fix is made, and carry no defect)                                                                                                                                                                                                                                                                                 |
| a detected `canonical_mismatch` record               | the page whose canonical cannot be honoured, or that is linked under another URL                                                                                                                                                                                                                                                                                             |
| a detected `duplicate_pagination` record             | each later page found to repeat page 1                                                                                                                                                                                                                                                                                                                                       |
| a detected `hreflang_gap` record                     | each URL the detector marks: a member missing its self-reference or its x-default, or with an invalid code; for a missing return, the alternate that was read and does not annotate back; for an alternate that redirects or is gone, the member that names it (the record says which: `hreflang_missing_return`, `hreflang_alternate_redirects`, `hreflang_alternate_gone`) |
| no title, or no meta description (CC-12d page facts) | the page answering 200, read as HTML, that declares none                                                                                                                                                                                                                                                                                                                     |
| an answer other than 200                             | the URL itself: the denominator is every crawled URL, so a linked 404 or 301 is outside the numerator                                                                                                                                                                                                                                                                        |

The worker stores a requested URL with its final response's status. A chain the crawl stopped is a 3xx row, outside the numerator already, so its record costs nothing extra; a chain followed to a page answering 200 is a 200 row, and its record takes that URL out of the numerator. In both, one site-wide link to a redirect costs at most one URL (formula rows in technical-seo.test.ts, one per shape). The redirect fix's counterfactual is the fix: links to the redirecting URL point at the final URL, and the redirecting row goes (a stopped chain's row goes and its links stay, since they are not graph edges; a final URL that was not crawled takes the row's place). No fix type clears a linked 404 or a single-hop 301 yet (CC-16b). A page whose title or description was not read (`null`) carries no defect of that kind. No fix type opens for a missing title or meta description yet, so nothing recovers what it costs: on the example site "14-page blog: every page declares a title and no meta description", Technical SEO is 47.42 D (0.6 × 79.03 + 40 × crawlability ≈ 0.000, from the grade as recorded), with 0 fixes: a site missing one on every page loses all 40 crawlability points (an owner question). A record that could not decide marks no URL, so its URLs count as clean; that is this branch's reading (the old formula dropped a measure with nothing decided).

On the example sites: on "14-page blog: a link on every page to a URL behind a redirect chain, crawled as a 301", where the 301 is the one URL outside the numerator with or without the record (the example carries the record without the menu links, which a 3xx row, not being a graph node, would not change), Technical SEO is 84.75 (0.6 × 79.03 + 40 × crawlability ≈ 0.933, from the grade as recorded) and the fix is worth +2.67; on "14-page blog: a link on every page to a URL behind a redirect chain that ends at a post", where the record takes the 200 row out of the numerator, Technical SEO is 83.14 (0.6 × 76.35 + 40 × crawlability ≈ 0.933, from the grade as recorded) and the fix is worth +3.52. The refusal is v1's `decideRefusal` (SPEC 5.1a), with 5 graded pages as its floor: a refused grade has no score.

## Content checks

Site chrome (`nav, footer, aside, form, [role="navigation"], [aria-hidden="true"]`) is set aside before a page is read. A page served for JavaScript to fill in is judged as the column "Client-rendered" says. "Counted" is whether the check counts in Quotable.

| Check                     | Applies to                                                                                                                                     | Passes                                                                                                                                                                                                               | Client-rendered                                                 | Fix (key)                                | Counted | Class, confidence                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------- | ------- | ---------------------------------------- |
| `direct_answer_150`       | a page of prose: an H1 with 150 words or more after it, and no `Product` JSON-LD                                                               | within the first 150 words after the H1, a block that is not a list item and has 5 words or more holds a sentence of 8 to 60 words ending in a full stop                                                             | unread                                                          | `quotable_opening` (`answer:`)           | no      | `experimental`, `inconclusive`           |
| `question_headings`       | a page of prose with 3 section headings or more: an h2 or h3 after the H1 followed by a `p`, `blockquote`, `dd`, `td` block of 5 words or more | an h2 or h3 after the H1 has a clause ending in a question mark (`?`, the Arabic `؟`, or the full-width form)                                                                                                        | unread                                                          | `no_question_headings` (`questions:`)    | no      | `experimental`, `inconclusive`           |
| `schema_with_description` | every page read: a page with no JSON-LD fails (owner ruling, 2026-11-05)                                                                       | a node of a type about the page itself (`…Page`, `…Article`, `BlogPosting`, `Product`, `Service`, `Event`, `TouristTrip` and the others in checks.ts) has a non-empty `description`                                  | unread                                                          | `missing_schema_description` (`schema:`) | no      | `documented_requirement`, `inconclusive` |
| `author_and_date`         | a page whose JSON-LD has an Article-family node (`og:type=article` alone does not count)                                                       | an author (JSON-LD `author`, `meta[name=author]`, `rel=author`, `itemprop=author`) and a date (JSON-LD `datePublished` with a four-digit year, `article:published_time`, `itemprop=datePublished`, `time[datetime]`) | not applicable without an Article-family node; otherwise unread | `missing_author_date` (`byline:`)        | no      | `best_practice`, `inconclusive`          |
| `specs_as_text`           | a page with `Product` JSON-LD                                                                                                                  | fails when an image whose alt text or file name names specifications, and is not a link to another page, is shown with no table or description list and fewer than 2 "Label: value" lines with a digit               | not applicable without `Product` JSON-LD; otherwise unread      | `specs_as_images` (`spec:`)              | no      | `best_practice`, `inconclusive`          |

A template's content fix is detected when 2 or more of its decided pages fail and they are 50 % or more of them; clear at 10 % or less; indeterminate between (hysteresis), or when a page of the template was not read. An opened content fix is `info` (diff/severity.ts).

The Content section (`Check.content`) reports the five checks per template, and each entry of `content.checks` says whether its check is `counted`. Its score is 100 × the mean pass rate of the counted checks; while there is none, `score` is null and `score_withheld` says why (owner ruling, 2026-11-05). No check counts yet, so the score is withheld as `no_check_counted` on every check.

| Reason             | Means                                                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no_check_counted` | No content check counts toward the score yet (a check counts once it clears the bar on an independent, held-out label set); the checks are reported. |
| `pages_not_read`   | A counted check could not be read on some graded pages, so its pass rate is a range.                                                                 |
| `no_check_applied` | No counted check applied to any graded page.                                                                                                         |

### The label set

141 pages from the production audit corpus (`packages/engine/fixtures/v2/content/labels.json`): 113 labelled for all five checks; 28 labelled for `author_and_date` only. The pages labelled for fewer checks were added afterwards to give a check more pages it applies to; a check's counts leave out the pages not labelled for it.

**Who labelled them.** The session that implemented the checks, reading a machine-made text view of each
saved page against the criteria below. The labels are not an independent person's, and the reviewer checks
them against the excerpts. The corrected labels were made with the checks' verdicts in view: they were
found where a check and a label disagreed. Each page carries its URL, fetch date, the features `readPage`
read, the labels with their reasons, and the sha256 of the excerpt the labels were made from. The excerpts
and the saved pages are other people's text and are not tracked; label reasons quote short headings. The
URLs let anyone refetch today's page (`fixtures/v2/content/fetch.ts`), the excerpt hash lets a reviewer
holding the excerpts confirm which text each label was made from, and `generate.ts` rebuilds the features
from saved pages. The file records the digest
of the reader the features were read with, and labels.test.ts fails when it is not the reader's.

**How the set was used.** To choose rules as well as to measure them, so its counts are not a held-out
test of the rules they helped choose. labels.json records it: independent `false`, held out `false`.

The criteria, as labels.json carries them:

> # CC-17 content-check labels — the criteria
>
> Labels are a judgement of the saved page (raw/<id>.html, fetched once; see index.json), made by the
> session that implemented the checks, reading a machine-made text view of each page (view.txt) against
> the criteria below, not the checks' rules. They were not made by an independent person; the excerpts
> they were made from are kept for a reviewer to check them against.
> Values: pass, fail, na (the check does not apply to this page), unsure (excluded from precision; reason given).
>
> - direct_answer_150 — applies to a page with a visible H1 and at least ~150 words of body text after it,
>   served without JavaScript. pass: within the opening (ignoring bylines, dates, breadcrumbs, tables of
>   contents, forms, prices and calls to action) a sentence, quoted alone, answers or summarises the H1's
>   subject. fail: the opening is only a hook, a teaser, a rhetorical question, a promise ("here's how") or
>   page furniture.
> - question_headings — applies to a page with at least 3 content h2/h3 headings (site chrome, related
>   items and sidebars do not count). pass: at least one content heading is phrased as a question.
>   Added in review: a page whose question headings are all calls to action is unsure, since these
>   criteria do not say whether a call to action is a content heading.
> - schema_with_description — applies to a page with JSON-LD. pass: a node describing the page's own
>   subject (the page, the article, the product, the service, the trip) carries a description. fail: only
>   site-wide nodes (WebSite, the organisation or business) carry one, or none does.
> - author_and_date — applies to a page whose JSON-LD declares an Article-family type. pass: an author and a
>   publication date are both stated, in markup or visibly. fail: either is missing.
> - specs_as_text — applies to a page whose JSON-LD declares Product. pass: the product's own
>   specifications, if it has any, are readable as text. fail: they appear only in an image.
>
> A client-rendered page (nothing served to read) is na for every check.

A check fires when it judges a page `fail`. Precision is the share of its firings labelled `fail`;
pass accuracy the share of the pages it judges `pass` that are labelled `pass`; pages labelled `unsure` are
left out. "Applies" counts the pages labelled `pass` or `fail`. After each share, ≥ is its exact one-sided 95 % lower
bound (Clopper-Pearson): how far the sample vouches for it.

**The bar (owner ruling, 2026-11-05).** A check counts in Quotable only on a label set that is independent (labelled by someone other than the session that implemented the checks) and held out (labels frozen before the check runs on it), with 14 confirmed firings or more and a lower bound of 80 % or more on both its precision and its pass accuracy (label-set.ts `counts`). The firings follow from the bound: 13 of 13 has a lower bound of 79.4 %. This set is neither independent nor held out, so no check counts on it, whatever its numbers; labels.test.ts fails while any check is counted. CC-18 builds the set the bar asks for. By the numbers alone, no check would clear the bar as labelled now, and no check as first read.

| Check                     | Counted | Applies | Labelled fail | Precision               | Pass accuracy            | Recall                   |
| ------------------------- | ------- | ------- | ------------- | ----------------------- | ------------------------ | ------------------------ |
| `direct_answer_150`       | no      | 81      | 11            | no firing               | 81 % (51 of 63; ≥ 70 %)  | 0 of 11                  |
| `question_headings`       | no      | 55      | 31            | 95 % (20 of 21; ≥ 79 %) | 96 % (22 of 23; ≥ 80 %)  | 20 of 31                 |
| `schema_with_description` | no      | 81      | 17            | 36 % (16 of 44; ≥ 24 %) | 96 % (64 of 67; ≥ 88 %)  | 16 of 17                 |
| `author_and_date`         | no      | 63      | 2             | 100 % (2 of 2; ≥ 22 %)  | 100 % (61 of 61; ≥ 95 %) | 2 of 2                   |
| `specs_as_text`           | no      | 26      | 0             | no firing               | 93 % (26 of 28; ≥ 79 %)  | no failing page labelled |

**The call-to-action ruling.** On 6 pages every question heading is a call to action; they are labelled `unsure` for `question_headings` until CC-18 relabels the set. The owner ruled (2026-11-05) that a call-to-action question is not a content heading. Counted that way, `question_headings` has precision 95 % (20 of 21; ≥ 79 %) and pass accuracy 81 % (22 of 27; ≥ 64 %); if a call-to-action question is a content heading, precision 95 % (20 of 21; ≥ 79 %) and pass accuracy 96 % (26 of 27; ≥ 83 %). The check as built counts a call to action as a question, so it must set them aside before CC-18 measures it again.

**`schema_with_description` after the 2026-11-05 ruling.** 28 of its 44 firings are on pages labelled `na` that carry no JSON-LD: the criteria made such a page not applicable, and the ruling makes it fail. The labels are not changed until CC-18, so its precision here is against the old rule.

**Rules measured and not kept.** Each was measured on this set beside the rule kept, whose counts the
table repeats after "kept". The table is partial: the reader rules changed in review (the client-rendered
definition, bylines read after site chrome, nested blocks read once) fixed defects, and their alternatives
were not measured.

| Check                     | Rule tried                                        | Precision                                              | Pass accuracy                                           |
| ------------------------- | ------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------- |
| `question_headings`       | a question counts only among the section headings | 91 % (21 of 23; ≥ 75 %); kept: 95 % (20 of 21; ≥ 79 %) | 100 % (21 of 21; ≥ 86 %); kept: 96 % (22 of 23; ≥ 80 %) |
| `schema_with_description` | a client-rendered page is judged on its JSON-LD   | 35 % (16 of 46; ≥ 23 %); kept: 36 % (16 of 44; ≥ 24 %) | 96 % (64 of 67; ≥ 88 %); kept: 96 % (64 of 67; ≥ 88 %)  |

**Corrections.** 11 labels were changed after the first reading, each recorded with its first
label, its reason and its cause. Their effect on agreement with the check: disagreeing → agreeing 4, disagreeing → left out 3, on a page the check does not judge 2, agreeing → left out 1, left out → agreeing 1. By cause:

- 3 on `question_headings` (`fail` → `pass` 2, `unsure` → `fail` 1): the labelling view listed only the first 12 h2/h3 headings of a page; the full list was read.
- 1 on `schema_with_description` (`na` → `fail` 1): the labelling view did not flatten JSON-LD nested in arrays, so a page with markup read as having none.
- 6 on `question_headings` (`fail` → `unsure` 4, `pass` → `unsure` 2): every question heading on the page is a call to action, and the criteria do not say whether a call to action is a content heading; the first reading went both ways on such pages, so each is unsure.
- 1 on `author_and_date` (`fail` → `pass` 1): the labelling view scanned for a byline and missed one marked up as schema.org Person microdata.

The counts with the labels as first read, before the corrections:

| Check                     | Counted | Applies | Labelled fail | Precision               | Pass accuracy           | Recall                   |
| ------------------------- | ------- | ------- | ------------- | ----------------------- | ----------------------- | ------------------------ |
| `direct_answer_150`       | no      | 81      | 11            | no firing               | 81 % (51 of 63; ≥ 70 %) | 0 of 11                  |
| `question_headings`       | no      | 60      | 36            | 95 % (19 of 20; ≥ 78 %) | 78 % (21 of 27; ≥ 60 %) | 19 of 36                 |
| `schema_with_description` | no      | 80      | 16            | 34 % (15 of 44; ≥ 22 %) | 96 % (64 of 67; ≥ 88 %) | 15 of 16                 |
| `author_and_date`         | no      | 63      | 3             | 100 % (2 of 2; ≥ 22 %)  | 98 % (60 of 61; ≥ 92 %) | 2 of 3                   |
| `specs_as_text`           | no      | 26      | 0             | no firing               | 93 % (26 of 28; ≥ 79 %) | no failing page labelled |

## Fix effects

Each effect is a counterfactual recompute. Fixes whose AI effect applied alone can be stated rank first, then the fixes whose AI effect waits on a reason; within each group by the effect applied alone (Technical SEO plus AI readability, larger first; an effect not estimated counts 0); ties by fingerprint. While AI readability is withheld every fix is in the second group, so rank, and with it which fixes are free, follow Technical SEO. In that order each effect is the grade with it and the fixes above it applied, less the grade without it, so the effects add up to the projected grade less the current one.

An effect can be 0 or negative: a counterfactual can lower a grade, as a link added for a deep page can lower the concentration of PageRank on hubs, and two fixes can change the same thing. The computed value is kept, so the effects still add up (owner ruling, 2026-11-05). When a fix would raise a grade alone and its effect in the order is 0 or less, `absorbed_by` names the higher-ranked fix that took it: of the fixes above it that name a page, crawler or template it names, the one whose application takes its effect from above 0 to 0 or less. When the effect is already gone before any such fix, a fix naming nothing it names took it (through the link graph, say), and `absorbed_by` is null; it is null too when none is found. The effect is kept as computed either way. The engine records the fix by fingerprint and the diff writes its `number`. The copy that says so ("covered by fix #k") is UI work.

A page carrying two crawlability defects counts once, so fixing either alone moves nothing; in the order, the first shows 0 and the second the whole change, and neither is absorbed (neither would raise a grade alone).

An effect is the change in the grades as given, each to 2 places, so it can differ in the last place from the change before rounding; the effects then add up to the change in the grades as given.

Technical SEO is null, waiting on `grade_refused`, when the grade is refused as checked, or before or after the fix: there is no score to move. AI readability is the change in the grade's total. It is null while the grade is withheld as checked, before or after the fix, and waits on the grade's withheld reasons; it also waits when the fix cannot move a score: a content fix's check does not count in Quotable (`check_not_scored`), or an edge fix's crawler has too few pages for a share (`crawler_too_few_pages`). Until a check counts in Quotable, AI readability is withheld on every check, so no AI effect is stated (owner ruling, 2026-11-05; component deltas on the screen are UI work). The projected grades leave out fixes on checks that do not count. A link a counterfactual adds carries no anchor text, and anchor diversity leaves it out.

| Fix                          | Counterfactual                                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `orphan_pages`               | a link to the page from its `suggested_parent_url`, or from the homepage when it has none                                                      |
| `deep_pages`                 | a link to the page from the deepest graded page within 2 clicks of the homepage (the lowest URL among them), or from the homepage when none is |
| `generic_anchor_text`        | the hub's outbound links get descriptive anchors                                                                                               |
| `redirect_chain`             | the record becomes `not_detected`, and the redirecting URL leaves the crawl (the links point at the final URL)                                 |
| `canonical_mismatch`         | the record becomes `not_detected`, so it marks no page                                                                                         |
| `duplicate_pagination`       | the record becomes `not_detected`, so it marks no page                                                                                         |
| `hreflang_gap`               | the record becomes `not_detected`, so it marks no page                                                                                         |
| `edge_rule_blocks_crawler`   | the crawler's `blocked_by_ua_rule` pages become `allowed`                                                                                      |
| `robots_txt_blocks_crawler`  | none: respected intent opens no fix                                                                                                            |
| `quotable_opening`           | the template's failing pages pass the check, when the check counts                                                                             |
| `missing_author_date`        | the template's failing pages pass the check, when the check counts                                                                             |
| `specs_as_images`            | the template's failing pages pass the check, when the check counts                                                                             |
| `missing_schema_description` | the template's failing pages pass the check, when the check counts                                                                             |
| `no_question_headings`       | the template's failing pages pass the check, when the check counts                                                                             |
| `client_rendered_template`   | none yet: the fix type needs rendered pages (CC-14)                                                                                            |
| `js_only_navigation`         | none yet: the fix type needs rendered pages (CC-14)                                                                                            |

A structure fix takes its recommendation class from its type; the structure detectors read our own crawl, so its confidence is `likely`. A content fix takes its check's class and confidence (the content checks table).

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

| Site                                                                                    | Technical SEO | AI readability                                               | Fixes | Fixes add (SEO / AI) |
| --------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------ | ----- | -------------------- |
| blog: no post names its author, 6 of 13 lack a page description, no question headings   | 87.42 A-      | withheld: `quotable_unmeasured`                              | 2     | 0 / waits            |
| 31 % of words served without JavaScript, every crawler served                           | 80.8 B+       | withheld: `quotable_unmeasured`                              | 0     | 0 / waits            |
| words without JavaScript not yet measured                                               | 80.8 B+       | withheld: `readable_unmeasured`, `quotable_unmeasured`       | 0     | 0 / waits            |
| blog: a crawler blocked, one served thin, 8 openings without an answer, 2 orphans       | 84.27 B+      | withheld: `quotable_unmeasured`                              | 6     | 2.27 / waits         |
| blog: one scored crawler measured                                                       | 87.42 A-      | withheld: `too_few_crawlers_measured`, `quotable_unmeasured` | 1     | 0 / waits            |
| blog: one scored crawler measured, the other three disallowed by robots.txt             | 87.42 A-      | withheld: `quotable_unmeasured`                              | 0     | 0 / waits            |
| 14-page blog: every page declares a title and no meta description                       | 47.42 D       | withheld: `quotable_unmeasured`                              | 0     | 0 / waits            |
| 14-page blog: a link on every page to a URL behind a redirect chain that ends at a post | 83.14 B+      | withheld: `quotable_unmeasured`                              | 1     | 3.52 / waits         |
| 14-page blog: a link on every page to a URL behind a redirect chain, crawled as a 301   | 84.75 B+      | withheld: `quotable_unmeasured`                              | 1     | 2.67 / waits         |
| 45 pages: the second page of a paginated archive repeats the first                      | 83.53 B+      | withheld: `quotable_unmeasured`                              | 2     | 4.47 / waits         |

## Verify

```bash
pnpm --filter @crawlmouse/engine exec vitest run src/v2/grade src/v2/content src/v2/diff
```
