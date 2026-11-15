# CC-40 — the public site's SEO, AEO and GEO, made launch-ready

v2 goes public by switching flags (`V2_CHECKS_PUBLIC`, `V2_BILLING`, with `V2_ACCOUNT_DOOR` and
`V2_PIPELINE`). This step makes what search and answer engines read about Crawlmouse true for v2 in that
build, keeps the flags-off build what main serves, and adds structure without moving anything that
earns impressions. The rule above every decision: no URL, title, H1, heading or canonical that earns
impressions changes without the owner (OPERATING-RULES §13).

## What differed from the brief, on main 66c58828

- 18 posts, not 19 (`grep -c '^    slug:' apps/web/lib/blog/posts.ts`); 14 of them mention a grade
  (`git grep -l -i grade apps/web/lib/blog/content | wc -l`).
- The Search Console export has no page × query table. Which queries a page earns is attributed by word
  match (`apps/web/lib/seo/attribution.ts`) and labelled "attributed" wherever it is shown.
- Two guards froze each pre-C-01 post's article markup and links (`__tests__/blog-existing-posts-*.test.tsx`).
  D4–D6 change those by design; the guards now require the baseline back after the listed additions are
  set aside and the D5 edits reversed (D4 below).
- The v2 home's plan card says Agency $69 (`apps/web/components/v2/screens/home/HomeScreen.tsx`);
  `apps/web/lib/billing/prices.ts` and `/pricing` say $99. D2's structured data follows prices.ts; the
  card is the owner's to correct before the flag turns on.

## Decisions

**D1 — Audit first, rendered, both builds.** `scripts/seo/audit.ts` (`pnpm seo:audit`) reads a running
production build's sitemap, fetches each listed URL and each app surface, and saves the run;
`--render` writes `docs/seo/page-audit.md` from saved runs (`docs/seo/audit-data/`). The analysis is in
`apps/web/lib/seo/`: `page-facts.ts` (what a crawler reads on a page), `schema-required.ts` (the
properties this site requires of each schema.org type; a type with none declared fails),
`search-console.ts` (the 2026-11-15 export as data), `attribution.ts`, `app-surfaces.ts` (every
`app/` route folder classified; `app-surfaces.test.ts` fails on one that is not), `audit-run.ts`,
`audit-report.ts`. The report shows, per build: status, title and description lengths, H1 count,
skipped heading levels, canonical, robots, JSON-LD types and missing properties, in/out internal links,
word count, images without alt, Search Console clicks/impressions/position and attributed top queries;
the posts not in Search Console's indexed list with the measured factors (canonical, noindex, in-links,
words, nearest post by 5-gram similarity) against the indexed posts' range, and Search Console's own
not-indexed reasons (counts only — the export lists no URL per reason); each app surface's answer in
both builds; and what `https://www.crawlmouse.com/` answers. Run before any page change (commit
`2cdd003d`) and on the final tree.

**D2 — v2 truth, keyed on the flags, v1 byte-identical.** With `V2_CHECKS_PUBLIC` on: the v2 home has
its own title, description, Open Graph and Twitter text (`app/v2-home/page.tsx`), so the root layout,
which v1's home and v1 /pricing and /developers inherit, is not touched; the root share card's words and
`alt` follow the flag (`app/opengraph-image.tsx`; the card is built with the site, so the flag is read
at build); `softwareApplicationLd()` describes v2 and offers Free at 0, Pro monthly and yearly, and —
while `V2_BILLING` sells it — Agency monthly and yearly, each price from `prices.ts`;
`organizationLd()` names Crawlmouse with `parentOrganization` Nahl Technologies Inc
(https://nahltech.com) and an address of locality, region and country only (Indianapolis, IN, US) and
no `sameAs` (no profile is known to exist); `/llms.txt` carries the v2 descriptor and lists each key
page with its own title and meta description read from the page's metadata (`lib/seo/llms-v2.ts`),
then every post with its description. The three owner strings are one constant each in
`lib/seo/site-copy.ts`; the options are in the step's notes (`copy-proposals.md`).
Flags off: `lib/seo/flags-off-v1.test.tsx` compares the root layout metadata, the share card (its PNG's
sha256), Organization, WebSite and SoftwareApplication, and `/llms.txt` with a capture from main 66c58828.

**D3 — Technical SEO on each public page, both builds, pinned by one test.** See subagent A's section
(below, completed at merge).

**D4 — Answer-engine structure, additive only.** `lib/blog/answers.ts` holds, per post, the summary and
the "Questions this answers" items, each with the body sentences it is drawn from;
`__tests__/blog-answers.test.tsx` requires those sentences in the post, each number of an addition in
its sources, and each word of three letters or more in the body. 13 posts already opened with a Quick
answer and 15 already ended with their own visible FAQ: those keep theirs (the Quick answer becomes the
Article `abstract`). A summary was added on 5 posts and "Questions this answers" on 3; `updatedAt` is
2026-11-15 on those 5. The research post carries `Dataset` structured data from its own body
(`lib/blog/datasets.ts`), with no licence claimed. The byline gains the author's role and LinkedIn where a
post names an author. One inline source was added where the source was read and states the figures.
Additions live in named containers (`p.post-summary`, `section.post-questions`, `.post-author-role`,
`sup.post-source`, `nav[aria-label="More on this topic"]`), which the two pinned guards set aside.

**D5 — Accurate for v2, smallest edits.** Each edit is data in `apps/web/lib/blog/v2-edits.ts`;
`__tests__/blog-v2-edits.test.ts` checks each `after` stands at its line and each `before` is gone, and the
existing-post guard reverses each one and requires the baseline markup. The table below is
`v2EditsMarkdown()`'s output; `__tests__/spec-40-d5-table.test.ts` fails when it differs.

<!-- prettier-ignore-start -->
<!-- d5-table:start -->
5 sentences changed (D5):

| Where | Before | After | Why |
| --- | --- | --- | --- |
| `apps/web/components/blog/ArticleLayout.tsx:113` | Crawlmouse crawls your site, maps every internal link, and gives you an A–F grade in under two minutes. Free, no install. | Crawlmouse crawls your site, maps every internal link, and grades what it finds. Free, no install. | An A–F internal-linking grade is v1’s result; v2 grades AI readability and Technical SEO, and gives its time as about two minutes. |
| `apps/web/lib/blog/content/screaming-frog-alternative.tsx:89` | get an A–F internal-linking grade and a 0–100 <a href="/ai-readiness-checker">AI-readiness score</a> for the whole site, with fixes | get grades for the whole site’s structure and for <a href="/ai-readiness-checker">how well AI crawlers can read it</a>, with fixes | The A–F internal-linking grade and the 0–100 AI-readiness score are v1’s; v2 grades AI readability and Technical SEO. |
| `apps/web/lib/blog/content/screaming-frog-alternative.tsx:109` | <strong>Price:</strong> free; Pro at $19/month for every fix, CSV export, and white-label reports. | <strong>Price:</strong> free; paid plans from $19/month. | In v2, white-label reports are on Agency, not Pro; Pro is still $19 a month in both builds. |
| `apps/web/lib/blog/content/free-internal-link-audit.tsx:98` | and returns a single A–F grade plus the specific problems | and returns a grade for its structure plus the specific problems | A single A–F internal-linking grade is v1’s result; v2 returns two grades. |
| `apps/web/lib/blog/content/sitebulb-alternative.tsx:161` | returns a single A–F grade plus the specific problems behind it | returns a grade for its structure plus the specific problems behind it | A single A–F internal-linking grade is v1’s result; v2 returns two grades. |
<!-- d5-table:end -->
<!-- prettier-ignore-end -->

**D6 — Keyword map, clusters and internal links.** See subagent A's section (below, completed at merge).

**D7 — Proof.** Lighthouse, the final D1 run and the §13 command set are recorded in the PR description.

## Questions and smaller options taken

Q1–Q8 in the step's notes (`questions.md`): the pinned-guard rewrite (Q1), attributed queries (Q2), the
$69 card (Q3), pages outside this step's paths reported as exceptions (Q4), author box only where an
author is set (Q5), existing Quick answers and FAQs kept (Q6), one inline source (Q7), the CTA heading kept (Q8).
