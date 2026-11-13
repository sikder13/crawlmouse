# SPEC 30 — Fix packets, before and after, and effort, written by the engine

> Generated from `packets/spec.ts`; `spec.test.ts` fails when this file differs from the render.
> Regenerate: `pnpm --filter @crawlmouse/engine exec tsx src/v2/packets/write-spec.ts`.
> Lists of names, numbers, sources, rules and the example packets are read from the code and the fixtures
> when the file is rendered. The decisions, the per-type notes, the open limits, the review record and the
> comparison are written in spec.ts and checked by review; a file or a test title they name is looked up at
> render, and a missing one throws. A path without a root is under `packages/engine/src/v2/`. Questions (Q1 to Q10) are in
> the step’s `questions.md`, the owner’s answers in `rulings.md`, `rulings-2.md` and `rulings-3.md`; §12 carries both.

## 1. What this step does

Before this step a fix carried `packet: null`, `effort: null` and `before_after: []`. The engine now writes the three when it opens a fix, from the fix’s own record and the check’s rows, with no model call. A packet says what is wrong with the evidence, the change to make, what to keep, a short command that prints the evidence (“See it”) and a strict command whose exit status says whether the fix has landed (“Exact check”). The rendered-page fix type `client_rendered_template` opens with it. The fix page, the prompt and the download show what the packet holds.

## 2. Decisions

- **D1. One builder per fix type behind one registry; a type with no entry does not compile.** `PACKETS` is a mapped type over `FixType`: an entry is a builder or a `NoPacket` with its reason (§3). `draft` (grade/outcomes.ts) calls the `WriteFix` it is handed, which `writtenFrom` builds over the registry. The same record and facts give the same packet, compared as JSON by a property test.
  - Where: `packets/registry.ts`, `packets/types.ts`, `packets/written.ts`, `grade/outcomes.ts`.
  - Held by: `packets/registry.test.ts`, `packets/compose.test.ts`, `packets/test-support/content.ts`, `build/build.test.ts`.
- **D2. A sentence that names measured data is rendered from the record.** A packet line is made by the tagged template `line`, whose values are made by `code`, `count`, `ours` or `list`; a plain string does not type-check and a value made elsewhere throws. A sampled finding states its sample in the context (§5).
  - Where: `packets/text.ts`, `packets/structure.ts`, `packets/content-rule.ts`.
  - Held by: `packets/text.test.ts`, `packets/edge-rule-blocks-crawler.test.ts`, `packets/client-rendered-template.test.ts`, `packets/content-rule.test.ts`.
- **D3. The verify block is a command that can fail.** A packet carries a readable command and a strict one (§4): “See it” prints the evidence, “Exact check” exits 0 once the fix has landed. The exact check of each type is run with `sh -c` against a local server in a broken and a fixed state. The cases where an exact check can pass before the fix are listed per type in §5 under the open limits; they await a fix or an owner exception.
  - Where: `packets/shell.ts`, `packets/html-checks.ts`, `packets/content-rule.ts`, `packets/test-support/verify.ts`.
  - Held by: `packets/test-support/verify.test.ts`, `packets/html-checks.test.ts`, `packets/content-fixture.test.ts`, `packets/live-proof.test.ts`.
- **D4. A stack body where the platform’s documentation supports its steps; `frameworks` lists bodies that exist.** A stack body carries `sources` (title, URL, read date, what it supports), rendered in §5. `compose` computes `frameworks` from the bodies written.
  - Where: `packets/compose.ts`, `packets/types.ts`.
  - Held by: `packets/compose.test.ts`, `packets/registry.test.ts`.
- **D5. The front end is detected.** Narrowed (Q2), then built in CC-32 D5: the worker records front-end markers, and `stackOf` sets `stack.frontend` from them (§8). The first body is chosen by `frameworkOf`: the detected front end, else the framework the CMS is.
  - Where: `packets/stack.ts`, `build/record.ts`.
  - Held by: `packets/stack.test.ts`, `packets/compose.test.ts`.
- **D6. The two rendered-page fix types open.** Narrowed, then completed in CC-32. `client_rendered_template` opens, from the render step’s own `state` per page (§6). `js_only_navigation` opens since CC-32 D6, from the links the render step reads on both sides of a page (§6); it has no packet (CC-32 Q7). A route that serves an empty root is an empty-root page since CC-32 D2, so its template gets a record (§6).
  - Where: `detectors/rendered.ts`, `detectors/js-only-navigation.ts`, `grade/effects.ts`, `grade/outcomes.ts`, `build/diff.ts`.
  - Held by: `detectors/rendered.test.ts`, `detectors/rendered-build.test.ts`, `grade/effects.rendered.test.ts`, `build/client-rendered.test.ts`, `detectors/js-only-navigation.test.ts`, `grade/effects.js-only.test.ts`, `build/js-nav-site.test.ts`.
- **D7. Before/after and effort from what was measured.** A rule per fix type for both, as data (§7). `after` comes from `servedAll`, `allPassing` and `SERVER_RENDERED_SHARE` of grade/effects.ts. Narrowed: no rule states `minutes`, because no record holds a measure of time; those fixes carry no effort.
  - Where: `packets/effort.ts`, `packets/before-after.ts`, `grade/effects.ts`.
  - Held by: `packets/effort.test.ts`, `packets/before-after.test.ts`, `packets/before-after.same-code.test.ts`.
- **D8. Crawled text inside a packet is hostile.** Crawled text enters a line through `code` and a command through `url` or `crawledWord` (§3). Lines, sections and a packet of several bodies are bounded, and a bound that withholds says so. The fix title is cleaned and bounded by `titleOf` (Q7). The cleaning function is in clean-text.ts (Q9).
  - Where: `clean-text.ts`, `packets/text.ts`, `packets/shell.ts`, `packets/compose.ts`, `grade/outcomes.ts`.
  - Held by: `packets/text.test.ts`, `packets/shell.test.ts`, `packets/compose.test.ts`, `packets/html-checks.test.ts`, `apps/web/lib/v2/view/segment/fixes.property.test.ts`.
- **D9. The web side shows what now exists.** The switch offers the bodies a packet holds; the packet route serves the chosen body; the fix page, the prompt and the download show “See it” above “Exact check”; a fix with no packet says the registry’s reason, or that its last check wrote no steps. Web files beyond the brief’s list were edited (Q6, Q9). Written up in `docs/specs/v2/24-fix-and-map.md`.
  - Where: `apps/web/lib/v2/view/fix.ts`, `apps/web/lib/v2/account/fixes.ts`, `apps/web/lib/v2/view/no-packet.ts`, `apps/web/lib/v2/view/packet-reason.ts`, `apps/web/lib/v2/view/segment/fixes.ts`, `pipeline-surface.ts`.
  - Held by: `apps/web/lib/v2/view/fix.test.ts`, `apps/web/app/api/fixes/[id]/packet/route.test.ts`, `apps/web/lib/v2/view/packet-reason.test.ts`, `apps/web/lib/v2/view/segment/fixes.test.ts`, `apps/web/__tests__/v2/fix.test.tsx`.
- **D10. Voice: a senior engineer’s ticket; the fixtures’ packets are the reference.** The engine’s packets for the lab fixture are compared with the hand-written ones in §9.
  - Where: `packets/spec.ts`, `apps/web/lib/fixtures/v2/bad-site.json`, `packages/engine/fixtures/v2/build/expected.json`.
  - Held by: `packets/spec.test.ts`.
- **D11. Out of this step: model-written text, further fix types, competitor data, sending the email, the unmark lifecycle.** Nothing.

## 3. How a packet is built

The registry (`packets/registry.ts`), one row per fix type of the contract:

| Fix type                     | Entry   | Bodies                                  |
| ---------------------------- | ------- | --------------------------------------- |
| `robots_txt_blocks_crawler`  | none    |                                         |
| `edge_rule_blocks_crawler`   | builder | `generic`                               |
| `client_rendered_template`   | builder | `generic`, `nextjs`, `shopify_hydrogen` |
| `orphan_pages`               | builder | `generic`                               |
| `quotable_opening`           | builder | `generic`                               |
| `generic_anchor_text`        | builder | `generic`                               |
| `deep_pages`                 | builder | `generic`                               |
| `specs_as_images`            | builder | `generic`                               |
| `missing_schema_description` | builder | `generic`, `nextjs`                     |
| `no_question_headings`       | builder | `generic`                               |
| `missing_author_date`        | builder | `generic`, `nextjs`, `wordpress`        |
| `js_only_navigation`         | none    |                                         |
| `redirect_chain`             | builder | `generic`                               |
| `duplicate_pagination`       | builder | `generic`                               |
| `canonical_mismatch`         | builder | `generic`, `nextjs`                     |
| `hreflang_gap`               | builder | `generic`, `nextjs`                     |

The reason each entry without a builder carries:

- `robots_txt_blocks_crawler`: robots.txt disallows the crawler, which is the site’s stated intent: the engine opens no fix for it.
- `js_only_navigation`: No packet yet: the audit finds these links by reading each sampled page before and after its JavaScript runs, and the steps to put them in the HTML are not written for any stack yet.

A builder (`packets/types.ts`) has these fields, functions of one record and the check’s `PacketFacts` (the homepage URL, the stack, the crawlers’ site verdicts, the pages, the links and the access tests):

- `context(fix, facts)`: what is wrong, with the evidence; shared by the bodies.
- `generic(fix, facts)`: the change and what to keep, on any stack.
- `stacks[framework]`: `write(fix, facts)`, the change on that stack, or null when it has none for this record; and `sources`, the documentation pages its steps rest on.
- `verify(fix, facts)`: the exact check, what to expect, the crawler requested as, and `see`, the readable command with what it prints today and after; shared by the bodies.

`compose` (`packets/compose.ts`) writes a body for a stack whose `write` returns a change, in the contract’s order (`nextjs`, `shopify_liquid`, `shopify_hydrogen`, `wordpress`, `webflow`), then `generic`. The first body is the one for `frameworkOf(facts.stack)` when the builder wrote it, else `generic`. `frameworks` is the first body’s framework followed by the others’.

Bounds, read from `PACKET_BOUNDS` (compose.ts), `COMMAND_BOUNDS` (`packets/html-checks.ts`) and the constants below:

- `PACKET_BOUNDS.line_chars` = 600. Code points in one line of a section, in `expect`, and in the readable layer’s `today` and `after`. A longer line is cut and says how long it was; a code span the cut left open is closed.
- `PACKET_BOUNDS.section_lines` = 12. Lines in a section. A longer section keeps its first lines up to the bound, and a last line counts the rest.
- `PACKET_BOUNDS.packet_chars` = 40000. Characters, as JSON, of a packet that holds more than one body. Past it the packet keeps the body for its own framework, and its context says how many rewrites were left out.
- `PACKET_BOUNDS.one_body_chars` = 64000. Not enforced by `compose`: a packet of one body is returned whatever its size. compose.test.ts builds the structure packets from URLs of the worker’s longest and from its largest records, and holds each under this number.
- `COMMAND_BOUNDS.url_chars` = 2048. The longest URL a structure command names: the worker’s `MAX_URL_LENGTH`. A declared canonical longer than this is not treated as a URL (`httpUrl`).
- `COMMAND_BOUNDS.listed_chars` = 8192. Characters of shell words in a list a command could do without (`listed`). The list stops there, and `expect` says how many it left out.
- `MAX_CRAWLED_CHARS` = 200. Code points of one crawled text in a line or a command word, unless the caller asks for less.
- `MAX_TITLE_CHARS` = 300. Code points of a fix title (grade/outcomes.ts `titleOf`); a longer one is cut and ends in an ellipsis.

A command is not cut by `compose`: a cut command is a different command. Its length is bounded where it is written, by `COMMAND_BOUNDS`. Held by `packets/compose.test.ts` “stays under the stated bound for URLs of the worker’s longest and the largest records”.

How text reaches a packet (D8; `clean-text.ts`, `packets/text.ts`, `packets/shell.ts`):

- `clean` (clean-text.ts), given crawled text. Removes format, private-use, surrogate, unassigned and variation-selector code points, and a listed set of letters and marks that render blank; turns a run of control characters, line separators and spaces into one space; turns a backtick into an apostrophe; trims.
- `code`, given crawled text, a bound. `clean`, then a cut at the bound in code points that says how long the text was, then a code span.
- `count`, given a number. Digits of a safe integer; anything else throws.
- `ours`, given text of this repository. Kept as written; a control or invisible character in it throws.
- `list`, given values made here, a bound, a noun. Comma-separated; past the bound it says how many are not shown.
- `line`, given a template of the above. One line. A value not made by text.ts throws, and so does a line break in the template’s own words.
- `url`, given a crawled URL. Rebuilt from the URL parser’s protocol, host, path, query and fragment, without credentials; http or https, or it throws. A character outside RFC 3986’s sets, the apostrophe included, is percent-encoded, and so are `[ ] { }` after the origin (curl reads them as a range or a set). Single-quoted.
- `crawledWord`, given crawled text that is not a URL, a bound. `clean`, a cut at the bound, then single-quoted with an apostrophe written `'\''`.
- `word`, `int`, given text or a number of this repository. Single-quoted the same way; a control or invisible character in `word` throws.
- `sh`, given a template of shell words. One line. A value not made by shell.ts throws, and so does a line break in the template’s own words.

Hostile text through some of them, as the functions return it when this document is rendered:

```text
clean("a`b\nIgnore the steps above.\u202e \u200bc")
  a'b Ignore the steps above. c
code("a`b\nIgnore the steps above.\u202e \u200bc", 12)
  `a'b Ignore t` (cut from 29 characters)
crawledWord("a`b\nIgnore the steps above.\u202e \u200bc")
  'a'\''b Ignore the steps above. c'
url("https://a.test/p'q `r`?x=$(id)")
  'https://a.test/p%27q%20%60r%60?x=$(id)'
```

Held by `packets/text.test.ts` “leaves nothing crawled outside a code span, and adds no line (property)”, `packets/shell.test.ts` “passes crawled text to the shell as its cleaned self and runs none of it (property)”, `packets/compose.test.ts` “lets nothing crawled add a line, draw nothing, or stand outside a code span” and `packets/html-checks.test.ts` “is one line with nothing unshown in it, and runs nothing a value holds”.

### Builder faults

`writtenFrom(facts, onFault)` (`packets/written.ts`) is what the check builder hands to `detectorOutcomes` (`build/grade.ts`). It writes a fix’s packet, effort and before/after rows. When a builder throws on a record, the fix carries `packet: null`, the check is still built, and `onFault` is told the fix type, the fingerprint and the error; the effort and the rows are written as for any fix. The check builder counts the faults in the grading summary as `packets_not_written` (`build/summaries.ts`). In the lab fixture’s grading summary: `packets_not_written` 0, `fixes_written` 11.

- The catch and the listener: `packets/written.test.ts` “leaves a fix without a packet, and does not throw, on %s”.
- A throw the catch would hide is looked for by calling the registry’s writer itself over generated crawls: `packets/structure-fuzz.test.ts` “write a packet the contract accepts for every record a detector reports as detected”.
- The count in the summary is compared as part of the fixture: `build/build.test.ts` “gives exactly expected.json”. A builder made to throw, through the whole check builder: `build/packet-faults.test.ts` “counts the faults in the grading summary”.
- The fix page says of such a fix that its last check wrote no steps: `apps/web/lib/v2/view/packet-reason.test.ts` “says the last check wrote no steps when the type has a builder, and promises no later ones”.

### Why the grade code does not import the builders

`detectorOutcomes` (grade/outcomes.ts) takes the writer as an argument (`WriteFix`). The reason is the grade-change guard (`grade/grade-guard.test.ts`), which digests the files the grade code imports at run time: a change to a packet’s wording then leaves the digest alone. Of `packets/`, `gradeSources()` lists: none. It lists `v2/clean-text.ts`: yes (the fix titles are cleaned by it).

## 4. The verify block

### “See it” above “Exact check” (owner ruling 1)

- **See it** (`verify.see`): a short command a developer reads in ten seconds. It prints the evidence. `today` says what it prints now, from the record; `after` says what it prints once the fix has landed. Its exit status proves nothing.
- **Exact check** (`verify.command`): one line for a POSIX shell that starts with `curl` and exits 0 once the fix has landed. `expect` says what the exit status means and what the command reads. It is the command the tests run in both states.

Both are made by `sh` from quoted words (§3), and `today`, `after` and `expect` are lines held to `PACKET_BOUNDS.line_chars`. The builder type requires the layer (`Verify.see` in types.ts), so a builder without one fails `pnpm --filter @crawlmouse/engine exec tsc --noEmit -p .`. In the lab fixture 11 of 11 packets carry it; in the hand-written fixture 0 of 14.

### The contract change: OWNER-APPROVED NON-ADDITIVE CHANGE to `packages/types`

`PacketBodySchema.verify` (`packages/types/src/v2/fix.ts`) gained a required, nullable key: `see: { command, today, after } | null`. It is not additive: a packet without the key no longer parses. The owner approved it on Q8 (2026-11-12, `rulings-2.md`), for the reasons the ruling gives: the contract forbids optional keys (`packages/types/src/v2/contract.test.ts` “no field anywhere in the contract is optional”); `site_fixes.packet` is `jsonb`, so no migration is needed; and, in the ruling’s words, “every packet stored so far is `null`” (`draft()` wrote `packet: null` before this step).

- Commit `23781149`: the contract (`packages/types/src/v2/fix.ts`).
- Commit `1635efcb`: the hand-written fixtures gain `"see": null`, and `docs/specs/v2/11-type-contract.md` is regenerated.
- No migration.

### The two-state harness

`packets/test-support/verify.ts`: `twoStateSite` serves a broken and a fixed state on a local port, `runCommand` runs a command as written with `sh -c` and a time limit, and `inBothStates` returns the two results. A command whose site is not there fails: `packets/test-support/verify.test.ts` “fails a command whose site is not there, rather than passing it”. The test that runs each type’s exact check in both states is named under the type in §5; this document throws at render when a builder’s test file runs no command.

### The crawler requested as

`verifyCrawler(facts, fixed)` (`packets/crawler.ts`) gives the crawler a command requests as: the crawler the fix itself lets in when `fixed` names a testable one, else the first testable crawler, in registry order, whose site verdict is `allowed` or `allowed_thin`; null when there is none, and the command then sends no `-A` and `ua` is null. `userAgentOf` gives the header: the operator’s published string, or the token where the operator prints none.

| Token              | Group           | Testable | Published user-agent string |
| ------------------ | --------------- | -------- | --------------------------- |
| `Googlebot`        | `search_engine` | no       | yes                         |
| `Bingbot`          | `search_engine` | no       | yes                         |
| `OAI-SearchBot`    | `ai_search`     | yes      | yes                         |
| `ChatGPT-User`     | `ai_search`     | yes      | yes                         |
| `PerplexityBot`    | `ai_search`     | yes      | yes                         |
| `Claude-SearchBot` | `ai_search`     | yes      | no                          |
| `GPTBot`           | `ai_training`   | yes      | yes                         |
| `ClaudeBot`        | `ai_training`   | yes      | no                          |

The header a command sends, for each testable crawler:

- `OAI-SearchBot`: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot`
- `ChatGPT-User`: `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot`
- `PerplexityBot`: `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)`
- `Claude-SearchBot`: `Claude-SearchBot`
- `GPTBot`: `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot`
- `ClaudeBot`: `ClaudeBot`

### The address a command requests: `servedAt` and `readAt`

The engine names a page by its canonical spelling, which drops a trailing slash; a site that redirects that spelling answers a request for it with a redirect, and a command follows none. `packets/served-at.ts`:

- `servedAt(facts, url)`: the address a page is **named** at in a line. The row’s `final_url` when it is the same page (it canonicalises to the page’s URL) and carries no credentials; else the page’s URL.
- `readAt(facts, url)`: the address a command **requests** to read a page. Where the request for the page ended, when that answered 200 at an address of the page’s own site (`sameSite`: the page’s scheme or https, no credentials, the page’s host give or take a leading `www.`, the page’s port); else `servedAt`. A homepage that answers at `/en/` is requested there.

Held by `packets/served-at.test.ts` “is the slashed address when the server redirects the page to it” and `packets/served-at.test.ts` “is where the request ended, when that answered 200: a homepage that redirects to /en/”.

### The structure reader

The structure exact checks (`packets/html-checks.ts`) are one `curl -sS -f --compressed` of each page with `-w` writing `crawlmouse:end` and the address requested after each response, `tr` making the response one line, and one `awk` program under `LC_ALL=C` (`holds`). A command that asks two things asks them in one program. The lists below are read out of a command built when this document is rendered; the rest is written here from the awk source and held by `packets/html-checks.test.ts`.

- **What it strips.** Comments and markup declarations, and the bodies of `script`, `style`, `template`, `textarea`, `title` elements (`scan`). A `>` inside a quoted attribute value does not end its tag. A tag whose quotes do not close within a few `<` stops the reading, and the command exits non-zero (`odd`).
- **What it will not read.** An href or a link text longer than 8192 bytes (`CAP`), a query of more than 256 parameters (`MAX_PARAMS`), and a tag of more than 128 attributes (`MAX_ATTRS`): the program does not read them, and where a stale link is asked about it takes what it cannot read for the old link, so the command exits non-zero. `curl` writes a line after each page, with its status and address; the program takes a page whose status is 200, counts the lines against the pages requested, and exits non-zero when they differ, as they do when a page prints that line itself. Content between `<noscript>` tags does not end the head. The request ends after 20 seconds (`--max-time`).
- **Attributes.** The first attribute of a name counts, in double quotes, in single quotes or unquoted (`attrs`).
- **What it decodes.** Numeric character references, and these named ones: `&Tab;`, `&NewLine;`, `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`, `&nbsp;`, `&hellip;`, `&rarr;`, `&larr;`, `&raquo;`, `&laquo;`, `&mdash;`, `&ndash;`, `&rsquo;`, `&lsquo;`, `&rdquo;`, `&ldquo;`, `&copy;`, `&reg;`, `&trade;`, `&middot;`, `&bull;`, `&times;` (`ent`). Another named reference is left as written and flagged (`unk`); `linksTo` then counts the href as the old link when it was asked about one.
- **What it keeps escaped.** Percent-escapes are decoded for comparison, except `%00` (NUL), `%23` (`#`), `%25` (`%`), `%26` (`&`), `%2B` (`+`), `%2F` (`/`), `%3D` (`=`), `%3F` (`?`), which stay escaped, in upper case (`dec`).
- **How it resolves a URL.** As a browser does (`res`): against the address requested, or the page’s first `<base href>`; document-relative, root-relative, protocol-relative and absolute; a backslash before the query as a slash; dot segments removed; scheme and host in lower case; a default port dropped; the fragment dropped.
- **How it compares two URLs.** By `norm`: empty path segments and the slash that ends a path dropped; the query’s parameters sorted, an empty query none and `a` read as `a=`; escapes as above. `sameInCommand` is the same rule in TypeScript, which a builder asks before it writes a command that must tell two URLs apart.
- **Where the head ends.** At the first tag that is not one of `html`, `head`, `base`, `link`, `meta`, or at text (`hd`). A canonical or an hreflang `<link>` after that is not read.
- **What it does not read.** An HTTP `Link` header; a sitemap; markup a script adds; a host written in Unicode is not converted to its ASCII form.

What `sameInCommand` answers for pairs of URLs, computed when this document is rendered (held to the awk programs by `packets/html-checks.test.ts` “compares as the awk programs do (property)”):

- `https://a.test/p` and `https://a.test/p/`: one URL
- `https://a.test/café` and `https://a.test/caf%C3%A9`: one URL
- `https://a.test/l?b=2&a=1` and `https://a.test/l?a=1&b=2`: one URL
- `https://a.test/l?a` and `https://a.test/l?a=`: one URL
- `https://a.test/x~y` and `https://a.test/x%7Ey`: one URL
- `https://a.test/a/b` and `https://a.test/a%2Fb`: two URLs
- `https://a.test/a?b` and `https://a.test/a%3Fb`: two URLs
- `https://a.test/p` and `https://www.a.test/p`: two URLs

The structure “See it” commands (`packets/structure.ts` `seeTags`) request the same address as the same crawler (`printOf` in `packets/html-checks.ts`), put the page on one line, and print the matches of one of these patterns with `grep -io` (`TAGS`):

- `a`: `<a [^>]*>`
- `aWithText`: `<a [^>]*>[^<]*</a>`
- `canonical`: `<link [^>]*rel=.?canonical[^>]*>`
- `hreflang`: `<link [^>]*hreflang[^>]*>`

### The content and rendered commands

The content exact checks (`packets/content-rule.ts` `tagProbe`) request the first failing page with `curl -sSf --compressed`, at `readAt`, turn line breaks into spaces and a `<` into a line break, so a line starts with a tag’s name, and hand the lines to an `awk` program of ours per type. The content “See it” commands (`seeMarkup`) put the same response on one line and print each match of a pattern of ours with `grep -aioE`. The `client_rendered_template` commands are described under the type.

Sentences several packets carry, read from the constants:

- `CHROME_GAP` (content-rule.ts): “The command sets aside `nav, footer, aside, form` elements as the check does, but not `[role="navigation"], [aria-hidden="true"]`.”
- `RECHECK` (content-rule.ts): “An error status does not pass. The audit's next check applies the full rule to every page of the template.”
- `UNREAD_HREF` (structure.ts): “An href the command cannot read counts as the old link.”
- `CRAWLABLE_LINK` (structure.ts): “Write the link as an <a> element with an href, in the HTML the server sends. A link that only JavaScript adds is not there for a crawler that does not run scripts.”

Google’s pages the structure packets print (`GOOGLE_DOCS`, structure.ts), and the builders whose source names each:

- `links`: https://developers.google.com/search/docs/crawling-indexing/links-crawlable. Named by: no builder.
- `canonical`: https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls. Named by: `canonical_mismatch`.
- `pagination`: https://developers.google.com/search/docs/specialty/ecommerce/pagination-and-incremental-page-loading. Named by: `duplicate_pagination`.
- `hreflang`: https://developers.google.com/search/docs/specialty/international/localized-versions. Named by: `hreflang_gap`.

What a content packet’s first context line says each check looks for, read by building that line for each check of the contract:

- `direct_answer_150`: a quotable opening sentence
- `question_headings`: a heading phrased as a question
- `schema_with_description`: structured data with a description
- `author_and_date`: an author and a publication date in markup
- `specs_as_text`: specifications as text

How the edge packet says each access cause, read by building its context for a record that names the cause:

- `cloudflare_1020`: Cloudflare’s error 1020
- `bot_fight_mode`: a Bot Fight Mode challenge
- `client_rendered_template`: a template whose text is added in the browser
- `robots_txt_disallow`: a Disallow rule in robots.txt
- `automation_challenge`: a challenge the edge serves to automated requests of any user agent
- `rate_limit_429`: a rate limit (status 429)
- `pay_per_crawl_402`: a request for payment to crawl (status 402)
- `cross_host_redirect`: a redirect to another host
- `verified_bot_only`: a rule that admits the crawler only from its verified addresses

## 5. Per fix type

In the registry’s order. “Lab fixture” is `packages/engine/fixtures/v2/build/expected.json`, whose `check.stack` is `{"frontend":null,"backend":null,"edge":null}`. An example is the stored packet, each string on a line of its own, with the exact check whole.

Content checks that count in a grade today (`CONTENT_CHECKS[check].scored`): none. A content packet’s context ends with the line that says so.

The content packets (`quotable_opening`, `no_question_headings`, `missing_schema_description`, `missing_author_date`, `specs_as_images`) open with the same context (`contentContext`): the check in words, the failing pages of the pages decided, the rule, the pages not read when there are any, the first 3 failing pages at the address each is served at (a URL is cut at 120 code points, a template key at 80) with the rest counted, and whether the check counts in a grade. Under a content type, “Rule” gives the rule its context states.

Open limits that several types share. Under a type, “Shared” names the ones that apply to it. Each is one entry of `SHARED_LIMITS` in spec.ts, and a type’s own are in `OPEN_LIMITS`: when one is closed, delete it and regenerate.

- **redirect body.** The exact check follows no redirect, and `curl -f` fails at a status of 400 or more, so the body of a 3xx answer is read: a redirect whose body holds the markup passes (round 3, note 4; confirmed with curl for this document). The structure checks do not share this: their program reads the status curl writes after each page and takes only a 200. Types: `client_rendered_template`, `quotable_opening`, `specs_as_images`, `missing_schema_description`, `no_question_headings`, `missing_author_date`.
- **path-end “See it”.** Where the readable command prints the `<a>` tags that hold a page’s path, it matches the end of the path: a link to another page whose path ends the same way (`/blog/deep` for `/deep`), or to that path on another host, is printed too, on a page where `today` says nothing is; and a link written without quotes is not printed. The exact check reads neither wrongly (re-review after round 3, S4). Types: `orphan_pages`, `deep_pages`, `redirect_chain`, `canonical_mismatch`.

### `robots_txt_blocks_crawler`

Registry reason: robots.txt disallows the crawler, which is the site’s stated intent: the engine opens no fix for it.

Lab fixture: no fix of this type.

### `edge_rule_blocks_crawler`

**Rule.** Context, from the access record and the worker rows it names (`evidence.access_test_ids`): the crawler; the pages refused of the sampled pages it was judged on (`extent`); a tally of the rows’ `raw_status`; the causes the record names, each in words (§4), or a line saying the responses name no product; the response headers recorded (`evidence.signatures`); the identities served on the same pages (`witness.ua`); that the audit’s request carried a Crawlmouse tag, when the rows say so; the pages refused, 5 shown and the rest counted. Change: the first step asks whether the crawler should be let in and gives the registry’s `purpose` for it. The steps that follow name no product unless `facts.stack.edge.vendor` is `Cloudflare`. Then: for a record whose causes include `cloudflare_1020`, the steps Cloudflare’s page for that error supports; for another record, the places in the dashboard to look, with the pages below.

**Exact check.** Requests the first affected page (sorted), at the address its content was read at, with the blocked crawler’s user agent, and writes the response headers to an awk program. Exits 0 when the last status line says 200 and no challenge header follows it. The challenge headers are the worker’s (`MITIGATION`): `cf-mitigated` holding `challenge`, `x-vercel-mitigated` holding `challenge`. The builder throws for a crawler the registry cannot request as, and for a record with no affected page.

**See it.** The same request, printing the status alone. `today` is the status of the audit’s own request for that page when its row holds one; `after` is `200`.

Run in two states by `packets/edge-rule-blocks-crawler.test.ts`.

Limits the packet states:

- A redirect is not followed and does not pass (`expect`).
- The command reads the status and the challenge headers, not the body: a block page served with status 200 and none of those headers passes (`expect`).
- The audit’s request was tagged and came from Crawlmouse’s address; what the operator’s own crawler gets is in the site’s logs (context, when the rows are tagged).

Open limits:

- A 200 that carries a block or challenge page passes unless it has one of the mitigation headers the check reads. `expect` says so.

Not said, because not measured:

- Which product holds the rule, unless the check recorded Cloudflare.
- What the operator’s own crawler is served.
- Whether the owner wants the crawler let in.

Documentation cited:

- `generic`, the Cloudflare steps:
  - [Error 1020](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1020/), read 2026-11-12. Supports: error 1020 is returned when a security rule with a Block action and no custom response matched; API Shield schema validation and JWT validation are its examples; requests blocked by WAF custom rules or WAF managed rules do not get it; the Security Events log (Security > Analytics, Events tab) shows which security feature and rule blocked the request.
  - [Custom rules](https://developers.cloudflare.com/waf/custom-rules/), read 2026-11-12. Supports: custom rules are evaluated in order and a Block stops the evaluation.
  - [Create a custom rule in the dashboard](https://developers.cloudflare.com/waf/custom-rules/create-dashboard/), read 2026-11-12. Supports: custom rules are on the Security rules page.
  - [Manage AI crawlers](https://developers.cloudflare.com/ai-crawl-control/features/manage-ai-crawlers/), read 2026-11-12. Supports: AI Crawl Control: Allow or Block per crawler, in the Actions column of its row; a Block is enforced by a WAF custom rule the system creates or updates on the zone.
  - [AI Crawler and Agent access policies](https://developers.cloudflare.com/bots/additional-configurations/block-ai-bots/), read 2026-11-12. Supports: Security > Settings, filter by Bot traffic, AI Crawler and Agent access policies: an action per behaviour (Search, Agent, Training); Block applies to matching requests across the zone.
  - [Bot Fight Mode](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/), read 2026-11-12. Supports: Bot Fight Mode issues challenges, labelled Bot Fight Mode in the Service field of a security event; it cannot be bypassed or skipped with WAF custom rules or Page Rules; Super Bot Fight Mode supports Skip rules.

Fixes of this type in the lab fixture: 1. The first, as stored:

```text
title: Let ClaudeBot through the user-agent rule
frameworks: generic
effort: none
before_after: {"measure":"crawlers_reading_text","today":4,"after":5,"after_bound":"approx","after_is_estimate":true}
context:
  `ClaudeBot` was refused on 50 of the 50 sampled pages the audit judged it on, by a rule that matches its user agent.
  Status of the refused requests: 403 (50 requests).
  The responses name no product: the audit did not identify what holds the rule.
  On 50 of those pages another identity was served from the same address (`OAI-SearchBot`), so the refusal is aimed at the user agent.
  The audit sent this user agent with a Crawlmouse tag, from Crawlmouse’s address. What the operator’s own crawler gets is in the site’s logs.
  Pages refused: `https://built-site.test`, `https://built-site.test/blog/camp-cooking-ideas`, `https://built-site.test/blog/campfire-safety-basics`, `https://built-site.test/blog/choosing-tent-pegs`, `https://built-site.test/blog/coming-soon-note` and 45 more pages not shown.
change (generic):
  Decide first whether `ClaudeBot` should be let in. What it is for: Collects pages for Anthropic model training. The audit records what was refused, not what the site intends, and a block can be deliberate: the choice is the site owner's. The steps below apply if it should be served.
  Find the rule that refuses requests whose User-Agent header contains `ClaudeBot`. It can be in the CDN or WAF, a bot-management product, the web server's configuration or the application's middleware.
  Remove `ClaudeBot` from what the rule matches, or add an exception that serves it.
  Deploy the rule change, then run the check below.
keep (generic):
  Leave the rule's other clauses as they are: change only what matches `ClaudeBot`.
  Keep robots.txt as the place that states which crawlers may read the site. This change does not edit it.
  Serve `ClaudeBot` the same page a visitor gets, not a version made for crawlers.
See it:
  curl -sS -o /dev/null -w '%{http_code}\n' -A 'ClaudeBot' 'https://built-site.test/'
  today: `403`: the status the audit’s request for this page as `ClaudeBot` was answered with.
  after: `200`. The exact check below also requires that no challenge header comes with it.
Exact check (ua: ClaudeBot):
  curl -sS -o /dev/null -D - -A 'ClaudeBot' 'https://built-site.test/' | awk '/^HTTP\//{ok=($2==200)}tolower($0)~/^cf-mitigated:.*challenge/{ok=0}tolower($0)~/^x-vercel-mitigated:.*challenge/{ok=0}END{exit !ok}'
  expect: Exits 0 when the page answers status 200 to this user agent with no challenge header (`cf-mitigated`, `x-vercel-mitigated`), and prints nothing. A redirect is not followed and does not pass. The command reads the status and those headers, not the body: a block page served with status 200 and none of those headers passes. The audit's request for it was answered 403.
```

### `client_rendered_template`

**Rule.** Context, from the record: the template key; the pages rendered of the pages graded; for the first 3 rendered pages (by URL), the words in the HTML response and the words once rendered, the rest counted; the median share; the sample (“Measured by rendering N pages. The other M graded pages of the template were not rendered”); the scope (the audit renders pages it grades, so another template can have the fault unmeasured); and a last line when no tested crawler is served. The generic change: find what adds the content, render it on the server or at build time, deploy. The packet names no mechanism: the record holds word counts.

**Exact check.** Requests the record’s first rendered page (by URL), at the address its content was read at, and counts the words of the HTML response outside `script`, `style`, `noscript`, `template`, `svg`, `title`, `nav`, `footer`, `aside` elements and outside comments. It prints the count and exits 0 when the count reaches `wordsNeeded`: 80% (`READABLE_FROM`) of that page’s rendered words, rounded up.

**See it.** The same response with its tags removed (`sed`), counted by `wc -w`. `today` and `after` give the audit’s two counts for the page and say the rough count is usually higher.

Run in two states by `packets/client-rendered-template.test.ts`.

Limits the packet states:

- An error status does not pass (`expect`).
- The count differs a little from the audit’s, and a page with that much text outside its main content passes unfixed (`expect`).
- The audit’s next check closes the fix sooner than the command passes: once each rendered page has more than 45% (`EMPTY_SHELL_LEAVES_ABOVE`) of its rendered words in the HTML response (`expect`).

Open limits:

- The exact check’s word count takes the text outside the skipped elements, wherever it is on the page: a page with that much static text outside its main content passes unfixed. `expect` says so.
- The readable command’s count is rough: it keeps menus, headers and footers, and the text after a `<` inside a script’s code. `today` says so and points at the exact check’s count.
- Shared, from the list above: **redirect body**.

Not said, because not measured:

- What adds the words in the browser: the front end is not detected (Q2).
- The words of the pages that were not rendered.
- Which crawlers run JavaScript.

Documentation cited:

- `nextjs`:
  - [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components), read 2026-11-12. Supports: App Router: pages are Server Components by default, fetch data on the server and pass it to Client Components as props; Client Components are for browser-only APIs such as window.
  - [Fetching Data](https://nextjs.org/docs/app/getting-started/fetching-data), read 2026-11-12. Supports: App Router: an async Server Component awaits its data; Client Components fetch with the use API or a library such as SWR or React Query.
  - [generateStaticParams](https://nextjs.org/docs/app/api-reference/functions/generate-static-params), read 2026-11-12. Supports: App Router: statically generate the routes of a dynamic segment at build time.
  - [getStaticProps](https://nextjs.org/docs/pages/building-your-application/data-fetching/get-static-props), read 2026-11-12. Supports: Pages Router: prerender the page at build time from the props it returns.
  - [getServerSideProps](https://nextjs.org/docs/pages/building-your-application/data-fetching/get-server-side-props), read 2026-11-12. Supports: Pages Router: fetch data at request time and render the initial HTML from it.
  - [How to lazy load Client Components and libraries](https://nextjs.org/docs/app/guides/lazy-loading), read 2026-11-12. Supports: next/dynamic with ssr: false disables prerendering for a Client Component; the option works in Client Components only.
- `shopify_hydrogen`:
  - [Fetch Shopify API data in Hydrogen](https://shopify.dev/docs/storefronts/headless/hydrogen/data-fetching), read 2026-11-12. Supports: a route loader queries the Storefront API (context.storefront.query) on the server; the component reads it with useLoaderData.

Lab fixture: no fix of this type.

### `orphan_pages`

**Rule.** Context: how many other crawled pages answered 200, none of which links to the page. Change: one link on `suggested_parent_url`, with how the audit ranks its suggestion and how many clicks that parent is from the homepage (`depthLine`: whether the link also settles the depth); with no suggested parent the step says so and names no page. The page’s title is offered as a starting point for the link text when the crawl read one.

**Exact check.** Requests the suggested parent, or the homepage when there is none, and passes when one of its `<a>` elements links to the orphan: its URL, or an address the crawl files under it (`addressesOf`).

**See it.** The `<a>` tags of that page that hold the orphan’s path. `today`: nothing. `after`: the tag that was added.

Run in two states by `packets/by-type/orphan-pages.test.ts`.

Limits the packet states:

- With no suggested parent the command requests the homepage, and the reader is told to put the page they linked from in its place (`expect`).
- A link that spells the path another way is not printed by the readable command; the exact check reads it (`after`).

Open limits:

- Shared, from the list above: **path-end “See it”**.

Not said, because not measured:

- That no link exists anywhere: the claim is about crawled pages that answered 200.
- Why the audit suggests no parent, when it suggests none.

Documentation cited: none.

Fixes of this type in the lab fixture: 1. The first, as stored:

```text
title: Link to https://built-site.test/products/forgotten-lantern from another page
frameworks: generic
effort: none
before_after: none
context:
  `https://built-site.test/products/forgotten-lantern` has no link from another page: the crawl read 58 other pages that answered 200, and none links to it.
change (generic):
  Add a link to `https://built-site.test/products/forgotten-lantern` on `https://built-site.test/products/camp-kitchen-item-1`. The audit ranks the content pages on this host that do not link here yet by the words their title, link texts and URL path share with this page's, and suggests the first; on a tie, the lower URL.
  `https://built-site.test/products/camp-kitchen-item-1` is 2 clicks from the homepage, so this link also puts the page within 3.
  Write the link as an <a> element with an href, in the HTML the server sends. A link that only JavaScript adds is not there for a crawler that does not run scripts.
  Give it link text that names the page. Its title, as a starting point: `forgotten lantern`.
keep (generic):
  Keep the page at `https://built-site.test/products/forgotten-lantern`: the fix is a link to it, not a move or a redirect.
See it:
  curl -sS --compressed --max-time 20 -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot' 'https://built-site.test/products/camp-kitchen-item-1' | tr '\r\n\t' '   ' | grep -aioE '<a [^>]*>' | grep -F -e '/products/forgotten-lantern"' -e '/products/forgotten-lantern'\''' -e '/products/forgotten-lantern?' -e '/products/forgotten-lantern#' -e '/products/forgotten-lantern/"' -e '/products/forgotten-lantern/'\''' -e '/products/forgotten-lantern>'
  today: Nothing: the crawl found no link to `https://built-site.test/products/forgotten-lantern` on any page.
  after: The <a> tag you added: a line that holds `/products/forgotten-lantern`. A link that spells the path another way is not printed; the exact check reads it.
Exact check (ua: OAI-SearchBot):
  curl -sS -f --compressed --max-time 20 -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot' -w '\ncrawlmouse:end %{http_code} %{url_effective}\n' 'https://built-site.test/products/camp-kitchen-item-1' | tr '\n\t\r\f\000' '\001\001\001  ' | LC_ALL=C awk 'function hexv(h, i, n) { n = 0; h = tolower(h); sub(/^0+/, "", h); if (length(h) > 6) return 0; for (i = 1; i <= length(h); i++) n = n * 16 + index("0123456789abcdef", substr(h, i, 1)) - 1; return n } function chr(n) { if (n < 1 || n > 1114111) n = 65533; if (n < 128) return sprintf("%c", n); if (n < 2048) return sprintf("%c%c", 192 + int(n / 64), 128 + n % 64); if (n < 65536) return sprintf("%c%c%c", 224 + int(n / 4096), 128 + int(n / 64) % 64, 128 + n % 64); return sprintf("%c%c%c%c", 240 + int(n / 262144), 128 + int(n / 4096) % 64, 128 + int(n / 64) % 64, 128 + n % 64) } function ent(v, o, r, e) { if (index(v, "&") == 0) return v; e = " Tab=9 NewLine=10 amp=38 lt=60 gt=62 quot=34 apos=39 nbsp=160 hellip=8230 rarr=8594 larr=8592 raquo=187 laquo=171 mdash=8212 ndash=8211 rsquo=8217 lsquo=8216 rdquo=8221 ldquo=8220 copy=169 reg=174 trade=8482 middot=183 bull=8226 times=215 "; o = ""; while (match(v, /&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[a-zA-Z][a-zA-Z0-9]*;)/)) { r = substr(v, RSTART + 1, RLENGTH - 1); sub(/;$/, "", r); o = o substr(v, 1, RSTART - 1); v = substr(v, RSTART + RLENGTH); if (r ~ /^#[xX]/) o = o chr(hexv(substr(r, 3))); else if (r ~ /^#/) { sub(/^#0*/, "", r); o = o chr(length(r) > 7 ? 0 : r + 0) } else if (match(e, " " r "=[0-9]+ ")) o = o chr(substr(e, RSTART + length(r) + 2, RLENGTH - length(r) - 3) + 0); else { unk = 1; o = o "&" r ";" } } return o v } function tend(t, p, r, q, i, k) { p = 0; while (match(t, /=[ \001]*["\047]|>/)) { if (substr(t, RSTART, 1) == ">") return p + RSTART; if (k++ >= 128) { far = 1; return 0 } q = substr(t, RSTART + RLENGTH - 1, 1); r = substr(t, RSTART + RLENGTH); i = index(r, q); if (!i) return 0; p += RSTART + RLENGTH - 1 + i; t = substr(r, i + 1) } return 0 } function add(t) { if (length(X[N]) < 8192) X[N] = X[N] t; else if (t ~ /[^ \001]/) V[N] = 1 } function scan(s, c, m, i, b, e, j, k) { N = 0; split("", V); m = split(s, c, "<"); X[0] = c[1]; for (i = 2; i <= m; i++) { b = c[i]; if (substr(b, 1, 3) == "!--") { b = substr(b, 4); if (b ~ /^-?>/) { add(substr(b, index(b, ">") + 1)); continue } e = index(b, "-->"); while (!e && i < m) { b = c[++i]; e = index(b, "-->") } if (e) add(substr(b, e + 3)); continue } if (b !~ /^[a-zA-Z\/!?]/) { add("<" b); continue } if (b ~ /^[!?]|^\/[^a-zA-Z]/) { e = index(b, ">"); while (!e && i < m) { b = c[++i]; e = index(b, ">") } if (e) add(substr(b, e + 1)); continue } j = 0; far = 0; while (!(e = tend(b)) && !far && i < m && j++ < 8) b = b "<" c[++i]; if (!e) { odd = far || i < m; break } if (match(tolower(substr(b, 1, 9)), /^(script|style|template|textarea|title)[ \001\/>]/)) { k = "/" substr(b, 1, RLENGTH - 1); e = 0; while (!e && i < m) { b = c[++i]; if (tolower(substr(b, 1, length(k))) == tolower(k) && substr(b, length(k) + 1, 1) ~ /^[ \001\/>]?$/) e = index(b, ">") } if (e) add(substr(b, e + 1)); continue } T[++N] = "<" substr(b, 1, e); X[N] = substr(b, e + 1) } } function attrs(t, a, k, v, q, i, n) { split("", a); sub(/^<[^ \001\/>]*/, "", t); while (1) { sub(/^[ \001\/]+/, "", t); if (t == "" || substr(t, 1, 1) == ">") return; if (n++ >= 128) { odd = 1; return } match(t, /^.[^ \001=\/>]*/); k = tolower(substr(t, 1, RLENGTH)); t = substr(t, RLENGTH + 1); sub(/^[ \001]+/, "", t); v = ""; if (substr(t, 1, 1) == "=") { t = substr(t, 2); sub(/^[ \001]+/, "", t); q = substr(t, 1, 1); if (q == "\"" || q == "\047") { t = substr(t, 2); i = index(t, q); v = i ? substr(t, 1, i - 1) : t; t = i ? substr(t, i + 1) : "" } else { match(t, /^[^ \001>]*/); v = substr(t, 1, RLENGTH); t = substr(t, RLENGTH + 1) } } if (!(k in a)) a[k] = v } } function dec(u, o, h) { if (index(u, "%") == 0) return u; o = ""; while (match(u, /%[0-9A-Fa-f][0-9A-Fa-f]/)) { h = toupper(substr(u, RSTART + 1, 2)); o = o substr(u, 1, RSTART - 1) (h ~ /^(00|23|25|26|2B|2F|3D|3F)$/ ? "%" h : sprintf("%c", hexv(h))); u = substr(u, RSTART + 3) } return o u } function res(u, q, i, h, n, g, k, st, t, hq, sc) { sub(/#.*/, "", u); gsub(/^ +| +$/, "", u); i = index(u, "?"); hq = i > 0; q = i ? substr(u, i) : ""; if (i) u = substr(u, 1, i - 1); sc = bs; if (match(u, /^[a-zA-Z][a-zA-Z0-9+.-]*:/)) { sc = tolower(substr(u, 1, RLENGTH - 1)); t = substr(u, RLENGTH + 1); if (sc != "http" && sc != "https") { RX = sc ":" t q; return 0 } gsub(/\\/, "/", t); if (sc == bs && t !~ /^\/\//) u = t; else { sub(/^\/*/, "", t); u = "//" t } } else gsub(/\\/, "/", u); if (u ~ /^\/\//) { sub(/^\/+/, "", u); i = index(u, "/"); h = i ? substr(u, 1, i - 1) : u; u = i ? substr(u, i) : "/"; sub(/^.*@/, "", h); h = tolower(h); if (sc == "http") sub(/:0*80$/, "", h); else sub(/:0*443$/, "", h); sub(/:$/, "", h); if (h == "" || sc == "") { RX = "!"; return 0 } RO = sc "://" h } else { if (bo == "") { RX = "!"; return 0 } RO = bo; if (u == "") { u = bp; if (!hq) q = bq } else if (u !~ /^\//) u = bd u } n = split(u, g, "/"); k = 0; RT = 0; for (i = 2; i <= n; i++) { t = tolower(g[i]); gsub(/%2e/, ".", t); RT = 1; if (t == "..") { if (k) k-- } else if (t != ".") { st[++k] = g[i]; RT = g[i] == "" } } RP = ""; for (i = 1; i <= k; i++) if (st[i] != "") RP = RP "/" st[i]; RQ = q; return 1 } function setb(u) { if (!res(u)) return; bo = RO; bs = RO; sub(/:.*/, "", bs); bp = RP; bq = RQ; bd = RP; if (RT) bd = bd "/"; else sub(/[^\/]*$/, "", bd) } function clr(v) { v = ent(v); gsub(/[\001\t\n\r]/, "", v); return v } function base(i, a) { for (i = 1; i <= N; i++) if (tolower(substr(T[i], 1, 6)) ~ /^<base[ \001\/]/) { attrs(T[i], a); if ("href" in a) { if (length(a["href"]) > 8192) odd = 1; else setb(clr(a["href"])); return } } } function norm(u, q, n, a, b, i, j, k, t) { if (!res(u)) return RX; q = RQ; u = RO dec(RP); if (q == "") return u; q = substr(q, 2); gsub(/\+/, " ", q); n = split(q, a, "&"); if (n > 256) { big = 1; return "!!" } k = 0; for (i = 1; i <= n; i++) if (a[i] != "") { t = dec(a[i]); if (index(t, "=") == 0) t = t "="; for (j = k++; j > 0 && b[j] > t; j--) b[j + 1] = b[j]; b[j + 1] = t } q = ""; for (i = 1; i <= k; i++) q = q "&" b[i]; return k ? u "?" substr(q, 2) : u } function at(v) { big = 0; if (length(v) > 8192) { unk = 1; return "?" } v = norm(clr(v)); if (big) { unk = 1; return "?" } return v } function load(n, i) { n = split(s, Q, "\001crawlmouse:end "); NP = n - 1; if (NP != np) odd = 1; B[1] = Q[1]; for (i = 2; i <= n; i++) { if (match(Q[i], /^200 [^ \001]+/)) { U[i - 1] = substr(Q[i], 5, RLENGTH - 4); B[i] = substr(Q[i], RLENGTH + 1) } else { odd = 1; U[i - 1] = ""; B[i] = "" } } } function open(i) { if (i > NP) return 0; setb(U[i]); scan(B[i]); base(); return 1 } BEGIN { A = 1; np = ARGV[A++] + 0 } BEGIN { ns = ARGV[A++]; for (i = 0; i < ns; i++) stale[norm(ARGV[A++])] = 1; nk = ARGV[A++]; for (i = 0; i < nk; i++) kept[norm(ARGV[A++])] = 1 } function links(p, i, a, u, old, found) { if (!open(p)) return 0; for (i = 1; i <= N; i++) if (T[i] ~ /^<[aA][ \001\/]/) { attrs(T[i], a); if (!("href" in a)) continue; unk = 0; u = at(a["href"]); if (u in stale || (unk && ns > 0)) old = 1; if (u in kept) found = 1 } return found && !old } BEGIN { ARGC = 1 } { s = s $0 } END { load(); exit !(links(1) && !odd) }' '1' '0' '1' 'https://built-site.test/products/forgotten-lantern'
  expect: Exit status 0 once `https://built-site.test/products/camp-kitchen-item-1` holds an <a> whose href is `https://built-site.test/products/forgotten-lantern`, however the URL is written. Today no crawled page holds such a link. A page that itself prints "crawlmouse:end" does not pass.
```

### `quotable_opening`

**Rule.** The check applies to a page of prose (an H1 with at least 150 words after it and no `Product` JSON-LD) and passes when, in the first 150 words after the H1, a block other than a list item with at least 5 words holds a sentence of 8 to 60 words that ends in a full stop.

**Exact check.** The same rule on the served HTML, tag by tag: after the first `h1`, each opening block’s text is gathered and judged until the word bound is read.

**See it.** One match of a pattern of ours per line (`seeMarkup`, §4). Here: the markup that follows the H1, cut to a fixed length.

Run in two states by `packets/by-type/quotable-opening.test.ts`.

Limits the packet states:

- `CHROME_GAP` (§4), in `expect`.
- `RECHECK` (§4), in `expect`.

Open limits:

- Shared, from the list above: **redirect body**.

Not said, because not measured:

- What a failing page says: the audit keeps no page text.

Documentation cited: none.

Lab fixture: no fix of this type.

### `generic_anchor_text`

**Rule.** Context: the hub, one of the top 5% of crawled pages by internal PageRank (`TOP_HUB_FRACTION`), and the generic links of the recorded links (recorded = generic / `measured`, rounded). Change: one line per generic link (its text, its target, the target’s title when read) up to a bound, the rest counted.

**Exact check.** Requests the hub and passes when it has same-site links and the first link to each target says none of the recorded generic texts the command names. Texts are compared without case, with spaces collapsed, character references read and the tags inside a link removed (`noLinkSays`). The builder throws for a record none of whose links the check holds a text for.

**See it.** The `<a …>text</a>` matches of the hub that hold one of the first few recorded texts. `after`: nothing.

Run in two states by `packets/by-type/generic-anchor-text.test.ts`.

Limits the packet states:

- The crawl records one link per target, with the first link text it found (context); a later link to the same target is not read (`expect`).
- The command knows the recorded phrases: another stock phrase in their place passes it, and is judged on the next check (`expect`).
- When the texts do not fit the command’s length, how many it leaves out (`expect`).
- A link with a tag inside its text is not printed by the readable command (`today`).

Not said, because not measured:

- The anchors the crawl did not keep: a second link to the same target.

Documentation cited: none.

Lab fixture: no fix of this type.

### `deep_pages`

**Rule.** Context: the clicks from the homepage (`measured`), or that no path of links reaches the page when it is null; the limit of 3 (`MAX_HEALTHY_DEPTH`); the pages on the recorded path, in URL order. Change: a link from a page at most 2 clicks down. The page named (`linkFrom`) is the first of these that is that close on the detector’s graph and holds no link to the page in the crawl’s record: the parent the orphan fix for the same URL suggests; the page the effect estimate links from (`shallowParent`, grade/effects.ts); the next page that close. The change says which of them it is.

**Exact check.** Requests that page and passes when one of its `<a>` elements links to the deep page. When no page passes the test above (`certain` false), it requests the page the developer names in the shell variable `CRAWLMOUSE_PAGE` (`fetchOfChosen`) and exits non-zero while the variable is unset.

**See it.** The `<a>` tags of that page that hold the deep page’s path. `today`: nothing, or, with no page to name, that the record does not say.

Run in two states by `packets/by-type/deep-pages.test.ts`.

Limits the packet states:

- If the link goes on another page, request that page instead (`expect`).
- The command proves the link; the click depth is measured again on the next check (`expect`).
- With no page the audit can vouch for, the command reads the page named in `CRAWLMOUSE_PAGE` and fails until it is set (`expect`).

Open limits:

- With no page the audit can vouch for, the exact check reads the page the developer names in a shell variable and exits non-zero until it is set. `expect` says so.
- Shared, from the list above: **path-end “See it”**.

Not said, because not measured:

- The depth the page will have after the fix.
- Whether the page named is a good editorial choice: it is chosen on the links as crawled, and the change says another page as close does as well.

Documentation cited: none.

Fixes of this type in the lab fixture: 2. The first, as stored:

```text
title: Bring https://built-site.test/products/forgotten-lantern within 3 clicks of the homepage
frameworks: generic
effort: none
before_after: none
context:
  No path of links from the homepage `https://built-site.test` reaches `https://built-site.test/products/forgotten-lantern`; the audit counts more than 3 clicks as deep.
change (generic):
  Add a link to `https://built-site.test/products/forgotten-lantern` on a page at most 2 clicks from the homepage, so that it lands within 3.
  No other page links to this one, and the audit's fix for that suggests `https://built-site.test/products/camp-kitchen-item-1`, a page that close: one link there settles both. The estimate for this fix was computed with the link on `https://built-site.test/blog/choosing-tent-pegs`; any page as close does as well.
  Write the link as an <a> element with an href, in the HTML the server sends. A link that only JavaScript adds is not there for a crawler that does not run scripts.
keep (generic):
  Keep the page at `https://built-site.test/products/forgotten-lantern` and the links it has: the fix adds a shorter path, it moves nothing.
See it:
  curl -sS --compressed --max-time 20 -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot' 'https://built-site.test/products/camp-kitchen-item-1' | tr '\r\n\t' '   ' | grep -aioE '<a [^>]*>' | grep -F -e '/products/forgotten-lantern"' -e '/products/forgotten-lantern'\''' -e '/products/forgotten-lantern?' -e '/products/forgotten-lantern#' -e '/products/forgotten-lantern/"' -e '/products/forgotten-lantern/'\''' -e '/products/forgotten-lantern>'
  today: Nothing: the crawl found no link to `https://built-site.test/products/forgotten-lantern` on that page.
  after: The <a> tag you added: a line that holds `/products/forgotten-lantern`. A link that spells the path another way is not printed; the exact check reads it.
Exact check (ua: OAI-SearchBot):
  curl -sS -f --compressed --max-time 20 -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot' -w '\ncrawlmouse:end %{http_code} %{url_effective}\n' 'https://built-site.test/products/camp-kitchen-item-1' | tr '\n\t\r\f\000' '\001\001\001  ' | LC_ALL=C awk 'function hexv(h, i, n) { n = 0; h = tolower(h); sub(/^0+/, "", h); if (length(h) > 6) return 0; for (i = 1; i <= length(h); i++) n = n * 16 + index("0123456789abcdef", substr(h, i, 1)) - 1; return n } function chr(n) { if (n < 1 || n > 1114111) n = 65533; if (n < 128) return sprintf("%c", n); if (n < 2048) return sprintf("%c%c", 192 + int(n / 64), 128 + n % 64); if (n < 65536) return sprintf("%c%c%c", 224 + int(n / 4096), 128 + int(n / 64) % 64, 128 + n % 64); return sprintf("%c%c%c%c", 240 + int(n / 262144), 128 + int(n / 4096) % 64, 128 + int(n / 64) % 64, 128 + n % 64) } function ent(v, o, r, e) { if (index(v, "&") == 0) return v; e = " Tab=9 NewLine=10 amp=38 lt=60 gt=62 quot=34 apos=39 nbsp=160 hellip=8230 rarr=8594 larr=8592 raquo=187 laquo=171 mdash=8212 ndash=8211 rsquo=8217 lsquo=8216 rdquo=8221 ldquo=8220 copy=169 reg=174 trade=8482 middot=183 bull=8226 times=215 "; o = ""; while (match(v, /&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[a-zA-Z][a-zA-Z0-9]*;)/)) { r = substr(v, RSTART + 1, RLENGTH - 1); sub(/;$/, "", r); o = o substr(v, 1, RSTART - 1); v = substr(v, RSTART + RLENGTH); if (r ~ /^#[xX]/) o = o chr(hexv(substr(r, 3))); else if (r ~ /^#/) { sub(/^#0*/, "", r); o = o chr(length(r) > 7 ? 0 : r + 0) } else if (match(e, " " r "=[0-9]+ ")) o = o chr(substr(e, RSTART + length(r) + 2, RLENGTH - length(r) - 3) + 0); else { unk = 1; o = o "&" r ";" } } return o v } function tend(t, p, r, q, i, k) { p = 0; while (match(t, /=[ \001]*["\047]|>/)) { if (substr(t, RSTART, 1) == ">") return p + RSTART; if (k++ >= 128) { far = 1; return 0 } q = substr(t, RSTART + RLENGTH - 1, 1); r = substr(t, RSTART + RLENGTH); i = index(r, q); if (!i) return 0; p += RSTART + RLENGTH - 1 + i; t = substr(r, i + 1) } return 0 } function add(t) { if (length(X[N]) < 8192) X[N] = X[N] t; else if (t ~ /[^ \001]/) V[N] = 1 } function scan(s, c, m, i, b, e, j, k) { N = 0; split("", V); m = split(s, c, "<"); X[0] = c[1]; for (i = 2; i <= m; i++) { b = c[i]; if (substr(b, 1, 3) == "!--") { b = substr(b, 4); if (b ~ /^-?>/) { add(substr(b, index(b, ">") + 1)); continue } e = index(b, "-->"); while (!e && i < m) { b = c[++i]; e = index(b, "-->") } if (e) add(substr(b, e + 3)); continue } if (b !~ /^[a-zA-Z\/!?]/) { add("<" b); continue } if (b ~ /^[!?]|^\/[^a-zA-Z]/) { e = index(b, ">"); while (!e && i < m) { b = c[++i]; e = index(b, ">") } if (e) add(substr(b, e + 1)); continue } j = 0; far = 0; while (!(e = tend(b)) && !far && i < m && j++ < 8) b = b "<" c[++i]; if (!e) { odd = far || i < m; break } if (match(tolower(substr(b, 1, 9)), /^(script|style|template|textarea|title)[ \001\/>]/)) { k = "/" substr(b, 1, RLENGTH - 1); e = 0; while (!e && i < m) { b = c[++i]; if (tolower(substr(b, 1, length(k))) == tolower(k) && substr(b, length(k) + 1, 1) ~ /^[ \001\/>]?$/) e = index(b, ">") } if (e) add(substr(b, e + 1)); continue } T[++N] = "<" substr(b, 1, e); X[N] = substr(b, e + 1) } } function attrs(t, a, k, v, q, i, n) { split("", a); sub(/^<[^ \001\/>]*/, "", t); while (1) { sub(/^[ \001\/]+/, "", t); if (t == "" || substr(t, 1, 1) == ">") return; if (n++ >= 128) { odd = 1; return } match(t, /^.[^ \001=\/>]*/); k = tolower(substr(t, 1, RLENGTH)); t = substr(t, RLENGTH + 1); sub(/^[ \001]+/, "", t); v = ""; if (substr(t, 1, 1) == "=") { t = substr(t, 2); sub(/^[ \001]+/, "", t); q = substr(t, 1, 1); if (q == "\"" || q == "\047") { t = substr(t, 2); i = index(t, q); v = i ? substr(t, 1, i - 1) : t; t = i ? substr(t, i + 1) : "" } else { match(t, /^[^ \001>]*/); v = substr(t, 1, RLENGTH); t = substr(t, RLENGTH + 1) } } if (!(k in a)) a[k] = v } } function dec(u, o, h) { if (index(u, "%") == 0) return u; o = ""; while (match(u, /%[0-9A-Fa-f][0-9A-Fa-f]/)) { h = toupper(substr(u, RSTART + 1, 2)); o = o substr(u, 1, RSTART - 1) (h ~ /^(00|23|25|26|2B|2F|3D|3F)$/ ? "%" h : sprintf("%c", hexv(h))); u = substr(u, RSTART + 3) } return o u } function res(u, q, i, h, n, g, k, st, t, hq, sc) { sub(/#.*/, "", u); gsub(/^ +| +$/, "", u); i = index(u, "?"); hq = i > 0; q = i ? substr(u, i) : ""; if (i) u = substr(u, 1, i - 1); sc = bs; if (match(u, /^[a-zA-Z][a-zA-Z0-9+.-]*:/)) { sc = tolower(substr(u, 1, RLENGTH - 1)); t = substr(u, RLENGTH + 1); if (sc != "http" && sc != "https") { RX = sc ":" t q; return 0 } gsub(/\\/, "/", t); if (sc == bs && t !~ /^\/\//) u = t; else { sub(/^\/*/, "", t); u = "//" t } } else gsub(/\\/, "/", u); if (u ~ /^\/\//) { sub(/^\/+/, "", u); i = index(u, "/"); h = i ? substr(u, 1, i - 1) : u; u = i ? substr(u, i) : "/"; sub(/^.*@/, "", h); h = tolower(h); if (sc == "http") sub(/:0*80$/, "", h); else sub(/:0*443$/, "", h); sub(/:$/, "", h); if (h == "" || sc == "") { RX = "!"; return 0 } RO = sc "://" h } else { if (bo == "") { RX = "!"; return 0 } RO = bo; if (u == "") { u = bp; if (!hq) q = bq } else if (u !~ /^\//) u = bd u } n = split(u, g, "/"); k = 0; RT = 0; for (i = 2; i <= n; i++) { t = tolower(g[i]); gsub(/%2e/, ".", t); RT = 1; if (t == "..") { if (k) k-- } else if (t != ".") { st[++k] = g[i]; RT = g[i] == "" } } RP = ""; for (i = 1; i <= k; i++) if (st[i] != "") RP = RP "/" st[i]; RQ = q; return 1 } function setb(u) { if (!res(u)) return; bo = RO; bs = RO; sub(/:.*/, "", bs); bp = RP; bq = RQ; bd = RP; if (RT) bd = bd "/"; else sub(/[^\/]*$/, "", bd) } function clr(v) { v = ent(v); gsub(/[\001\t\n\r]/, "", v); return v } function base(i, a) { for (i = 1; i <= N; i++) if (tolower(substr(T[i], 1, 6)) ~ /^<base[ \001\/]/) { attrs(T[i], a); if ("href" in a) { if (length(a["href"]) > 8192) odd = 1; else setb(clr(a["href"])); return } } } function norm(u, q, n, a, b, i, j, k, t) { if (!res(u)) return RX; q = RQ; u = RO dec(RP); if (q == "") return u; q = substr(q, 2); gsub(/\+/, " ", q); n = split(q, a, "&"); if (n > 256) { big = 1; return "!!" } k = 0; for (i = 1; i <= n; i++) if (a[i] != "") { t = dec(a[i]); if (index(t, "=") == 0) t = t "="; for (j = k++; j > 0 && b[j] > t; j--) b[j + 1] = b[j]; b[j + 1] = t } q = ""; for (i = 1; i <= k; i++) q = q "&" b[i]; return k ? u "?" substr(q, 2) : u } function at(v) { big = 0; if (length(v) > 8192) { unk = 1; return "?" } v = norm(clr(v)); if (big) { unk = 1; return "?" } return v } function load(n, i) { n = split(s, Q, "\001crawlmouse:end "); NP = n - 1; if (NP != np) odd = 1; B[1] = Q[1]; for (i = 2; i <= n; i++) { if (match(Q[i], /^200 [^ \001]+/)) { U[i - 1] = substr(Q[i], 5, RLENGTH - 4); B[i] = substr(Q[i], RLENGTH + 1) } else { odd = 1; U[i - 1] = ""; B[i] = "" } } } function open(i) { if (i > NP) return 0; setb(U[i]); scan(B[i]); base(); return 1 } BEGIN { A = 1; np = ARGV[A++] + 0 } BEGIN { ns = ARGV[A++]; for (i = 0; i < ns; i++) stale[norm(ARGV[A++])] = 1; nk = ARGV[A++]; for (i = 0; i < nk; i++) kept[norm(ARGV[A++])] = 1 } function links(p, i, a, u, old, found) { if (!open(p)) return 0; for (i = 1; i <= N; i++) if (T[i] ~ /^<[aA][ \001\/]/) { attrs(T[i], a); if (!("href" in a)) continue; unk = 0; u = at(a["href"]); if (u in stale || (unk && ns > 0)) old = 1; if (u in kept) found = 1 } return found && !old } BEGIN { ARGC = 1 } { s = s $0 } END { load(); exit !(links(1) && !odd) }' '1' '0' '1' 'https://built-site.test/products/forgotten-lantern'
  expect: Exit status 0 once `https://built-site.test/products/camp-kitchen-item-1` holds an <a> whose href is `https://built-site.test/products/forgotten-lantern`, however the URL is written; today it holds none. If you put the link on another page, request that page instead. The command proves the link; the click depth is measured again on the next check. A page that itself prints "crawlmouse:end" does not pass.
```

### `specs_as_images`

**Rule.** The check applies to a page with `Product` JSON-LD and fails one that shows an image of specifications (an `<img>` that is not a link to another page, whose alt text or file name matches `SPEC_IMAGE`) with no `<table>`, no `<dl>` and fewer than 2 “Label: value” lines with a digit in the value.

**Exact check.** Passes when a `<table>` or `<dl>` outside the set-aside elements holds a `<td>` or `<dd>` with text.

**See it.** One match of a pattern of ours per line (`seeMarkup`, §4). Here: the `<th>`, `<td>`, `<dt>` and `<dd>` cells, each with its text up to the next tag.

Run in two states by `packets/by-type/specs-as-images.test.ts`.

Limits the packet states:

- A page that gives its specifications as labelled lines without a table passes the check and not the command (`expect`).
- `CHROME_GAP` (§4), in `expect`.
- `RECHECK` (§4), in `expect`.

Open limits:

- The exact check does not read what the cells say: a table of anything passes it.
- Shared, from the list above: **redirect body**.

Not said, because not measured:

- Which image matched, on which page, and what it shows (context).
- What a failing page says: the audit keeps no page text.

Documentation cited: none.

Lab fixture: no fix of this type.

### `missing_schema_description`

**Rule.** The check passes a page when a JSON-LD node about the page itself has a `description` that is not empty; the context names `WebPage`, `Article`, `BlogPosting`, `Product`, `Service`, `Event` as examples of such a node’s type (`PAGE_TYPES_NAMED`); a page with no JSON-LD fails; a description on `WebSite` or `Organization`, or the meta description, does not count. The check’s type list is not exported, so the builder restates it, and its test holds it to the check’s verdict.

**Exact check.** Passes when one `application/ld+json` block holds both a type about the page itself (as a string, in a list, or as a schema.org IRI) and a `description` whose value starts with a character that is not a space. A script element is read as one line, so a `<` in its text does not cut the block (`AWK_SCRIPTS`).

**See it.** One match of a pattern of ours per line (`seeMarkup`, §4). Here: each `"description": "…"` pair.

Run in two states by `packets/by-type/missing-schema-description.test.ts`.

Limits the packet states:

- The command does not tell which node of the block the description is on (`expect`).
- What the readable command prints today, if anything, is not a description on the page’s own node (`today`).
- `RECHECK` (§4), in `expect`.

Open limits:

- Shared, from the list above: **redirect body**.

Not said, because not measured:

- What kind of page the template is: the change gives the type per kind and leaves the choice to the reader.
- What a failing page says: the audit keeps no page text.

Documentation cited:

- `generic`:
  - [schema.org: description](https://schema.org/description), read 2026-11-12. Supports: `description` is a property of Thing, so of every type; its value is text.
  - [Intro to How Structured Data Markup Works | Google Search Central](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data), read 2026-11-12. Supports: JSON-LD goes in a `<script>` element in the `<head>` or the `<body>` of the page.
- `nextjs`:
  - [How to implement JSON-LD in your Next.js application](https://nextjs.org/docs/app/guides/json-ld), read 2026-11-12. Supports: render JSON-LD as a native `<script>` in `page.js` or `layout.js`, from `JSON.stringify` with `<` replaced by `\u003c`; `description` is in its example.

Fixes of this type in the lab fixture: 3. The first, as stored:

```text
title: Describe blog posts in their schema.org markup
frameworks: generic, nextjs
effort: {"kind":"templates","templates":1,"deploys":1}
before_after: none
context:
  The check for structured data with a description fails on 13 of the 13 pages of the template `/blog/{slug}` it was decided on.
  The check passes a page when a JSON-LD node about the page itself has a `description` that is not empty. Such a node has an `@type` like `WebPage`, `Article`, `BlogPosting`, `Product`, `Service`, `Event`, or another type whose name ends in `Page` or `Article`.
  A page with no JSON-LD fails. A description on a node about the site or the business (`WebSite`, `Organization`) does not count, and neither does the meta description.
  Failing pages: `https://built-site.test/blog/camp-cooking-ideas`, `https://built-site.test/blog/campfire-safety-basics`, `https://built-site.test/blog/choosing-tent-pegs` and 10 more pages not shown.
  The check does not count towards a grade yet, so this fix moves no grade today.
change (generic):
  In the template `/blog/{slug}`, find the `<script type="application/ld+json">` block the server sends. If it has a node whose `@type` describes the page itself (`Product` on a product page, `Article` or `BlogPosting` on an article, `WebPage` otherwise), add a `description` property to that node.
  If the template sends no such node, add one in a `<script type="application/ld+json">` element, with `@context`, `@type`, `name` and `description`.
  Fill `description` from the page's own summary field (the one its meta description or excerpt comes from), as plain text. An empty string or one of only spaces does not pass.
  Write the value with the platform's JSON encoder, so a quote or a line break in the text cannot break the block; a block that does not parse declares nothing.
  Send the block in the HTML response. The check does not run scripts, so markup a script adds in the browser is not read.
keep (generic):
  Keep each page's URL and its H1.
  Keep the node's other properties and the page's other JSON-LD nodes as they are.
  Keep the visible content unchanged: the description summarises what the page already says and adds no claim of its own.
See it:
  curl -sS --compressed -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot' 'https://built-site.test/blog/camp-cooking-ideas' | tr '\n' ' ' | grep -aioE '"description" *: *"[^"]*"'
  today: Each `"description": "…"` pair in the page’s source, one per line. The audit found no JSON-LD node about the page itself with a description that is not empty, so what it prints today, if anything, is not one: a description on another node (`WebSite`, `Organization`), an empty one, or one outside JSON-LD. It is the first of the template’s failing pages (13 of 13 decided).
  after: A `"description": "…"` line with the page’s own summary, from the node about the page itself.
Exact check (ua: OAI-SearchBot):
  curl -sSf --compressed -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot' 'https://built-site.test/blog/camp-cooking-ideas' | tr '\r\n<' '  \n' | awk '{Q=0}J!=""{if(tolower($0)~/^\/script[ \t>]/){$0=J;J="";Q=1}else{J=J"<"$0;next}}S{if(tolower($0)~/^\/script[ \t>]/)S=0;next}!Q&&tolower($0)~/^script[ \t>]/{if(tolower($0)~/^script[^>]*application\/ld\+json/)J=$0;else S=1;next}tolower($0)~/^script[^>]*application\/ld\+json/&&$0~/"@type"[ \t]*:[ \t]*(\[[^]]*)?"(https?:\/\/schema\.org\/)?([A-Za-z]*(Page|Article|BlogPosting|SocialMediaPosting)|Product|ProductModel|IndividualProduct|Service|Event|Recipe|HowTo|Course|TouristTrip|Car|Vehicle)"/&&$0~/"description"[ \t]*:[ \t]*"[ \t]*[^" \t]/{f=1}END{exit !f}'
  expect: Exit status 0 when one JSON-LD block of the first failing page holds a type about the page itself and a `description` that is not empty; the audit's check failed that page. It requests as OAI-SearchBot, which the site serves today. The command does not tell which node of the block the description is on. An error status does not pass. The audit's next check applies the full rule to every page of the template.
change (nextjs):
  In the `page.js` (or `layout.js`) that renders `/blog/{slug}`, build the object for the page's own node: `{ '@context': 'https://schema.org', '@type': …, name: …, description: … }`, with `description` from the same data the page renders its summary from.
  Render it in the component's output as a native script element: `<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />`. Do not use `next/script` for it.
  If the page already renders such an object without `description`, add the property there instead of a second node.
  Confirm the block is in the HTML response, which is what the check and the verify command read. An empty `description` does not pass.
keep (nextjs): as generic
```

### `no_question_headings`

**Rule.** The check applies to a page of prose with at least 3 section headings (an `h2` or `h3` after the H1 whose next block is prose of at least 5 words) and passes when one `h2` or `h3` after the H1 has a clause ending in `?`, `؟`, `？` (`QUESTION_MARKS`). The change asks for one heading.

**Exact check.** Passes when an `h2` or `h3` after the first `h1`, outside the set-aside elements, holds one of those marks followed by a space or the end of the heading.

**See it.** One match of a pattern of ours per line (`seeMarkup`, §4). Here: the `<h2>` and `<h3>` headings, each with its text up to the next tag.

Run in two states by `packets/by-type/no-question-headings.test.ts`.

Limits the packet states:

- `CHROME_GAP` (§4), in `expect`.
- `RECHECK` (§4), in `expect`.

Open limits:

- Shared, from the list above: **redirect body**.

Not said, because not measured:

- What a failing page says: the audit keeps no page text.

Documentation cited: none.

Lab fixture: no fix of this type.

### `missing_author_date`

**Rule.** The check applies to a page whose JSON-LD has an Article node and passes when the page names an author and a publication date in markup; the context lists the routes read for an author and for a date. The check’s Article type list is not exported, so the builder restates it, and its test holds it to the check’s verdict.

**Exact check.** Passes when the page holds an author and a date by one of those routes: `author` and `datePublished` on a JSON-LD block that holds an Article type; a `meta` element with content; `rel="author"` outside the set-aside elements; `itemprop` and `<time datetime>` outside them and inside `<body>`.

**See it.** One match of a pattern of ours per line (`seeMarkup`, §4). Here: each JSON-LD `author` or `datePublished` key with the characters after it, and each tag that carries a byline attribute. It is looser than the check: a tag that mentions an author in a URL is printed too.

Run in two states by `packets/by-type/missing-author-date.test.ts`.

Limits the packet states:

- The audit does not record which of the two a failing page lacks (context, `today`).
- `CHROME_GAP` (§4), in `expect`.
- `RECHECK` (§4), in `expect`.

Open limits:

- Shared, from the list above: **redirect body**.

Not said, because not measured:

- Which of author and date is missing.
- What a failing page says: the audit keeps no page text.

Documentation cited:

- `generic`:
  - [Article (Article, NewsArticle, BlogPosting) structured data | Google Search Central](https://developers.google.com/search/docs/appearance/structured-data/article), read 2026-11-12. Supports: `author` (with `author.name`) and `datePublished` in ISO 8601, with timezone information, are recommended properties of an Article node.
  - [schema.org: Article](https://schema.org/Article), read 2026-11-12. Supports: `author` is an Organization or a Person; `datePublished` is the date of first publication.
- `nextjs`:
  - [How to implement JSON-LD in your Next.js application](https://nextjs.org/docs/app/guides/json-ld), read 2026-11-12. Supports: render JSON-LD as a native `<script>` in `page.js` or `layout.js`, from `JSON.stringify` with `<` replaced by `\u003c`.
  - [Article (Article, NewsArticle, BlogPosting) structured data | Google Search Central](https://developers.google.com/search/docs/appearance/structured-data/article), read 2026-11-12. Supports: `author` (with `author.name`) and `datePublished` in ISO 8601, with timezone information, are recommended properties of an Article node.
- `wordpress`:
  - [get_the_author_posts_link() | WordPress Developer Resources](https://developer.wordpress.org/reference/functions/get_the_author_posts_link/), read 2026-11-12. Supports: the link `the_author_posts_link()` prints is `<a href="…" rel="author">` with the author’s display name.
  - [the_author_posts_link() | WordPress Developer Resources](https://developer.wordpress.org/reference/functions/the_author_posts_link/), read 2026-11-12. Supports: the template tag displays that link for the current post’s author.
  - [get_the_time() | WordPress Developer Resources](https://developer.wordpress.org/reference/functions/get_the_time/), read 2026-11-12. Supports: `get_the_time( $format )` returns the post’s time in a PHP date format.
  - [the_date() | WordPress Developer Resources](https://developer.wordpress.org/reference/functions/the_date/), read 2026-11-12. Supports: `the_date()` prints a date once per day of posts; `the_time( 'F j, Y' )` prints it on every post.
  - [PHP: DateTimeInterface::format](https://www.php.net/manual/en/datetime.format.php), read 2026-11-12. Supports: the format character `c` is the ISO 8601 date, e.g. 2004-02-12T15:19:21+00:00.

Lab fixture: no fix of this type.

### `js_only_navigation`

Registry reason: No packet yet: the audit finds these links by reading each sampled page before and after its JavaScript runs, and the steps to put them in the HTML are not written for any stack yet.

Lab fixture: no fix of this type.

### `redirect_chain`

**Rule.** Context: how many pages link to the URL; the redirects (`measured`); one line per recorded hop (from, status, Location); where the chain ends (`endOf`). At a page that answers 200 at another URL: the links are pointed at it and the redirect is kept. At the same page under the address its server serves (a trailing slash, say): the href is written as that address, or the redirect rules change. Nowhere (a loop, or a crawl that stopped on a redirect): the change is to the redirect rules.

**Exact check.** When the chain ends at another page and the programs can tell the two URLs apart (`sameInCommand`): requests the first linking page and passes when it links to the final URL and no longer to the redirecting one. Otherwise: `curl -f -o /dev/null -L --max-redirs 1` on the address the crawl requested, which passes when it reaches a page that answers below 400 through at most one redirect.

**See it.** In the first form: the `<a>` tags of the linking page that hold either path. In the second: the number of redirects followed and the last status (`-w`), with up to 10 redirects followed.

Run in two states by `packets/by-type/redirect-chain.test.ts`.

Limits the packet states:

- The command reads the first of the linking pages: run it for each (`expect`).
- `UNREAD_HREF` (§4), in `expect`.
- In the second form the command follows the redirects; links rewritten to the final address are measured on the next check (`expect`).

Open limits:

- Shared, from the list above: **path-end “See it”**.

Not said, because not measured:

- Who controls the redirect rules.

Documentation cited: none.

Fixes of this type in the lab fixture: 1. The first, as stored:

```text
title: Link straight to where https://built-site.test/products/old-dome-tent redirects
frameworks: generic
effort: none
before_after: none
context:
  2 pages link to `https://built-site.test/products/old-dome-tent`, which answers only after 2 redirects.
  Redirect 1: `https://built-site.test/products/old-dome-tent` answers 301 with Location `https://built-site.test/products/older-dome-tent`.
  Redirect 2: `https://built-site.test/products/older-dome-tent` answers 301 with Location `https://built-site.test/products/dome-tent-classic`.
  The chain ends at `https://built-site.test/products/dome-tent-classic`, which answers 200.
change (generic):
  On `https://built-site.test/collections/camping-tents`, `https://built-site.test/collections/camping-tents?page=2`, change the href of each link to `https://built-site.test/products/old-dome-tent` so that it reads `https://built-site.test/products/dome-tent-classic`.
  A link in a shared header, footer or template is one edit for every page it appears on.
  Separately, if you control the redirect rules, send `https://built-site.test/products/old-dome-tent` to `https://built-site.test/products/dome-tent-classic` in one response. The links are what this fix measures.
keep (generic):
  Keep the redirect from `https://built-site.test/products/old-dome-tent`: links on other sites and bookmarks still arrive there.
See it:
  curl -sS --compressed --max-time 20 -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot' 'https://built-site.test/collections/camping-tents' | tr '\r\n\t' '   ' | grep -aioE '<a [^>]*>' | grep -F -e '/products/old-dome-tent"' -e '/products/old-dome-tent'\''' -e '/products/old-dome-tent?' -e '/products/old-dome-tent#' -e '/products/old-dome-tent/"' -e '/products/old-dome-tent/'\''' -e '/products/old-dome-tent>' -e '/products/dome-tent-classic"' -e '/products/dome-tent-classic'\''' -e '/products/dome-tent-classic?' -e '/products/dome-tent-classic#' -e '/products/dome-tent-classic/"' -e '/products/dome-tent-classic/'\''' -e '/products/dome-tent-classic>'
  today: The <a> tags that link to `https://built-site.test/products/old-dome-tent`: lines that hold `/products/old-dome-tent`.
  after: The <a> tags that link to `https://built-site.test/products/dome-tent-classic`, lines that hold `/products/dome-tent-classic`, and none that links to `https://built-site.test/products/old-dome-tent`.
Exact check (ua: OAI-SearchBot):
  curl -sS -f --compressed --max-time 20 -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot' -w '\ncrawlmouse:end %{http_code} %{url_effective}\n' 'https://built-site.test/collections/camping-tents' | tr '\n\t\r\f\000' '\001\001\001  ' | LC_ALL=C awk 'function hexv(h, i, n) { n = 0; h = tolower(h); sub(/^0+/, "", h); if (length(h) > 6) return 0; for (i = 1; i <= length(h); i++) n = n * 16 + index("0123456789abcdef", substr(h, i, 1)) - 1; return n } function chr(n) { if (n < 1 || n > 1114111) n = 65533; if (n < 128) return sprintf("%c", n); if (n < 2048) return sprintf("%c%c", 192 + int(n / 64), 128 + n % 64); if (n < 65536) return sprintf("%c%c%c", 224 + int(n / 4096), 128 + int(n / 64) % 64, 128 + n % 64); return sprintf("%c%c%c%c", 240 + int(n / 262144), 128 + int(n / 4096) % 64, 128 + int(n / 64) % 64, 128 + n % 64) } function ent(v, o, r, e) { if (index(v, "&") == 0) return v; e = " Tab=9 NewLine=10 amp=38 lt=60 gt=62 quot=34 apos=39 nbsp=160 hellip=8230 rarr=8594 larr=8592 raquo=187 laquo=171 mdash=8212 ndash=8211 rsquo=8217 lsquo=8216 rdquo=8221 ldquo=8220 copy=169 reg=174 trade=8482 middot=183 bull=8226 times=215 "; o = ""; while (match(v, /&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[a-zA-Z][a-zA-Z0-9]*;)/)) { r = substr(v, RSTART + 1, RLENGTH - 1); sub(/;$/, "", r); o = o substr(v, 1, RSTART - 1); v = substr(v, RSTART + RLENGTH); if (r ~ /^#[xX]/) o = o chr(hexv(substr(r, 3))); else if (r ~ /^#/) { sub(/^#0*/, "", r); o = o chr(length(r) > 7 ? 0 : r + 0) } else if (match(e, " " r "=[0-9]+ ")) o = o chr(substr(e, RSTART + length(r) + 2, RLENGTH - length(r) - 3) + 0); else { unk = 1; o = o "&" r ";" } } return o v } function tend(t, p, r, q, i, k) { p = 0; while (match(t, /=[ \001]*["\047]|>/)) { if (substr(t, RSTART, 1) == ">") return p + RSTART; if (k++ >= 128) { far = 1; return 0 } q = substr(t, RSTART + RLENGTH - 1, 1); r = substr(t, RSTART + RLENGTH); i = index(r, q); if (!i) return 0; p += RSTART + RLENGTH - 1 + i; t = substr(r, i + 1) } return 0 } function add(t) { if (length(X[N]) < 8192) X[N] = X[N] t; else if (t ~ /[^ \001]/) V[N] = 1 } function scan(s, c, m, i, b, e, j, k) { N = 0; split("", V); m = split(s, c, "<"); X[0] = c[1]; for (i = 2; i <= m; i++) { b = c[i]; if (substr(b, 1, 3) == "!--") { b = substr(b, 4); if (b ~ /^-?>/) { add(substr(b, index(b, ">") + 1)); continue } e = index(b, "-->"); while (!e && i < m) { b = c[++i]; e = index(b, "-->") } if (e) add(substr(b, e + 3)); continue } if (b !~ /^[a-zA-Z\/!?]/) { add("<" b); continue } if (b ~ /^[!?]|^\/[^a-zA-Z]/) { e = index(b, ">"); while (!e && i < m) { b = c[++i]; e = index(b, ">") } if (e) add(substr(b, e + 1)); continue } j = 0; far = 0; while (!(e = tend(b)) && !far && i < m && j++ < 8) b = b "<" c[++i]; if (!e) { odd = far || i < m; break } if (match(tolower(substr(b, 1, 9)), /^(script|style|template|textarea|title)[ \001\/>]/)) { k = "/" substr(b, 1, RLENGTH - 1); e = 0; while (!e && i < m) { b = c[++i]; if (tolower(substr(b, 1, length(k))) == tolower(k) && substr(b, length(k) + 1, 1) ~ /^[ \001\/>]?$/) e = index(b, ">") } if (e) add(substr(b, e + 1)); continue } T[++N] = "<" substr(b, 1, e); X[N] = substr(b, e + 1) } } function attrs(t, a, k, v, q, i, n) { split("", a); sub(/^<[^ \001\/>]*/, "", t); while (1) { sub(/^[ \001\/]+/, "", t); if (t == "" || substr(t, 1, 1) == ">") return; if (n++ >= 128) { odd = 1; return } match(t, /^.[^ \001=\/>]*/); k = tolower(substr(t, 1, RLENGTH)); t = substr(t, RLENGTH + 1); sub(/^[ \001]+/, "", t); v = ""; if (substr(t, 1, 1) == "=") { t = substr(t, 2); sub(/^[ \001]+/, "", t); q = substr(t, 1, 1); if (q == "\"" || q == "\047") { t = substr(t, 2); i = index(t, q); v = i ? substr(t, 1, i - 1) : t; t = i ? substr(t, i + 1) : "" } else { match(t, /^[^ \001>]*/); v = substr(t, 1, RLENGTH); t = substr(t, RLENGTH + 1) } } if (!(k in a)) a[k] = v } } function dec(u, o, h) { if (index(u, "%") == 0) return u; o = ""; while (match(u, /%[0-9A-Fa-f][0-9A-Fa-f]/)) { h = toupper(substr(u, RSTART + 1, 2)); o = o substr(u, 1, RSTART - 1) (h ~ /^(00|23|25|26|2B|2F|3D|3F)$/ ? "%" h : sprintf("%c", hexv(h))); u = substr(u, RSTART + 3) } return o u } function res(u, q, i, h, n, g, k, st, t, hq, sc) { sub(/#.*/, "", u); gsub(/^ +| +$/, "", u); i = index(u, "?"); hq = i > 0; q = i ? substr(u, i) : ""; if (i) u = substr(u, 1, i - 1); sc = bs; if (match(u, /^[a-zA-Z][a-zA-Z0-9+.-]*:/)) { sc = tolower(substr(u, 1, RLENGTH - 1)); t = substr(u, RLENGTH + 1); if (sc != "http" && sc != "https") { RX = sc ":" t q; return 0 } gsub(/\\/, "/", t); if (sc == bs && t !~ /^\/\//) u = t; else { sub(/^\/*/, "", t); u = "//" t } } else gsub(/\\/, "/", u); if (u ~ /^\/\//) { sub(/^\/+/, "", u); i = index(u, "/"); h = i ? substr(u, 1, i - 1) : u; u = i ? substr(u, i) : "/"; sub(/^.*@/, "", h); h = tolower(h); if (sc == "http") sub(/:0*80$/, "", h); else sub(/:0*443$/, "", h); sub(/:$/, "", h); if (h == "" || sc == "") { RX = "!"; return 0 } RO = sc "://" h } else { if (bo == "") { RX = "!"; return 0 } RO = bo; if (u == "") { u = bp; if (!hq) q = bq } else if (u !~ /^\//) u = bd u } n = split(u, g, "/"); k = 0; RT = 0; for (i = 2; i <= n; i++) { t = tolower(g[i]); gsub(/%2e/, ".", t); RT = 1; if (t == "..") { if (k) k-- } else if (t != ".") { st[++k] = g[i]; RT = g[i] == "" } } RP = ""; for (i = 1; i <= k; i++) if (st[i] != "") RP = RP "/" st[i]; RQ = q; return 1 } function setb(u) { if (!res(u)) return; bo = RO; bs = RO; sub(/:.*/, "", bs); bp = RP; bq = RQ; bd = RP; if (RT) bd = bd "/"; else sub(/[^\/]*$/, "", bd) } function clr(v) { v = ent(v); gsub(/[\001\t\n\r]/, "", v); return v } function base(i, a) { for (i = 1; i <= N; i++) if (tolower(substr(T[i], 1, 6)) ~ /^<base[ \001\/]/) { attrs(T[i], a); if ("href" in a) { if (length(a["href"]) > 8192) odd = 1; else setb(clr(a["href"])); return } } } function norm(u, q, n, a, b, i, j, k, t) { if (!res(u)) return RX; q = RQ; u = RO dec(RP); if (q == "") return u; q = substr(q, 2); gsub(/\+/, " ", q); n = split(q, a, "&"); if (n > 256) { big = 1; return "!!" } k = 0; for (i = 1; i <= n; i++) if (a[i] != "") { t = dec(a[i]); if (index(t, "=") == 0) t = t "="; for (j = k++; j > 0 && b[j] > t; j--) b[j + 1] = b[j]; b[j + 1] = t } q = ""; for (i = 1; i <= k; i++) q = q "&" b[i]; return k ? u "?" substr(q, 2) : u } function at(v) { big = 0; if (length(v) > 8192) { unk = 1; return "?" } v = norm(clr(v)); if (big) { unk = 1; return "?" } return v } function load(n, i) { n = split(s, Q, "\001crawlmouse:end "); NP = n - 1; if (NP != np) odd = 1; B[1] = Q[1]; for (i = 2; i <= n; i++) { if (match(Q[i], /^200 [^ \001]+/)) { U[i - 1] = substr(Q[i], 5, RLENGTH - 4); B[i] = substr(Q[i], RLENGTH + 1) } else { odd = 1; U[i - 1] = ""; B[i] = "" } } } function open(i) { if (i > NP) return 0; setb(U[i]); scan(B[i]); base(); return 1 } BEGIN { A = 1; np = ARGV[A++] + 0 } BEGIN { ns = ARGV[A++]; for (i = 0; i < ns; i++) stale[norm(ARGV[A++])] = 1; nk = ARGV[A++]; for (i = 0; i < nk; i++) kept[norm(ARGV[A++])] = 1 } function links(p, i, a, u, old, found) { if (!open(p)) return 0; for (i = 1; i <= N; i++) if (T[i] ~ /^<[aA][ \001\/]/) { attrs(T[i], a); if (!("href" in a)) continue; unk = 0; u = at(a["href"]); if (u in stale || (unk && ns > 0)) old = 1; if (u in kept) found = 1 } return found && !old } BEGIN { ARGC = 1 } { s = s $0 } END { load(); exit !(links(1) && !odd) }' '1' '1' 'https://built-site.test/products/old-dome-tent' '1' 'https://built-site.test/products/dome-tent-classic'
  expect: Exit status 0 once `https://built-site.test/collections/camping-tents` links to `https://built-site.test/products/dome-tent-classic` and no longer to `https://built-site.test/products/old-dome-tent` (an <a> href, however the URL is written). Today it links to `https://built-site.test/products/old-dome-tent`. An href the command cannot read counts as the old link. The command reads the first of the 2 linking pages: run it for each. A page that itself prints "crawlmouse:end" does not pass.
```

### `duplicate_pagination`

**Rule.** Context: the template key and the later pages detected; then, per condition the record holds: the pages whose row declares the first page of their list as canonical (`firstPageOf`), with Google’s pagination page; and the near-duplicates (64-bit content hashes within 3 bits, `SIMHASH_HAMMING_K`): the detected pages that do not declare the first page, or “At least one of the pages above” when each detected page declares it. Change: a step per condition.

**Exact check.** On the first affected page. Canonical: the `<head>` holds one `rel="canonical"`, naming the page’s own address. Content: requests the first page and the later page in one `curl`, and passes when each links to two pages of the site the other does not link to, leaving out the first page itself and targets that hold the list’s own mark (`listMark`, `listsDiffer`). When the first affected page carries both, one program asks both.

**See it.** Canonical: the page’s canonical tag. Content alone: the `<a>` tags that are on one of the two pages and not on the other (`sort | uniq -u`).

Run in two states by `packets/by-type/duplicate-pagination.test.ts`.

Limits the packet states:

- The command compares links, not the content hash the audit measures, which the next check measures again (`expect`).
- A canonical sent in an HTTP Link header is not read (`expect`).
- The command reads the first of the later pages; the others are measured again on the next check (`expect`).

Open limits:

- The content check asks each page for two same-site links of its own that the other lacks. A later page that repeats the first page’s items and also holds two such links of its own passes it, while the audit’s content hash still finds the pages alike: a pass before the fix. `expect` says so. D3 does not allow it, and no one-line check of links closes it (the audit’s signal is the content hash); it stands as a disclosed limit for the owner to accept or refuse (§12).

Not said, because not measured:

- Which page is the near-duplicate, when each affected page also declares the first page.

Documentation cited:

- Printed in the packet’s own text (`GOOGLE_DOCS.pagination`): https://developers.google.com/search/docs/specialty/ecommerce/pagination-and-incremental-page-loading

Fixes of this type in the lab fixture: 1. The first, as stored:

```text
title: Make the later pages of collection pages distinct
frameworks: generic
effort: {"kind":"templates","templates":1,"deploys":1}
before_after: none
context:
  Template `/collections/{slug}`: 1 later page of a paginated list repeats its first page: `https://built-site.test/collections/camping-tents?page=2`.
  Main content nearly identical to the first page's (64-bit content hashes within 3 bits): `https://built-site.test/collections/camping-tents?page=2`.
change (generic):
  Make each later page list its own items. A later page that serves the first page again usually means the page number in the URL does not reach the query that builds the list.
keep (generic):
  Keep each later page at its own URL, and keep the <a href> links from one page of the list to the next: Google reads the pages of a sequence as separate pages.
See it:
  curl -sS --compressed --max-time 20 -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot' 'https://built-site.test/collections/camping-tents' | tr '\r\n\t' '   ' | grep -aioE '<a [^>]*>' | sort -u | { cat; curl -sS --compressed --max-time 20 -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot' 'https://built-site.test/collections/camping-tents?page=2' | tr '\r\n\t' '   ' | grep -aioE '<a [^>]*>' | sort -u; } | sort | uniq -u
  today: The <a> tags that are on one of the two pages and not on the other. The record does not hold the pages' links: it holds that their main content is nearly identical, so expect few lines or none besides the links between the list's own pages.
  after: The <a> tags of the items each page lists and the other does not.
Exact check (ua: OAI-SearchBot):
  curl -sS -f --compressed --max-time 20 -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot' -w '\ncrawlmouse:end %{http_code} %{url_effective}\n' 'https://built-site.test/collections/camping-tents' 'https://built-site.test/collections/camping-tents?page=2' | tr '\n\t\r\f\000' '\001\001\001  ' | LC_ALL=C awk 'function hexv(h, i, n) { n = 0; h = tolower(h); sub(/^0+/, "", h); if (length(h) > 6) return 0; for (i = 1; i <= length(h); i++) n = n * 16 + index("0123456789abcdef", substr(h, i, 1)) - 1; return n } function chr(n) { if (n < 1 || n > 1114111) n = 65533; if (n < 128) return sprintf("%c", n); if (n < 2048) return sprintf("%c%c", 192 + int(n / 64), 128 + n % 64); if (n < 65536) return sprintf("%c%c%c", 224 + int(n / 4096), 128 + int(n / 64) % 64, 128 + n % 64); return sprintf("%c%c%c%c", 240 + int(n / 262144), 128 + int(n / 4096) % 64, 128 + int(n / 64) % 64, 128 + n % 64) } function ent(v, o, r, e) { if (index(v, "&") == 0) return v; e = " Tab=9 NewLine=10 amp=38 lt=60 gt=62 quot=34 apos=39 nbsp=160 hellip=8230 rarr=8594 larr=8592 raquo=187 laquo=171 mdash=8212 ndash=8211 rsquo=8217 lsquo=8216 rdquo=8221 ldquo=8220 copy=169 reg=174 trade=8482 middot=183 bull=8226 times=215 "; o = ""; while (match(v, /&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[a-zA-Z][a-zA-Z0-9]*;)/)) { r = substr(v, RSTART + 1, RLENGTH - 1); sub(/;$/, "", r); o = o substr(v, 1, RSTART - 1); v = substr(v, RSTART + RLENGTH); if (r ~ /^#[xX]/) o = o chr(hexv(substr(r, 3))); else if (r ~ /^#/) { sub(/^#0*/, "", r); o = o chr(length(r) > 7 ? 0 : r + 0) } else if (match(e, " " r "=[0-9]+ ")) o = o chr(substr(e, RSTART + length(r) + 2, RLENGTH - length(r) - 3) + 0); else { unk = 1; o = o "&" r ";" } } return o v } function tend(t, p, r, q, i, k) { p = 0; while (match(t, /=[ \001]*["\047]|>/)) { if (substr(t, RSTART, 1) == ">") return p + RSTART; if (k++ >= 128) { far = 1; return 0 } q = substr(t, RSTART + RLENGTH - 1, 1); r = substr(t, RSTART + RLENGTH); i = index(r, q); if (!i) return 0; p += RSTART + RLENGTH - 1 + i; t = substr(r, i + 1) } return 0 } function add(t) { if (length(X[N]) < 8192) X[N] = X[N] t; else if (t ~ /[^ \001]/) V[N] = 1 } function scan(s, c, m, i, b, e, j, k) { N = 0; split("", V); m = split(s, c, "<"); X[0] = c[1]; for (i = 2; i <= m; i++) { b = c[i]; if (substr(b, 1, 3) == "!--") { b = substr(b, 4); if (b ~ /^-?>/) { add(substr(b, index(b, ">") + 1)); continue } e = index(b, "-->"); while (!e && i < m) { b = c[++i]; e = index(b, "-->") } if (e) add(substr(b, e + 3)); continue } if (b !~ /^[a-zA-Z\/!?]/) { add("<" b); continue } if (b ~ /^[!?]|^\/[^a-zA-Z]/) { e = index(b, ">"); while (!e && i < m) { b = c[++i]; e = index(b, ">") } if (e) add(substr(b, e + 1)); continue } j = 0; far = 0; while (!(e = tend(b)) && !far && i < m && j++ < 8) b = b "<" c[++i]; if (!e) { odd = far || i < m; break } if (match(tolower(substr(b, 1, 9)), /^(script|style|template|textarea|title)[ \001\/>]/)) { k = "/" substr(b, 1, RLENGTH - 1); e = 0; while (!e && i < m) { b = c[++i]; if (tolower(substr(b, 1, length(k))) == tolower(k) && substr(b, length(k) + 1, 1) ~ /^[ \001\/>]?$/) e = index(b, ">") } if (e) add(substr(b, e + 1)); continue } T[++N] = "<" substr(b, 1, e); X[N] = substr(b, e + 1) } } function attrs(t, a, k, v, q, i, n) { split("", a); sub(/^<[^ \001\/>]*/, "", t); while (1) { sub(/^[ \001\/]+/, "", t); if (t == "" || substr(t, 1, 1) == ">") return; if (n++ >= 128) { odd = 1; return } match(t, /^.[^ \001=\/>]*/); k = tolower(substr(t, 1, RLENGTH)); t = substr(t, RLENGTH + 1); sub(/^[ \001]+/, "", t); v = ""; if (substr(t, 1, 1) == "=") { t = substr(t, 2); sub(/^[ \001]+/, "", t); q = substr(t, 1, 1); if (q == "\"" || q == "\047") { t = substr(t, 2); i = index(t, q); v = i ? substr(t, 1, i - 1) : t; t = i ? substr(t, i + 1) : "" } else { match(t, /^[^ \001>]*/); v = substr(t, 1, RLENGTH); t = substr(t, RLENGTH + 1) } } if (!(k in a)) a[k] = v } } function dec(u, o, h) { if (index(u, "%") == 0) return u; o = ""; while (match(u, /%[0-9A-Fa-f][0-9A-Fa-f]/)) { h = toupper(substr(u, RSTART + 1, 2)); o = o substr(u, 1, RSTART - 1) (h ~ /^(00|23|25|26|2B|2F|3D|3F)$/ ? "%" h : sprintf("%c", hexv(h))); u = substr(u, RSTART + 3) } return o u } function res(u, q, i, h, n, g, k, st, t, hq, sc) { sub(/#.*/, "", u); gsub(/^ +| +$/, "", u); i = index(u, "?"); hq = i > 0; q = i ? substr(u, i) : ""; if (i) u = substr(u, 1, i - 1); sc = bs; if (match(u, /^[a-zA-Z][a-zA-Z0-9+.-]*:/)) { sc = tolower(substr(u, 1, RLENGTH - 1)); t = substr(u, RLENGTH + 1); if (sc != "http" && sc != "https") { RX = sc ":" t q; return 0 } gsub(/\\/, "/", t); if (sc == bs && t !~ /^\/\//) u = t; else { sub(/^\/*/, "", t); u = "//" t } } else gsub(/\\/, "/", u); if (u ~ /^\/\//) { sub(/^\/+/, "", u); i = index(u, "/"); h = i ? substr(u, 1, i - 1) : u; u = i ? substr(u, i) : "/"; sub(/^.*@/, "", h); h = tolower(h); if (sc == "http") sub(/:0*80$/, "", h); else sub(/:0*443$/, "", h); sub(/:$/, "", h); if (h == "" || sc == "") { RX = "!"; return 0 } RO = sc "://" h } else { if (bo == "") { RX = "!"; return 0 } RO = bo; if (u == "") { u = bp; if (!hq) q = bq } else if (u !~ /^\//) u = bd u } n = split(u, g, "/"); k = 0; RT = 0; for (i = 2; i <= n; i++) { t = tolower(g[i]); gsub(/%2e/, ".", t); RT = 1; if (t == "..") { if (k) k-- } else if (t != ".") { st[++k] = g[i]; RT = g[i] == "" } } RP = ""; for (i = 1; i <= k; i++) if (st[i] != "") RP = RP "/" st[i]; RQ = q; return 1 } function setb(u) { if (!res(u)) return; bo = RO; bs = RO; sub(/:.*/, "", bs); bp = RP; bq = RQ; bd = RP; if (RT) bd = bd "/"; else sub(/[^\/]*$/, "", bd) } function clr(v) { v = ent(v); gsub(/[\001\t\n\r]/, "", v); return v } function base(i, a) { for (i = 1; i <= N; i++) if (tolower(substr(T[i], 1, 6)) ~ /^<base[ \001\/]/) { attrs(T[i], a); if ("href" in a) { if (length(a["href"]) > 8192) odd = 1; else setb(clr(a["href"])); return } } } function norm(u, q, n, a, b, i, j, k, t) { if (!res(u)) return RX; q = RQ; u = RO dec(RP); if (q == "") return u; q = substr(q, 2); gsub(/\+/, " ", q); n = split(q, a, "&"); if (n > 256) { big = 1; return "!!" } k = 0; for (i = 1; i <= n; i++) if (a[i] != "") { t = dec(a[i]); if (index(t, "=") == 0) t = t "="; for (j = k++; j > 0 && b[j] > t; j--) b[j + 1] = b[j]; b[j + 1] = t } q = ""; for (i = 1; i <= k; i++) q = q "&" b[i]; return k ? u "?" substr(q, 2) : u } function at(v) { big = 0; if (length(v) > 8192) { unk = 1; return "?" } v = norm(clr(v)); if (big) { unk = 1; return "?" } return v } function load(n, i) { n = split(s, Q, "\001crawlmouse:end "); NP = n - 1; if (NP != np) odd = 1; B[1] = Q[1]; for (i = 2; i <= n; i++) { if (match(Q[i], /^200 [^ \001]+/)) { U[i - 1] = substr(Q[i], 5, RLENGTH - 4); B[i] = substr(Q[i], RLENGTH + 1) } else { odd = 1; U[i - 1] = ""; B[i] = "" } } } function open(i) { if (i > NP) return 0; setb(U[i]); scan(B[i]); base(); return 1 } BEGIN { A = 1; np = ARGV[A++] + 0 } function host(u) { if (!match(u, /^https?:\/\/[^\/?]*/)) return ""; u = substr(u, 1, RLENGTH); sub(/^https?:\/\/(www\.)?/, "", u); return u } BEGIN { mark = dec(ARGV[A++]) } function hrefs(p, to, i, a, u, here) { if (!open(p)) return 0; here = host(U[p]); for (i = 1; i <= N; i++) if (T[i] ~ /^<[aA][ \001\/]/) { attrs(T[i], a); if ("href" in a) { u = at(a["href"]); if (host(u) == here) to[u] = 1 } } return 1 } function differ(u, self, fresh, lost, P1, P2) { if (!hrefs(1, P1) || !hrefs(2, P2)) return 0; self = norm(U[1]); for (u in P2) if (u != self && index(u, mark) == 0 && !(u in P1)) fresh++; for (u in P1) if (u != self && index(u, mark) == 0 && !(u in P2)) lost++; return fresh > 1 && lost > 1 } BEGIN { ARGC = 1 } { s = s $0 } END { load(); exit !(differ() && !odd) }' '2' 'page='
  expect: Exit status 0 once `https://built-site.test/collections/camping-tents?page=2` and `https://built-site.test/collections/camping-tents` each link to two or more site pages the other lacks, list pages aside: a later page that repeats the first has every link the first has. Links stand in for the content hash (measured on the next check): a later page with fewer than two items of its own does not pass, and repeated items go unseen when each page also holds two links of its own. A page that itself prints "crawlmouse:end" does not pass.
```

### `canonical_mismatch`

**Rule.** Context: the canonical the page declares; one sentence per condition the record holds, from the rows it names; and, when no fault of the target is proven and the canonical is not taken to stand, why not. The canonical the packet asks for (`read`, `expectedOf`) comes from rows: the page’s own URL when the target is on another host, gone or disallowed; where the target landed, or the canonical the target declares, when the check holds that page answering 200 at itself and declaring itself or none; otherwise the page’s own URL. With no fault of the target, the canonical stands when the check holds the target answering 200 at itself, and the links move to it. For a target on another host the first step asks whether the canonical is deliberate.

**Exact check.** Passes when the `<head>` of the page holds one `<link rel="canonical">`, naming the expected URL, and, when links move and the programs can tell the two URLs apart (`sameInCommand`), the first linking page links to the canonical and no longer to the page; both are asked by one program. A record of links alone checks the links. Where the declared and the expected URL, or the stale and the kept one, are one URL to the programs (`sameInCommand`), the href is compared as written (`canonicalIs` in its `spelled` mode, `linksSpelled`).

**See it.** The page’s canonical tag; for a record of links alone, the `<a>` tags of the linking page that hold either path.

Run in two states by `packets/by-type/canonical-mismatch.test.ts`.

Limits the packet states:

- If another live URL is the one meant to be indexed, name that one; the command checks for the URL the packet offers (change).
- A link left to open the URL as a variant keeps the command non-zero (change).
- A canonical sent in an HTTP Link header is not read (`expect`).
- The command reads the first linking page: run it for each (`expect`).
- `UNREAD_HREF` (§4), in `expect`.
- When the command cannot tell a link to the one URL from a link to the other, the links are measured on the next check (`expect`).

Open limits:

- Shared, from the list above: **path-end “See it”**.

Not said, because not measured:

- Which URL the site means to have indexed.
- Why the canonical is wrong, and which file or setting writes it.

Documentation cited:

- `nextjs`:
  - [generateMetadata](https://nextjs.org/docs/app/api-reference/functions/generate-metadata), read 2026-11-12. Supports: metadata and generateMetadata are exported from layout.js and page.js, in Server Components; alternates.canonical and its <link rel="canonical"> output; Merging: objects are shallowly merged and nested fields are overwritten by the last segment to define them, shared through a separate variable or the parent argument; metadataBase composes a relative path; "If the page can be prerendered and generateMetadata doesn't introduce dynamic behavior, the resulting metadata is included in the page's initial HTML. Otherwise the metadata resolved from generateMetadata can be streamed"; Streaming metadata: tags appended to the <body>, and in the <head> for HTML-limited bots.
  - [htmlLimitedBots](https://nextjs.org/docs/app/api-reference/config/next-config-js/htmlLimitedBots), read 2026-11-12. Supports: htmlLimitedBots lists the user agents that receive blocking metadata instead of streaming metadata; "Specifying a htmlLimitedBots config will override the Next.js' default list"; the default list includes Google crawlers, Bingbot, Twitterbot and Slackbot.
- Printed in the packet’s own text (`GOOGLE_DOCS.canonical`): https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls

Fixes of this type in the lab fixture: 1. The first, as stored:

```text
title: Correct the canonical of https://built-site.test/products/camping-tents-item-2
frameworks: generic, nextjs
effort: none
before_after: none
context:
  `https://built-site.test/products/camping-tents-item-2` declares `https://built-site.test/products/retired-tent` as its canonical.
  `https://built-site.test/products/retired-tent` answers 404: the page the canonical names is gone.
  2 pages link to `https://built-site.test/products/camping-tents-item-2`, a URL that names another as its canonical: `https://built-site.test/collections/camping-tents`, `https://built-site.test/collections/camping-tents?page=2`.
change (generic):
  Set the rel="canonical" of `https://built-site.test/products/camping-tents-item-2` to its own URL.
  If another live URL of this site is the one meant to be indexed for this content, name that one instead; the command below checks for the page's own URL.
  Write it as one <link rel="canonical"> in the <head>, with an absolute URL. Google accepts the element only in the <head>, and asks for absolute paths (https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls).
keep (generic):
  Keep `https://built-site.test/products/camping-tents-item-2` answering 200 with its content: no redirect is asked for.
  Keep the links to `https://built-site.test/products/camping-tents-item-2`: once it is its own canonical they point at the canonical URL.
See it:
  curl -sS --compressed --max-time 20 -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot' 'https://built-site.test/products/camping-tents-item-2' | tr '\r\n\t' '   ' | grep -aioE '<link [^>]*rel=.?canonical[^>]*>'
  today: The page's canonical tag, which names `https://built-site.test/products/retired-tent`.
  after: The page's canonical tag, naming `https://built-site.test/products/camping-tents-item-2`.
Exact check (ua: OAI-SearchBot):
  curl -sS -f --compressed --max-time 20 -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot' -w '\ncrawlmouse:end %{http_code} %{url_effective}\n' 'https://built-site.test/products/camping-tents-item-2' | tr '\n\t\r\f\000' '\001\001\001  ' | LC_ALL=C awk 'function hexv(h, i, n) { n = 0; h = tolower(h); sub(/^0+/, "", h); if (length(h) > 6) return 0; for (i = 1; i <= length(h); i++) n = n * 16 + index("0123456789abcdef", substr(h, i, 1)) - 1; return n } function chr(n) { if (n < 1 || n > 1114111) n = 65533; if (n < 128) return sprintf("%c", n); if (n < 2048) return sprintf("%c%c", 192 + int(n / 64), 128 + n % 64); if (n < 65536) return sprintf("%c%c%c", 224 + int(n / 4096), 128 + int(n / 64) % 64, 128 + n % 64); return sprintf("%c%c%c%c", 240 + int(n / 262144), 128 + int(n / 4096) % 64, 128 + int(n / 64) % 64, 128 + n % 64) } function ent(v, o, r, e) { if (index(v, "&") == 0) return v; e = " Tab=9 NewLine=10 amp=38 lt=60 gt=62 quot=34 apos=39 nbsp=160 hellip=8230 rarr=8594 larr=8592 raquo=187 laquo=171 mdash=8212 ndash=8211 rsquo=8217 lsquo=8216 rdquo=8221 ldquo=8220 copy=169 reg=174 trade=8482 middot=183 bull=8226 times=215 "; o = ""; while (match(v, /&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[a-zA-Z][a-zA-Z0-9]*;)/)) { r = substr(v, RSTART + 1, RLENGTH - 1); sub(/;$/, "", r); o = o substr(v, 1, RSTART - 1); v = substr(v, RSTART + RLENGTH); if (r ~ /^#[xX]/) o = o chr(hexv(substr(r, 3))); else if (r ~ /^#/) { sub(/^#0*/, "", r); o = o chr(length(r) > 7 ? 0 : r + 0) } else if (match(e, " " r "=[0-9]+ ")) o = o chr(substr(e, RSTART + length(r) + 2, RLENGTH - length(r) - 3) + 0); else { unk = 1; o = o "&" r ";" } } return o v } function tend(t, p, r, q, i, k) { p = 0; while (match(t, /=[ \001]*["\047]|>/)) { if (substr(t, RSTART, 1) == ">") return p + RSTART; if (k++ >= 128) { far = 1; return 0 } q = substr(t, RSTART + RLENGTH - 1, 1); r = substr(t, RSTART + RLENGTH); i = index(r, q); if (!i) return 0; p += RSTART + RLENGTH - 1 + i; t = substr(r, i + 1) } return 0 } function add(t) { if (length(X[N]) < 8192) X[N] = X[N] t; else if (t ~ /[^ \001]/) V[N] = 1 } function scan(s, c, m, i, b, e, j, k) { N = 0; split("", V); m = split(s, c, "<"); X[0] = c[1]; for (i = 2; i <= m; i++) { b = c[i]; if (substr(b, 1, 3) == "!--") { b = substr(b, 4); if (b ~ /^-?>/) { add(substr(b, index(b, ">") + 1)); continue } e = index(b, "-->"); while (!e && i < m) { b = c[++i]; e = index(b, "-->") } if (e) add(substr(b, e + 3)); continue } if (b !~ /^[a-zA-Z\/!?]/) { add("<" b); continue } if (b ~ /^[!?]|^\/[^a-zA-Z]/) { e = index(b, ">"); while (!e && i < m) { b = c[++i]; e = index(b, ">") } if (e) add(substr(b, e + 1)); continue } j = 0; far = 0; while (!(e = tend(b)) && !far && i < m && j++ < 8) b = b "<" c[++i]; if (!e) { odd = far || i < m; break } if (match(tolower(substr(b, 1, 9)), /^(script|style|template|textarea|title)[ \001\/>]/)) { k = "/" substr(b, 1, RLENGTH - 1); e = 0; while (!e && i < m) { b = c[++i]; if (tolower(substr(b, 1, length(k))) == tolower(k) && substr(b, length(k) + 1, 1) ~ /^[ \001\/>]?$/) e = index(b, ">") } if (e) add(substr(b, e + 1)); continue } T[++N] = "<" substr(b, 1, e); X[N] = substr(b, e + 1) } } function attrs(t, a, k, v, q, i, n) { split("", a); sub(/^<[^ \001\/>]*/, "", t); while (1) { sub(/^[ \001\/]+/, "", t); if (t == "" || substr(t, 1, 1) == ">") return; if (n++ >= 128) { odd = 1; return } match(t, /^.[^ \001=\/>]*/); k = tolower(substr(t, 1, RLENGTH)); t = substr(t, RLENGTH + 1); sub(/^[ \001]+/, "", t); v = ""; if (substr(t, 1, 1) == "=") { t = substr(t, 2); sub(/^[ \001]+/, "", t); q = substr(t, 1, 1); if (q == "\"" || q == "\047") { t = substr(t, 2); i = index(t, q); v = i ? substr(t, 1, i - 1) : t; t = i ? substr(t, i + 1) : "" } else { match(t, /^[^ \001>]*/); v = substr(t, 1, RLENGTH); t = substr(t, RLENGTH + 1) } } if (!(k in a)) a[k] = v } } function dec(u, o, h) { if (index(u, "%") == 0) return u; o = ""; while (match(u, /%[0-9A-Fa-f][0-9A-Fa-f]/)) { h = toupper(substr(u, RSTART + 1, 2)); o = o substr(u, 1, RSTART - 1) (h ~ /^(00|23|25|26|2B|2F|3D|3F)$/ ? "%" h : sprintf("%c", hexv(h))); u = substr(u, RSTART + 3) } return o u } function res(u, q, i, h, n, g, k, st, t, hq, sc) { sub(/#.*/, "", u); gsub(/^ +| +$/, "", u); i = index(u, "?"); hq = i > 0; q = i ? substr(u, i) : ""; if (i) u = substr(u, 1, i - 1); sc = bs; if (match(u, /^[a-zA-Z][a-zA-Z0-9+.-]*:/)) { sc = tolower(substr(u, 1, RLENGTH - 1)); t = substr(u, RLENGTH + 1); if (sc != "http" && sc != "https") { RX = sc ":" t q; return 0 } gsub(/\\/, "/", t); if (sc == bs && t !~ /^\/\//) u = t; else { sub(/^\/*/, "", t); u = "//" t } } else gsub(/\\/, "/", u); if (u ~ /^\/\//) { sub(/^\/+/, "", u); i = index(u, "/"); h = i ? substr(u, 1, i - 1) : u; u = i ? substr(u, i) : "/"; sub(/^.*@/, "", h); h = tolower(h); if (sc == "http") sub(/:0*80$/, "", h); else sub(/:0*443$/, "", h); sub(/:$/, "", h); if (h == "" || sc == "") { RX = "!"; return 0 } RO = sc "://" h } else { if (bo == "") { RX = "!"; return 0 } RO = bo; if (u == "") { u = bp; if (!hq) q = bq } else if (u !~ /^\//) u = bd u } n = split(u, g, "/"); k = 0; RT = 0; for (i = 2; i <= n; i++) { t = tolower(g[i]); gsub(/%2e/, ".", t); RT = 1; if (t == "..") { if (k) k-- } else if (t != ".") { st[++k] = g[i]; RT = g[i] == "" } } RP = ""; for (i = 1; i <= k; i++) if (st[i] != "") RP = RP "/" st[i]; RQ = q; return 1 } function setb(u) { if (!res(u)) return; bo = RO; bs = RO; sub(/:.*/, "", bs); bp = RP; bq = RQ; bd = RP; if (RT) bd = bd "/"; else sub(/[^\/]*$/, "", bd) } function clr(v) { v = ent(v); gsub(/[\001\t\n\r]/, "", v); return v } function base(i, a) { for (i = 1; i <= N; i++) if (tolower(substr(T[i], 1, 6)) ~ /^<base[ \001\/]/) { attrs(T[i], a); if ("href" in a) { if (length(a["href"]) > 8192) odd = 1; else setb(clr(a["href"])); return } } } function norm(u, q, n, a, b, i, j, k, t) { if (!res(u)) return RX; q = RQ; u = RO dec(RP); if (q == "") return u; q = substr(q, 2); gsub(/\+/, " ", q); n = split(q, a, "&"); if (n > 256) { big = 1; return "!!" } k = 0; for (i = 1; i <= n; i++) if (a[i] != "") { t = dec(a[i]); if (index(t, "=") == 0) t = t "="; for (j = k++; j > 0 && b[j] > t; j--) b[j + 1] = b[j]; b[j + 1] = t } q = ""; for (i = 1; i <= k; i++) q = q "&" b[i]; return k ? u "?" substr(q, 2) : u } function at(v) { big = 0; if (length(v) > 8192) { unk = 1; return "?" } v = norm(clr(v)); if (big) { unk = 1; return "?" } return v } function load(n, i) { n = split(s, Q, "\001crawlmouse:end "); NP = n - 1; if (NP != np) odd = 1; B[1] = Q[1]; for (i = 2; i <= n; i++) { if (match(Q[i], /^200 [^ \001]+/)) { U[i - 1] = substr(Q[i], 5, RLENGTH - 4); B[i] = substr(Q[i], RLENGTH + 1) } else { odd = 1; U[i - 1] = ""; B[i] = "" } } } function open(i) { if (i > NP) return 0; setb(U[i]); scan(B[i]); base(); return 1 } BEGIN { A = 1; np = ARGV[A++] + 0 } function hd(i, ns, t) { for (i = 1; i <= N; i++) { t = tolower(substr(T[i], 1, 12)); if (t ~ /^<noscript[ \001\/>]/) ns = 1; else if (t ~ /^<\/noscript[ \001\/>]/) ns = 0; else if (!ns && t !~ /^<\/?(html|head|base|link|meta)[ \001\/>]/) return i - 1; if (!ns && (X[i] ~ /[^ \001]/ || (i in V))) return i } return N } function spelt(u) { if (!res(u)) return RX; return RO RP "" (RT ? "/" : "") RQ } BEGIN { want = norm(ARGV[A]); ws = RT; wx = spelt(ARGV[A++]); how = ARGV[A++] + 0 } function canon(p, i, a, h, c, u, found) { if (!open(p)) return 0; h = hd(); for (i = 1; i <= h; i++) if (tolower(substr(T[i], 1, 6)) ~ /^<link[ \001\/]/) { attrs(T[i], a); gsub(/\001/, " ", a["rel"]); gsub(/^ +| +$/, "", a["rel"]); if (tolower(a["rel"]) == "canonical") { c++; unk = 0; u = at(a["href"]); if (u == want && (how < 1 || RT == ws) && (how < 2 || (!unk && spelt(clr(a["href"])) == wx))) found = 1 } } return c == 1 && found } BEGIN { ARGC = 1 } { s = s $0 } END { load(); exit !(canon(1) && !odd) }' '1' 'https://built-site.test/products/camping-tents-item-2' '0'
  expect: Exit status 0 once the <head> of `https://built-site.test/products/camping-tents-item-2` holds one <link rel="canonical">, naming `https://built-site.test/products/camping-tents-item-2`, however the URL is written. Today it names `https://built-site.test/products/retired-tent`. A canonical sent in an HTTP Link header is not read. A page that itself prints "crawlmouse:end" does not pass.
change (nextjs):
  These steps are for the App Router (the app directory). There the tag comes from alternates.canonical in the metadata export, or in generateMetadata, of the page.js of the route or of a layout.js above it.
  Set the rel="canonical" of `https://built-site.test/products/camping-tents-item-2` to its own URL.
  If another live URL of this site is the one meant to be indexed for this content, name that one instead; the command below checks for the page's own URL.
  Metadata objects are merged shallowly: a segment that sets alternates replaces the whole alternates object of the layouts above it. If a layout sets alternates.languages, media or types, carry them into the object you write (share them from one module, or read the parent's resolved metadata from the second argument of generateMetadata), or the page loses those tags.
  Give an absolute URL, or a path with metadataBase set in the root layout: Next.js composes the two.
  When a page cannot be prerendered, or its generateMetadata introduces dynamic behavior, Next.js can send the metadata tags after the first HTML, appended to the <body>; user agents on its list of HTML-limited bots get them in the <head>. The command below reads the <head>. Either make the page one that can be prerendered, with a generateMetadata that introduces no dynamic behavior, or extend the default list: a value for htmlLimitedBots in the Next.js config overrides the default list, so repeat the default bots in it and add the crawler the command requests as.
keep (nextjs):
  Keep `https://built-site.test/products/camping-tents-item-2` answering 200 with its content: no redirect is asked for.
  Keep the links to `https://built-site.test/products/camping-tents-item-2`: once it is its own canonical they point at the canonical URL.
  Keep the other fields of alternates the page has today (languages, media, types).
```

### `hreflang_gap`

**Rule.** Context: the cluster’s key, its crawled members and the members marked; one sentence per condition the record holds, saying “It” with one marked page and “At least one of them” with more; the invalid values, read from the marked pages’ rows with the detector’s `isValidHreflang`; Google’s hreflang page. Change: the same full set on each page, then a step per condition. An x-default is called recommended, not required.

**Exact check.** On the first marked page (`needsOf`, `hreflangHolds`): passes when its `<head>` lists the page under a value with the form of a language code, holds no value of another form, names the members that name it and that it does not name back, no longer carries its invalid values or the alternates that redirect or are gone, and holds an `x-default` when the record proves one missing. The builder throws when that page’s annotations were not read.

**See it.** The page’s `<link … hreflang …>` tags. `today` lists the tags as the crawl read them, up to a bound.

Run in two states by `packets/by-type/hreflang-gap.test.ts`.

Limits the packet states:

- Google recommends an x-default and does not require one; the audit keeps the fix open until one is present, so the command asks for it (`expect`).
- It reads `<link>` elements in the `<head>`; annotations in an HTTP Link header or a sitemap are not read, no alternate is requested, and a value is checked for its form, not against the registry of codes (`expect`).
- The command reads the first of the pages marked (`expect`).
- When the URLs and values do not fit the command’s length, how many it leaves out (`expect`).

Not said, because not measured:

- Which marked page carries which condition, when more than one is marked.

Documentation cited:

- `nextjs`:
  - [generateMetadata](https://nextjs.org/docs/app/api-reference/functions/generate-metadata), read 2026-11-12. Supports: metadata and generateMetadata are exported from layout.js and page.js, in Server Components; alternates.languages and its <link rel="alternate" hreflang> output; Merging: objects are shallowly merged and nested fields are overwritten by the last segment to define them, shared through a separate variable or the parent argument; "If the page can be prerendered and generateMetadata doesn't introduce dynamic behavior, the resulting metadata is included in the page's initial HTML. Otherwise the metadata resolved from generateMetadata can be streamed"; Streaming metadata: tags appended to the <body>, and in the <head> for HTML-limited bots.
  - [htmlLimitedBots](https://nextjs.org/docs/app/api-reference/config/next-config-js/htmlLimitedBots), read 2026-11-12. Supports: htmlLimitedBots lists the user agents that receive blocking metadata instead of streaming metadata; "Specifying a htmlLimitedBots config will override the Next.js' default list"; the default list includes Google crawlers, Bingbot, Twitterbot and Slackbot.
- Printed in the packet’s own text (`GOOGLE_DOCS.hreflang`): https://developers.google.com/search/docs/specialty/international/localized-versions

Fixes of this type in the lab fixture: 1. The first, as stored:

```text
title: Complete the hreflang annotations of https://built-site.test/blog/tent-care-guide
frameworks: generic, nextjs
effort: none
before_after: none
context:
  The hreflang annotations join `https://built-site.test/blog/tent-care-guide` and 1 other crawled page into one cluster. 1 of the 2 carries a defect: `https://built-site.test/blog/tent-care-guide-fr`.
  It is named as an alternate by another page of the cluster and does not name that page back. Google ignores annotations that do not point both ways.
  It has no x-default annotation. Google recommends one and does not require it.
  Google's rules for hreflang: https://developers.google.com/search/docs/specialty/international/localized-versions
change (generic):
  Give every page of the cluster the same full set of annotations: one <link rel="alternate" hreflang="…" href="…"> in the <head> for each language version, the page itself included, each with an absolute URL.
  Where one page names another, make the other name it back.
  Add an x-default annotation to each page, naming the page for visitors whose language none of the others matches. Google recommends it and does not require it; the audit's fix stays open until each page has one.
keep (generic):
  Keep each page at its URL, and keep the annotations of the pages that carry no defect in step with the ones you change: every page lists the same set.
See it:
  curl -sS --compressed --max-time 20 -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot' 'https://built-site.test/blog/tent-care-guide-fr' | tr '\r\n\t' '   ' | grep -aioE '<link [^>]*hreflang[^>]*>'
  today: The page's 1 hreflang tag, as the crawl read it: `fr` for `https://built-site.test/blog/tent-care-guide-fr`.
  after: A tag that names `https://built-site.test/blog/tent-care-guide-fr` under its own language code, an x-default tag, a tag for `https://built-site.test/blog/tent-care-guide`.
Exact check (ua: OAI-SearchBot):
  curl -sS -f --compressed --max-time 20 -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot' -w '\ncrawlmouse:end %{http_code} %{url_effective}\n' 'https://built-site.test/blog/tent-care-guide-fr' | tr '\n\t\r\f\000' '\001\001\001  ' | LC_ALL=C awk 'function hexv(h, i, n) { n = 0; h = tolower(h); sub(/^0+/, "", h); if (length(h) > 6) return 0; for (i = 1; i <= length(h); i++) n = n * 16 + index("0123456789abcdef", substr(h, i, 1)) - 1; return n } function chr(n) { if (n < 1 || n > 1114111) n = 65533; if (n < 128) return sprintf("%c", n); if (n < 2048) return sprintf("%c%c", 192 + int(n / 64), 128 + n % 64); if (n < 65536) return sprintf("%c%c%c", 224 + int(n / 4096), 128 + int(n / 64) % 64, 128 + n % 64); return sprintf("%c%c%c%c", 240 + int(n / 262144), 128 + int(n / 4096) % 64, 128 + int(n / 64) % 64, 128 + n % 64) } function ent(v, o, r, e) { if (index(v, "&") == 0) return v; e = " Tab=9 NewLine=10 amp=38 lt=60 gt=62 quot=34 apos=39 nbsp=160 hellip=8230 rarr=8594 larr=8592 raquo=187 laquo=171 mdash=8212 ndash=8211 rsquo=8217 lsquo=8216 rdquo=8221 ldquo=8220 copy=169 reg=174 trade=8482 middot=183 bull=8226 times=215 "; o = ""; while (match(v, /&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[a-zA-Z][a-zA-Z0-9]*;)/)) { r = substr(v, RSTART + 1, RLENGTH - 1); sub(/;$/, "", r); o = o substr(v, 1, RSTART - 1); v = substr(v, RSTART + RLENGTH); if (r ~ /^#[xX]/) o = o chr(hexv(substr(r, 3))); else if (r ~ /^#/) { sub(/^#0*/, "", r); o = o chr(length(r) > 7 ? 0 : r + 0) } else if (match(e, " " r "=[0-9]+ ")) o = o chr(substr(e, RSTART + length(r) + 2, RLENGTH - length(r) - 3) + 0); else { unk = 1; o = o "&" r ";" } } return o v } function tend(t, p, r, q, i, k) { p = 0; while (match(t, /=[ \001]*["\047]|>/)) { if (substr(t, RSTART, 1) == ">") return p + RSTART; if (k++ >= 128) { far = 1; return 0 } q = substr(t, RSTART + RLENGTH - 1, 1); r = substr(t, RSTART + RLENGTH); i = index(r, q); if (!i) return 0; p += RSTART + RLENGTH - 1 + i; t = substr(r, i + 1) } return 0 } function add(t) { if (length(X[N]) < 8192) X[N] = X[N] t; else if (t ~ /[^ \001]/) V[N] = 1 } function scan(s, c, m, i, b, e, j, k) { N = 0; split("", V); m = split(s, c, "<"); X[0] = c[1]; for (i = 2; i <= m; i++) { b = c[i]; if (substr(b, 1, 3) == "!--") { b = substr(b, 4); if (b ~ /^-?>/) { add(substr(b, index(b, ">") + 1)); continue } e = index(b, "-->"); while (!e && i < m) { b = c[++i]; e = index(b, "-->") } if (e) add(substr(b, e + 3)); continue } if (b !~ /^[a-zA-Z\/!?]/) { add("<" b); continue } if (b ~ /^[!?]|^\/[^a-zA-Z]/) { e = index(b, ">"); while (!e && i < m) { b = c[++i]; e = index(b, ">") } if (e) add(substr(b, e + 1)); continue } j = 0; far = 0; while (!(e = tend(b)) && !far && i < m && j++ < 8) b = b "<" c[++i]; if (!e) { odd = far || i < m; break } if (match(tolower(substr(b, 1, 9)), /^(script|style|template|textarea|title)[ \001\/>]/)) { k = "/" substr(b, 1, RLENGTH - 1); e = 0; while (!e && i < m) { b = c[++i]; if (tolower(substr(b, 1, length(k))) == tolower(k) && substr(b, length(k) + 1, 1) ~ /^[ \001\/>]?$/) e = index(b, ">") } if (e) add(substr(b, e + 1)); continue } T[++N] = "<" substr(b, 1, e); X[N] = substr(b, e + 1) } } function attrs(t, a, k, v, q, i, n) { split("", a); sub(/^<[^ \001\/>]*/, "", t); while (1) { sub(/^[ \001\/]+/, "", t); if (t == "" || substr(t, 1, 1) == ">") return; if (n++ >= 128) { odd = 1; return } match(t, /^.[^ \001=\/>]*/); k = tolower(substr(t, 1, RLENGTH)); t = substr(t, RLENGTH + 1); sub(/^[ \001]+/, "", t); v = ""; if (substr(t, 1, 1) == "=") { t = substr(t, 2); sub(/^[ \001]+/, "", t); q = substr(t, 1, 1); if (q == "\"" || q == "\047") { t = substr(t, 2); i = index(t, q); v = i ? substr(t, 1, i - 1) : t; t = i ? substr(t, i + 1) : "" } else { match(t, /^[^ \001>]*/); v = substr(t, 1, RLENGTH); t = substr(t, RLENGTH + 1) } } if (!(k in a)) a[k] = v } } function dec(u, o, h) { if (index(u, "%") == 0) return u; o = ""; while (match(u, /%[0-9A-Fa-f][0-9A-Fa-f]/)) { h = toupper(substr(u, RSTART + 1, 2)); o = o substr(u, 1, RSTART - 1) (h ~ /^(00|23|25|26|2B|2F|3D|3F)$/ ? "%" h : sprintf("%c", hexv(h))); u = substr(u, RSTART + 3) } return o u } function res(u, q, i, h, n, g, k, st, t, hq, sc) { sub(/#.*/, "", u); gsub(/^ +| +$/, "", u); i = index(u, "?"); hq = i > 0; q = i ? substr(u, i) : ""; if (i) u = substr(u, 1, i - 1); sc = bs; if (match(u, /^[a-zA-Z][a-zA-Z0-9+.-]*:/)) { sc = tolower(substr(u, 1, RLENGTH - 1)); t = substr(u, RLENGTH + 1); if (sc != "http" && sc != "https") { RX = sc ":" t q; return 0 } gsub(/\\/, "/", t); if (sc == bs && t !~ /^\/\//) u = t; else { sub(/^\/*/, "", t); u = "//" t } } else gsub(/\\/, "/", u); if (u ~ /^\/\//) { sub(/^\/+/, "", u); i = index(u, "/"); h = i ? substr(u, 1, i - 1) : u; u = i ? substr(u, i) : "/"; sub(/^.*@/, "", h); h = tolower(h); if (sc == "http") sub(/:0*80$/, "", h); else sub(/:0*443$/, "", h); sub(/:$/, "", h); if (h == "" || sc == "") { RX = "!"; return 0 } RO = sc "://" h } else { if (bo == "") { RX = "!"; return 0 } RO = bo; if (u == "") { u = bp; if (!hq) q = bq } else if (u !~ /^\//) u = bd u } n = split(u, g, "/"); k = 0; RT = 0; for (i = 2; i <= n; i++) { t = tolower(g[i]); gsub(/%2e/, ".", t); RT = 1; if (t == "..") { if (k) k-- } else if (t != ".") { st[++k] = g[i]; RT = g[i] == "" } } RP = ""; for (i = 1; i <= k; i++) if (st[i] != "") RP = RP "/" st[i]; RQ = q; return 1 } function setb(u) { if (!res(u)) return; bo = RO; bs = RO; sub(/:.*/, "", bs); bp = RP; bq = RQ; bd = RP; if (RT) bd = bd "/"; else sub(/[^\/]*$/, "", bd) } function clr(v) { v = ent(v); gsub(/[\001\t\n\r]/, "", v); return v } function base(i, a) { for (i = 1; i <= N; i++) if (tolower(substr(T[i], 1, 6)) ~ /^<base[ \001\/]/) { attrs(T[i], a); if ("href" in a) { if (length(a["href"]) > 8192) odd = 1; else setb(clr(a["href"])); return } } } function norm(u, q, n, a, b, i, j, k, t) { if (!res(u)) return RX; q = RQ; u = RO dec(RP); if (q == "") return u; q = substr(q, 2); gsub(/\+/, " ", q); n = split(q, a, "&"); if (n > 256) { big = 1; return "!!" } k = 0; for (i = 1; i <= n; i++) if (a[i] != "") { t = dec(a[i]); if (index(t, "=") == 0) t = t "="; for (j = k++; j > 0 && b[j] > t; j--) b[j + 1] = b[j]; b[j + 1] = t } q = ""; for (i = 1; i <= k; i++) q = q "&" b[i]; return k ? u "?" substr(q, 2) : u } function at(v) { big = 0; if (length(v) > 8192) { unk = 1; return "?" } v = norm(clr(v)); if (big) { unk = 1; return "?" } return v } function load(n, i) { n = split(s, Q, "\001crawlmouse:end "); NP = n - 1; if (NP != np) odd = 1; B[1] = Q[1]; for (i = 2; i <= n; i++) { if (match(Q[i], /^200 [^ \001]+/)) { U[i - 1] = substr(Q[i], 5, RLENGTH - 4); B[i] = substr(Q[i], RLENGTH + 1) } else { odd = 1; U[i - 1] = ""; B[i] = "" } } } function open(i) { if (i > NP) return 0; setb(U[i]); scan(B[i]); base(); return 1 } BEGIN { A = 1; np = ARGV[A++] + 0 } function hd(i, ns, t) { for (i = 1; i <= N; i++) { t = tolower(substr(T[i], 1, 12)); if (t ~ /^<noscript[ \001\/>]/) ns = 1; else if (t ~ /^<\/noscript[ \001\/>]/) ns = 0; else if (!ns && t !~ /^<\/?(html|head|base|link|meta)[ \001\/>]/) return i - 1; if (!ns && (X[i] ~ /[^ \001]/ || (i in V))) return i } return N } BEGIN { need = ARGV[A++]; self = norm(ARGV[A++]); nm = ARGV[A++]; for (i = 0; i < nm; i++) must[norm(ARGV[A++])] = 1; ng = ARGV[A++]; for (i = 0; i < ng; i++) { gone[ARGV[A]] = 1; gone[norm(ARGV[A++])] = 1 } } function langs(p, i, a, h, v, u, m, own, fallback, bad) { if (!open(p)) return 0; h = hd(); for (i = 1; i <= h; i++) { if (tolower(substr(T[i], 1, 6)) !~ /^<link[ \001\/]/) continue; attrs(T[i], a); gsub(/\001/, " ", a["rel"]); v = length(a["hreflang"]) > 8192 ? "?" : ent(a["hreflang"]); if (v == "" || (" " tolower(a["rel"]) " ") !~ / alternate /) continue; u = at(a["href"]); if (tolower(v) == "x-default") fallback = 1; else if (tolower(v) !~ /^[a-z][a-z](-[a-z][a-z][a-z][a-z])?(-[a-z][a-z])?$/) bad = 1; else if (u == self) own = 1; delete must[u]; if (v in gone || u in gone) bad = 1 } for (m in must) bad = 1; return own && (fallback || !need) && !bad } BEGIN { ARGC = 1 } { s = s $0 } END { load(); exit !(langs(1) && !odd) }' '1' '1' 'https://built-site.test/blog/tent-care-guide-fr' '1' 'https://built-site.test/blog/tent-care-guide' '0'
  expect: Exit status 0 once `https://built-site.test/blog/tent-care-guide-fr` lists itself under a value with the form of a language code and holds an x-default, and carries no value of another form. Only <link> elements in the <head> are read, no Link header or sitemap; no alternate is requested; a value's form is checked, not the registry of codes. A page that itself prints "crawlmouse:end" does not pass. It must name `https://built-site.test/blog/tent-care-guide`.
change (nextjs):
  These steps are for the App Router (the app directory). There the annotations come from alternates.languages (a map from hreflang value to URL) in the metadata export, or in generateMetadata, of the page.js of the route or of a layout.js above it.
  Give every page of the cluster the same full set of annotations: one <link rel="alternate" hreflang="…" href="…"> in the <head> for each language version, the page itself included, each with an absolute URL.
  Where one page names another, make the other name it back.
  Metadata objects are merged shallowly: a segment that sets alternates replaces the whole alternates object of the layouts above it. Where a page sets alternates.languages, carry the layout's alternates.canonical, media and types into the same object (share them from one module, or read the parent's resolved metadata from the second argument of generateMetadata), or the page loses its canonical.
  When a page cannot be prerendered, or its generateMetadata introduces dynamic behavior, Next.js can send the metadata tags after the first HTML, appended to the <body>; user agents on its list of HTML-limited bots get them in the <head>. The command below reads the <head>. Either make the page one that can be prerendered, with a generateMetadata that introduces no dynamic behavior, or extend the default list: a value for htmlLimitedBots in the Next.js config overrides the default list, so repeat the default bots in it and add the crawler the command requests as.
  The Next.js page cited shows no x-default among the keys of alternates.languages: for that annotation, follow the generic rewrite and confirm the tag in the HTML served.
keep (nextjs):
  Keep each page at its URL, and keep the annotations of the pages that carry no defect in step with the ones you change: every page lists the same set.
  Keep the other fields of alternates each page has today (canonical, media, types).
```

## 6. The `client_rendered_template` detector

`detectRendered` (`detectors/rendered.ts`) gives one record per template key present in the check: a template with a graded page (`isGraded`) or an empty-root page (a crawled page `emptyRoot` holds for, `render/empty-root.ts`). Its verdict reads the deciding renders (`PageResult.without_js`): the rendered graded pages of a template that has any, and only for a template with no graded page its rendered empty-root pages. It reads the render step’s `state` for a page and defines no threshold of its own. The lines `state` is drawn on (`render/state.ts`): a page is an `empty_shell` below a text share of 0.3 (`EMPTY_SHELL_BELOW`), stays one until its share rises above 0.45 (`EMPTY_SHELL_LEAVES_ABOVE`), and is `readable` from 0.8 (`READABLE_FROM`).

The detector’s verdict on a template of 4 graded pages, computed when this document is rendered. The reasons it can give (`RENDERED_INDETERMINATE_REASONS`): `not_rendered`, `pages_disagree`, `template_absent`.

| Rendered pages, by `state`                          | Record          | Reason                                                                                                      | Fix opens | Confidence  |
| --------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------- | --------- | ----------- |
| `empty_shell`, `empty_shell`                        | `detected`      |                                                                                                             | yes       | `confirmed` |
| `empty_shell`                                       | `detected`      |                                                                                                             | yes       | `likely`    |
| `readable`, `partial`                               | `not_detected`  |                                                                                                             | no        |             |
| `empty_shell`, `readable`                           | `indeterminate` | `pages_disagree`: some rendered pages are empty shells and some are not                                     | no        |             |
| none rendered                                       | `indeterminate` | `not_rendered`: no page of the template was rendered                                                        | no        |             |
| no page present; an awaiting fix names the template | `indeterminate` | `template_absent`: an awaiting fix names the template, and the check has no graded or empty-root page of it | no        |             |

- Key: `shell:<template_key>`. `measured` is the median `text_share` of the rendered pages.
- Scope (Q5, CC-32 D2): a route that serves an empty root is classed `thin` and is not graded; it is an empty-root page, so its template is present and gets a record, and the empty-root phase renders up to two of its pages (`render/empty-root.ts`). A template with a graded page is judged on its graded renders alone, so its verdict and confidence are what they were before CC-32: with no graded page rendered it reads `not_rendered`, whatever its empty-root pages show. A template of empty-root pages alone has no graded page, so its fix moves no grade: its effect is 0.
- Every crawled template of empty-root pages now gets a record, `not_rendered` while production renders nothing. So the check that first detects it writes no `opened` change row: the diff writes one for a new fix only when the previous check measured the fingerprint, and a fingerprint the previous check reported indeterminate was not measured (`diff/diff.ts` `measuredBefore`). Graded templates follow the same rule.
- Listed in `DETECTORS_RUN` (build/diff.ts): `client_rendered_template` yes, `js_only_navigation` yes.
- Effect (grade/effects.ts `applyFix`): the `text_share` of every graded page of the template becomes 1, rendered this check or not; only Readable moves. The share it sets is `SERVER_RENDERED_SHARE`, 1.
- Outcome (grade/outcomes.ts): section `without_js`; recommendation class `best_practice` (`RENDERED_CLASS`); confidence `confirmed` when 2 (`PAGES_PER_FIX_TEMPLATE`) or more of the template’s present pages were rendered, or each of them was, and `likely` otherwise (`renderedConfidence`); `template_key` set, which the graded phase reads to render up to that many graded pages of an open fix’s template on the next check. Title for `/guides/{slug}`: “Serve the text of guides without JavaScript”.
- A template an awaiting fix names (`open`, `reopened`, `marked_done`) with no graded and no empty-root page in the check gets an `indeterminate` record, reason `template_absent` (Q10, CC-32 D3), so the fix is measured again and the lifecycle's rule for an indeterminate record applies: it does not close by itself. The record is not stored as such: a fix keeps `last_state` `indeterminate`, and `gone` holds a page's 404 or 410 only, so the dashboard cannot tell a gone template from one not rendered. An awaiting fix whose `template_key` is null cannot be named by template: it gets no record and the diff leaves it as it was. The detector opens every fix with its record's template key.
- `js_only_navigation` (`detectors/js-only-navigation.ts`, CC-32 D6) has the same population, deciding pages and `template_absent` rule (the templates its own awaiting fixes name). A deciding page is evidence when it was measured and its render outcome carries `links` with neither side truncated (`render/links.ts`); its JS-only targets are its rendered side's same-site targets less its static side's. Detected when every evidence page has one, not detected when none has, `pages_disagree` otherwise, and `not_rendered` when no deciding page is evidence. Key: `jsnav:<template_key>`; the evidence keeps each page's count and its first 20 targets. Effect: each evidence page links in its HTML to the JS-only targets its record keeps that the crawl holds as pages, through `addEdge`, so anchor diversity leaves those links out; a target the crawl never fetched adds no page. `js_only` stays false on every page and edge. Section `structure`, class and confidence as above. Title for `/guides/{slug}`: “Put the links of guides in the HTML”. No packet (CC-32 Q7).

## 7. Effort and before/after

Effort (`packets/effort.ts` `EFFORT_RULES`; `effortOf` returns the rule of the record’s type). One line per distinct rule, with the fix types that share it:

- `robots_txt_blocks_crawler`, `js_only_navigation`: no effort. The engine opens no fix of this type, so there is no effort to state.
- `edge_rule_blocks_crawler`: no effort. One rule at the edge. The record names the crawler and the pages the rule holds on, and nothing about where the rule is kept or how long changing it takes.
- `client_rendered_template`, `quotable_opening`, `specs_as_images`, `missing_schema_description`, `no_question_headings`, `missing_author_date`, `duplicate_pagination`: `{"kind":"templates","templates":1,"deploys":1}`. The record names one template (its template key: `template_key`, or the subject of its key for a paginated list), so the change is to one template, and a change to one template ships in one deploy.
- `orphan_pages`, `generic_anchor_text`, `deep_pages`, `redirect_chain`, `canonical_mismatch`, `hreflang_gap`: no effort. An edit to one page or to the links that point at it. The record holds no measure of how long that takes, and a number of minutes would be an estimate nobody measured.

Before and after (`packets/before-after.ts` `BEFORE_AFTER_RULES`). `packets/before-after.same-code.test.ts` replaces `servedAll` and `allPassing` with functions that change nothing and requires the rows to say nothing changes.

- `robots_txt_blocks_crawler`, `js_only_navigation`: rows none. No row. The engine opens no fix of this type.
- `edge_rule_blocks_crawler`: rows `crawlers_reading_text`. A row only for an AI crawler (the registry’s `ai_search` and `ai_training` groups) whose verdict for the site is `blocked_by_ua_rule`: one already counted has no before and after, and one kept out by something else is not let in by this fix alone. Today: the AI crawlers whose verdict for the site is `allowed`, the count the fix page prints against the AI crawlers tested. After: one more, because the counterfactual serves the crawler, `allowed`, on the pages the rule blocked it on (`servedAll`); `approx`, because what those pages serve the crawler is what the blocked requests could not show.
- `client_rendered_template`: rows `words_without_js`, `text_share`. From the template’s rendered pages (`evidence.pages`). Words without JavaScript: today the median `raw_words`, after the median `rendered_words`, each rounded to a whole word, `approx` because a server render need not hold the same words a browser shows. Text share: today the record’s `measured` (the median share), after 1, `approx` for the same reason. No row for crawlers reading the text: the fix’s counterfactual changes the text share and no crawler’s verdict.
- `orphan_pages`, `deep_pages`: rows none. No row. The fix changes the links to a page, and the contract's four measures (words without JavaScript, crawlers reading the text, a quotable opening, the text share) do not measure that.
- `quotable_opening`: rows `quotable_opening`. A yes or no for a page the fix names. Today: no, since each page it names fails the check (`extent.failing`). After: yes, since the counterfactual passes each failing page (`allPassing`: passing + failing = the pages decided), which is also what the fix landing means, so the bound is `exact`. Pages the check could not read (`extent.unread`) are not spoken for.
- `generic_anchor_text`: rows none. No row. The fix changes the text of links, and the contract's four measures (words without JavaScript, crawlers reading the text, a quotable opening, the text share) do not measure that.
- `specs_as_images`: rows none. No row. The fix changes how specifications are given, which the content check answers with a pass or a fail, and the contract's four measures (words without JavaScript, crawlers reading the text, a quotable opening, the text share) do not measure that.
- `missing_schema_description`: rows none. No row. The fix changes schema.org markup, which the content check answers with a pass or a fail, and the contract's four measures (words without JavaScript, crawlers reading the text, a quotable opening, the text share) do not measure that.
- `no_question_headings`: rows none. No row. The fix changes section headings, which the content check answers with a pass or a fail, and the contract's four measures (words without JavaScript, crawlers reading the text, a quotable opening, the text share) do not measure that.
- `missing_author_date`: rows none. No row. The fix changes the byline and the date, which the content check answers with a pass or a fail, and the contract's four measures (words without JavaScript, crawlers reading the text, a quotable opening, the text share) do not measure that.
- `redirect_chain`: rows none. No row. The fix changes where links point, and the contract's four measures (words without JavaScript, crawlers reading the text, a quotable opening, the text share) do not measure that.
- `duplicate_pagination`: rows none. No row. The fix changes the later pages of a paginated list, and the contract's four measures (words without JavaScript, crawlers reading the text, a quotable opening, the text share) do not measure that.
- `canonical_mismatch`: rows none. No row. The fix changes a canonical annotation, and the contract's four measures (words without JavaScript, crawlers reading the text, a quotable opening, the text share) do not measure that.
- `hreflang_gap`: rows none. No row. The fix changes hreflang annotations, and the contract's four measures (words without JavaScript, crawlers reading the text, a quotable opening, the text share) do not measure that.

## 8. Stack detection

The worker records, for the homepage, `stack_signals: { cms, detected_from, frontend_markers }`: a CMS name from `detectCms`, a fixed text naming the source, and the names of the front-end markers its reader found (`packages/worker/src/reader/frontend-markers.ts`; `FrontendMarker`: `next_static_path`, `next_data_script`, `shopify_theme_object`, `shopify_section_class`, `hydrogen_powered_by_header`, `wp_content_path`, `webflow_site_attribute`). The field holds no HTML and not which CMS signal matched. `stackOf` (`build/record.ts`) writes `frontend` as the first of Shopify Hydrogen (`hydrogen_powered_by_header`), then Next.js (`next_static_path`, `next_data_script`), then Shopify Liquid (`shopify_theme_object`, `shopify_section_class`) that a recorded marker names, the CMS as `backend` unless it is `custom`, and `edge` from `edgeOf`. A row written before the worker recorded markers has none, and names no front end. `frameworkOf` (`packets/stack.ts`) chooses the first body: `stack.frontend.framework` when a front end was detected, else `FRAMEWORK_OF_CMS`:

| CMS         | First body  | Builders with that body         |
| ----------- | ----------- | ------------------------------- |
| `wordpress` | `wordpress` | `missing_author_date`           |
| `webflow`   | `webflow`   | none: the generic body is first |

A Shopify store is not in the table: the CMS name does not say whether the front end is a Liquid theme or Hydrogen. Its markers can, when the homepage carries one.

A CMS outside the table, and a site with none recognised, get the generic body first; the other bodies are offered by the switch. Held by `packets/stack.test.ts`.

The signals behind those CMS names (`packages/engine/src/cms-detection/signatures.ts`). One matching signal is enough for `detectCms` to name the CMS. Each signal, and what it also matches:

- `wordpress`, HTML, `\/wp-content\/`. Matched anywhere in the homepage HTML, on any host. A headless WordPress whose front end is another framework still links its media under `/wp-content/uploads/`; so does a page that embeds a file from another site’s WordPress.
- `wordpress`, HTML, `\/wp-includes\/`. The same matcher: any URL in the HTML that holds the path.
- `wordpress`, HTML, `\/wp-json\/`. Any URL that holds the path: a front end that links to, or calls, a WordPress REST API.
- `wordpress`, HTML, `<meta\s+name=["']generator["']\s+content=["']WordPress`. A generator tag with `name` before `content`. A front end that prints the tag of the CMS behind it matches.
- `wordpress`, header `x-pingback`, `xmlrpc\.php`. A response header of the homepage whose value holds `xmlrpc.php`. A proxy that passes a WordPress origin’s headers through sends it for a page another front end rendered.
- `webflow`, HTML, `data-wf-(?:page|site)=`. An attribute Webflow writes, matched as text anywhere in the HTML: a page that prints the attribute in a code sample matches.
- `webflow`, HTML, `<meta\s+name=["']generator["']\s+content=["']Webflow`. A generator tag with `name` before `content`.
- `webflow`, HTML, `assets(?:-global)?\.website-files\.com`. An asset host. A page on another platform that loads one file from it matches.
- `webflow`, HTML, `cdn\.prod\.website-files\.com`. An asset host, as above.
- `webflow`, HTML, `uploads-ssl\.webflow\.com`. An asset host, as above.
- `webflow`, header `server`, `^Webflow$`. The `server` response header, matched whole against `Webflow`.

Consequence of a false match: the first body is that CMS’s where a builder has one, on a site whose front end is something else. The context and the verify block do not depend on the stack.

Markers recorded that name no front end: `wp_content_path`, `webflow_site_attribute`. `FRAMEWORK_OF_CMS` reads the WordPress and Webflow framework from the CMS instead.

## 9. Voice (D10)

Reference: the hand-written packets of `apps/web/lib/fixtures/v2/bad-site.json` (`fixes[].packet`). Engine: `packages/engine/fixtures/v2/build/expected.json`, the first fix of a type. Which types are compared comes from iterating the two files: a type is compared when both hold a packet for it.

- In both files: `edge_rule_blocks_crawler`, `orphan_pages`, `deep_pages`, `redirect_chain`, `duplicate_pagination`, `canonical_mismatch`, `hreflang_gap`.
- A hand-written packet and no engine packet in the lab fixture: `robots_txt_blocks_crawler`, `client_rendered_template`, `quotable_opening`, `generic_anchor_text`, `specs_as_images`, `missing_author_date`, `js_only_navigation`.
- An engine packet in the lab fixture and no hand-written one: `missing_schema_description`.
- In neither: `no_question_headings`.

Per type, values read from the two files as hand-written / engine. “Characters” is the length of context, change, keep, both commands and their texts in the first body. The sentences under each are written in spec.ts (`VOICE`).

#### `edge_rule_blocks_crawler`

- Hand-written command: `curl -s -o /dev/null -w "%{http_code}" -A "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot" https://example-outfitter.com/`
- `ua`: GPTBot / ClaudeBot. “See it”: none / yes. Effort: `{"kind":"minutes","minutes":10}` / none. Bodies: 1 / 1. Characters: 1034 / 2496.
- Hand-written says: Names the product, the dashboard path, a rule by its name and its expression. More than one crawler in one packet. The command prints the status for the reader to compare with “200 (today: 403)”.
- Engine says: One crawler per fix. States the pages refused of the pages sampled, the status tally, the identity that was served, and that the request was tagged. Names no product: the lab check recorded no edge vendor. The first step asks whether the crawler should be let in. “See it” prints the status; the exact check exits 0 on a 200 with no challenge header.
- Why they differ: The record holds no rule name, expression or dashboard location.
- Where the engine is weaker: “Find the rule” where the hand-written packet points at it. No effort is stated.

#### `orphan_pages`

- Hand-written command: `crawl, then count internal links into each of the 7 pages`
- `ua`: none / OAI-SearchBot. “See it”: none / yes. Effort: `{"kind":"minutes","minutes":20}` / none. Bodies: 1 / 1. Characters: 666 / 9591.
- Hand-written says: Several pages in one packet, grouped by edit, with a CMS admin path, component files and a cause (a draft flag). The proof is “crawl, then count”.
- Engine says: One page per fix: the crawled pages that answered 200 and do not link to it, one suggested parent with how it was ranked and how far it is from the homepage, and commands that read the parent for the link.
- Why they differ: The detector reports one record per page, and the record holds no file, CMS state or cause.
- Where the engine is weaker: A site with several orphans gets as many packets of one link. A packet does not say why its page is unlinked, and pages that share an edit are not grouped.

#### `deep_pages`

- Hand-written command: `crawl, then measure click depth for the 3 pages`
- `ua`: none / OAI-SearchBot. “See it”: none / yes. Effort: none / none. Bodies: 1 / 1. Characters: 182 / 9661.
- Hand-written says: Several pages in one sentence; “link each from its collection page, or from the footer”. The proof is “crawl, then measure click depth”.
- Engine says: One page per fix: its clicks or that no path reaches it, a page to link from with why that one, and commands that read that page for the link. `expect` says the depth is measured on the next check.
- Why they differ: Depth is a property of the whole graph; a `curl` reads one page.
- Where the engine is weaker: The page it names is chosen on the crawl’s links, not by an editor; the change says another page as close does as well. The command does not prove the depth.

#### `redirect_chain`

- Hand-written command: `crawl, then follow the link`
- `ua`: none / OAI-SearchBot. “See it”: none / yes. Effort: none / none. Bodies: 1 / 1. Characters: 147 / 10314.
- Hand-written says: One sentence of context, one of change. The proof is “crawl, then follow the link”.
- Engine says: The linking pages, the hops with status and Location, where the chain ends, the edit per linking page, “See it” printing the links, and an exact check that reads the first linking page for the new target and the absence of the old.
- Why they differ: The check’s row for the URL holds the hops.
- Where the engine is weaker: Longer. The commands cover the first linking page and ask the reader to run them for the others.

#### `duplicate_pagination`

- Hand-written command: `crawl the collections`
- `ua`: none / OAI-SearchBot. “See it”: none / yes. Effort: none / `{"kind":"templates","templates":1,"deploys":1}`. Bodies: 1 / 1. Characters: 160 / 9937.
- Hand-written says: Describes collection pages that answer with and without `?page=1`, and a redirect as the fix. The proof is “crawl the collections”.
- Engine says: Later pages that repeat their first page: by a canonical set to the first page, or by near-identical content. A step per condition, and commands on the first later page.
- Why they differ: The two describe different defects. The engine’s detector does not report the hand-written case: `firstPageOf('https://a.test/c?page=1')` gives `null` when this document is rendered.
- Where the engine is weaker: The content part of the exact check is a proxy (links, not text), and `expect` says the hash is measured on the next check.

#### `canonical_mismatch`

- Hand-written command: `curl -s https://example-outfitter.com/products/ridge-2p | grep -o 'rel="canonical"[^>]*'`
- `ua`: none / OAI-SearchBot. “See it”: none / yes. Effort: none / none. Bodies: 1 / 2. Characters: 311 / 10097.
- Hand-written says: More than one page in one packet. Names a file and the cause (the canonical is built from the first collection). The command prints the tag for the reader to compare with “the page’s own URL”.
- Engine says: One page per fix: the declared canonical, what the crawl found at it, the canonical read from the rows as the one to set, “See it” printing the tag, and an exact check that exits 0 when the head holds one canonical naming it. A Next.js body cites `alternates.canonical`.
- Why they differ: The record holds no file and no cause.
- Where the engine is weaker: It does not say why the canonical is wrong. The page’s own URL is offered as the default, which is a reading of intent the change labels as one.

#### `hreflang_gap`

- Hand-written command: `crawl the hreflang pairs`
- `ua`: none / OAI-SearchBot. “See it”: none / yes. Effort: none / none. Bodies: 1 / 2. Characters: 167 / 10536.
- Hand-written says: One page and one missing return tag, in a sentence of context and one of change. The proof is “crawl the hreflang pairs”.
- Engine says: The cluster, the marked pages, a sentence and a step per condition held, the full reciprocal set as the target, “See it” printing the tags the crawl read, and an exact check on the first marked page.
- Why they differ: The record holds the cluster’s conditions as a union.
- Where the engine is weaker: With more than one marked page it says “At least one of them”: it does not say which page carries which defect.

#### Across the types

The hand-written packets name files, dashboard paths, rule names and causes, and group pages that share an edit. The records (`packets/types.ts` `RecordOf`) have no field for those, so a builder has nothing to say them from. The engine’s packets are longer, state their sample, and carry a command to read beside the one that exits by status. Hand-written commands among the compared types that do not start with `curl`: `orphan_pages`, `deep_pages`, `redirect_chain`, `duplicate_pagination`, `hreflang_gap`.

One page of the lab fixture has an orphan fix and a deep fix. The two packets name the same page to link from (the first step of the orphan packet, the second of the deep one):

```text
Add a link to `https://built-site.test/products/forgotten-lantern` on `https://built-site.test/products/camp-kitchen-item-1`. The audit ranks the content pages on this host that do not link here yet by the words their title, link texts and URL path share with this page's, and suggests the first; on a tie, the lower URL.
No other page links to this one, and the audit's fix for that suggests `https://built-site.test/products/camp-kitchen-item-1`, a page that close: one link there settles both. The estimate for this fix was computed with the link on `https://built-site.test/blog/choosing-tent-pegs`; any page as close does as well.
```

## 10. Owner rulings on the packets’ text

From `rulings.md` (2026-11-12), after the owner read the sample packets.

- **Ruling 1: the verify block must be readable.** The layers of §4. Engine: each structure builder’s test has a case titled “shows … with a command to read, and what it prints today and after” (for one, `packets/by-type/canonical-mismatch.test.ts` “shows the canonical with a command to read, and what it prints today and after”); the content builders share `packets/test-support/content.ts` “prints the evidence: without it before the fix, as `today` says, and with it after, as `after` says”; `packets/edge-rule-blocks-crawler.test.ts` “the readable command prints the status: the audit’s today, 200 once served”; `packets/client-rendered-template.test.ts` “the readable command prints a rough count: not below the audit’s today, higher by the gained words once fixed”. Web: `apps/web/lib/v2/view/fix.test.ts` “shows “See it” above “Exact check” in each body’s block, from that body”; `apps/web/lib/v2/view/segment/fixes.test.ts` “shows “See it” above “Exact check” for a packet with a readable command, from its own body”; `apps/web/__tests__/v2/fix.test.tsx` “shows “See it” with what it prints today and after the fix, then “Exact check””. Round 3 found readable commands that print nothing on common markup: the open limits of §5.
- **Ruling 2: a count of 1 takes the singular.** Structure: `expectOwnWords` (`packets/test-support/structure.ts`) is applied by `packetOf`, through which the structure tests build their packets, and to the packets of `packets/structure-fuzz.test.ts` “write a packet the contract accepts for every record a detector reports as detected”; plus `packets/by-type/redirect-chain.test.ts` “takes the singular at one redirect and at one linking page” and `packets/by-type/generic-anchor-text.test.ts` “takes the singular at one link”. Content: `packets/test-support/content.ts` “says 1 of anything in the singular”. Edge and rendered: `packets/edge-rule-blocks-crawler.test.ts` “says 1 of anything in the singular: each count at 1 and at 2 (property)”; `packets/client-rendered-template.test.ts` “says 1 of anything in the singular: each count at 1 and at 2 (property)”. The fix page’s own words: `apps/web/__tests__/v2/fix-words.test.tsx`.
- **Ruling 3: no internal identifier in rendered text.** A cause and a check are said in words (the lists at the end of §4). Structure: `expectOwnWords`, which looks outside code spans. Content: the suite “no identifier of ours in the text” in `packets/test-support/content.ts`. Edge: `packets/edge-rule-blocks-crawler.test.ts` “says the cause %s in words”. Rendered: `packets/client-rendered-template.test.ts` “shows no identifier of ours: every value is said in words”. The fix page’s own words: `apps/web/__tests__/v2/fix-words.test.tsx`.
- **Ruling 4** (timestamps in the step’s `status.md`) concerns the notes, not the code.

## 11. Review record

Tier A: a technical-SEO, a security and a correctness reviewer, each on a frozen commit. Scores out of 10, as the reports in the step’s `reviews/` give them.

- Round 1, frozen `2a2486b4`: technical SEO 5, security 5, correctness 6.5.
- Round 2, frozen `07987f9f`: technical SEO 7, security 7, correctness 6.5.
- Round 3, frozen `9d1ed7f9`: technical SEO 8, security 8, correctness 8.

Round 3’s technical-SEO report has no blocking finding; what it left open is under the types in §5 and in ruling 2 above.

The 8 mutations the brief requires, as round 2’s correctness review ran them at `07987f9f`, each on a harness first proven live with an unconditional throw (the step’s `r2-correctness/mutations.md`). They were not run again for this document; rendering it checks that each file exists and that each test title is still in its file.

- **1.** A packet names a URL its record does not hold. Changed: `packets/by-type/redirect-chain.ts`. Red: `packets/by-type/redirect-chain.test.ts` “points the links at the final URL and keeps the redirect”. The structure tests that went red compare exact text. The content builders have a property for it, “names no URL its record does not hold” (packets/test-support/content.ts); the structure builders have none.
- **2.** A verify command that passes on the broken fixture (`linksTo` ignores the stale link; `canonicalIs` accepts any canonical). Changed: `packets/html-checks.ts`. Red: `packets/html-checks.test.ts` “passes on the new target only when the old one is gone”; `packets/html-checks.test.ts` “fails on two canonicals, one in the body, one commented out, another URL, or none”.
- **3.** A framework listed with no body. Changed: `packets/compose.ts`. Red: `packets/compose.test.ts` “gives a packet the contract accepts, inside its size bound, listing a framework only with its body”.
- **4.** A hostile path adds a line to the packet (`clean` keeps a line break). Changed: `clean-text.ts`. Red: `packets/text.test.ts` “removes a line break, a bidirectional mark and a zero-width space, and swaps a backtick”; `packets/text.test.ts` “leaves nothing crawled outside a code span, and adds no line (property)”.
- **5.** The registry is missing a type. Changed: `packets/registry.ts`. Red: `packets/registry.test.ts` “has an entry for each fix type of the contract and no other”. Also a compile error: `tsc --noEmit` reported TS2741 on `PACKETS`.
- **6.** D6 opens a fix on a template that was not rendered. Changed: `detectors/rendered.ts`. Red: `detectors/rendered.test.ts` “cannot decide when no page of the template was rendered”.
- **7.** A locked packet present in the page’s HTML. Changed: `apps/web/lib/v2/view/fix.ts`. Red: `apps/web/lib/v2/view/fix.test.ts` “never reads a locked fix’s packet”; `apps/web/__tests__/v2/fix.test.tsx` “puts no body of a locked fix that holds several in the page”.
- **8.** `after` computed by a second formula. Changed: `packets/before-after.ts`. Red: `packets/before-after.same-code.test.ts` “the edge fix writes no row: the blocked pages stay blocked, so no crawler is added”; `packets/before-after.same-code.test.ts` “the opening is still not quotable: the failing pages stay failing”. A third form survived: `SERVER_RENDERED_SHARE` replaced by the literal 1 in the text-share row. It changes nothing while the constant is 1, and no test ties the row to the constant.

## 12. Questions and the owner’s answers

Open, each with the recommendation that was acted on:

- **Q2.** The worker recorded a CMS name and no front-end marker, so Next.js, Liquid and Hydrogen were not told apart. Acted on: `stack.frontend` stayed null and the first body followed the CMS. Done in CC-32 D5: the additive worker field of §8.
- **Q3.** `js_only_navigation` needed the rendered side’s links, which the render step did not keep. Acted on: the type stayed unopened with its reason in the registry. Done in CC-32 D6: the render step keeps the same-site link targets of both sides, and the type opens (§6).
- **Q4.** `effort` is a label field, so a fix first found before this step keeps `effort: null` until it resolves and reopens. Acted on: the diff is left alone. Proposed, if such fixes exist in production: take `effort` in the diff when the stored one is null.
- **Q5.** A route that serves an empty root is thin, not graded and not rendered, so a pure-shell site gets no `client_rendered_template` fix, and rendering thin pages alone would give one an effect of 0. Acted on: the fix opens on what the render step measured (§6). For the owner: whether the graded population should change is an OPERATING-RULES §5 question.
- **Pagination and D3.** The near-duplicate half of the `duplicate_pagination` exact check can exit 0 on an unfixed site (§5, its open limit). Acted on: kept, disclosed in `expect`, here and in the PR text. For the owner: accept it as an exception to D3, or have the packet carry no exact check for that condition.
- **Q9.** Edits outside the allowed paths: `packets_not_written` in `build/summaries.ts`; the exports `PACKETS` and `frameworkOf` in `pipeline-surface.ts`; the locked-fix scan in `tests/visual/production.spec.ts`; and `clean-text.ts` outside `packets/`. Acted on: kept. The owner approved them (`rulings-3.md`).
- **Q10.** An open client-rendered fix can go stale: a template that loses its graded pages gets no record, the diff reads that as absent, and the fix stays open on old evidence. Not fixed here (the diff is outside this step). Proposed: the detector emits `indeterminate` for a template an open fix names. The owner agreed and logged it as a follow-up (`rulings-3.md`).

Approved by the owner:

- **Q1.** One added argument at the call of `detectorOutcomes` in `build/grade.ts`, the rendered detector called beside the others there, and one line in `DETECTORS_RUN` (`build/diff.ts`). Approved as acted on (`rulings.md`).
- **Q6.** Web files outside the brief’s list, edited where the chosen body, the prompt and the not-written reason are produced: `apps/web/lib/v2/view/segment/fixes.ts`, `apps/web/lib/v2/account/fixes.ts`, `apps/web/lib/v2/view/no-packet.ts`. Approved as acted on (`rulings.md`).
- **Q7.** The fix title holds crawled text and is the first line of the copied prompt: `titleOf` cleans it and bounds it at `MAX_TITLE_CHARS`. Approved as acted on (`rulings.md`).
- **Q8.** The required, nullable `verify.see`: the owner-approved non-additive change of §4 (`rulings-2.md`).
