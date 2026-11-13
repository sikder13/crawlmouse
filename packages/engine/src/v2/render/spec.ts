/**
 * Renders docs/specs/v2/14-render.md from the render module's own constants and lists, so the spec
 * cannot name a number or a rule the code does not hold. spec.test.ts fails when the file differs.
 */
import { code, pct, table } from '../detectors/spec.js';
import { CAP_ENV } from './budget.js';
import { CHALLENGE_MARKERS, CHALLENGE_TITLE_ENDINGS, CHALLENGE_TITLES } from './challenge.js';
import {
  BROWSER_RUN,
  ENV,
  MAX_REPLY_BYTES,
  RENDER_TIMEOUT_MS,
  RENDER_USER_AGENT,
  RENDER_VIEWPORT,
  RENDER_WAIT_UNTIL,
  REQUEST_TIMEOUT_MS,
  STATIC_JS_OFF_SHOWN_LIVE,
} from './client.js';
import { PARITY_SPREAD, REPEAT_SPREAD } from './parity.js';
import {
  REJECTED_HOSTS,
  REJECTED_HOSTS_AS_OF,
  REJECTED_RESOURCE_TYPES,
  STATIC_REJECTED_RESOURCE_TYPES,
  LIVE_PROBED_RULES,
  PATTERNS_SHOWN_LIVE,
  URL_RULES,
} from './policy.js';
import {
  IN_FLIGHT_ENV,
  NOT_RENDERED,
  RENDER_IN_FLIGHT_DEFAULT,
  RENDER_IN_FLIGHT_MAX,
  RENDER_RETRY,
  RESERVE_PER_RENDER_MS,
} from './run.js';
import { EMPTY_ROOT_MAX_RENDERS, EMPTY_ROOT_PER_TEMPLATE } from './empty-root.js';
import { MAX_RENDER_LINKS } from './links.js';
import { MAX_URL_LENGTH } from '../batch-bounds.js';
import { MAX_JS_ONLY_TARGETS } from '../detectors/js-only-navigation.js';
import { FREE_MAX_RENDERS, PAGES_PER_FIX_TEMPLATE } from './sample.js';
import { EMPTY_SHELL_BELOW, EMPTY_SHELL_LEAVES_ABOVE, READABLE_FROM } from './state.js';
import { BOUNDARY_ELEMENTS } from './words.js';

export const SPEC_URL = new URL('../../../../../docs/specs/v2/14-render.md', import.meta.url);

const list = (xs: readonly string[]) => xs.map(code).join(', ');
const seconds = (ms: number) => `${ms / 1000} s`;

export function renderRenderSpec(): string {
  const sections = [
    `# SPEC 14 — Rendering and the words a page serves without JavaScript

> Generated from \`packages/engine/src/v2/render\` by \`pnpm --filter @crawlmouse/engine exec tsx src/v2/render/write-spec.ts\`.
> \`pnpm --filter @crawlmouse/engine exec vitest run src/v2/render\` fails when this file differs from what the code renders.
> What the code computes is held to offline tests there. What Browser Run does with the request is held
> only by \`live.test.ts\`, which needs a token; this build has not run it.

This step measures; it grades nothing. For each page it renders it produces \`PageResult.without_js\`
(\`raw_words\`, \`rendered_words\`, \`text_share\`, \`state\`), and for the check the estimate behind
\`Check.without_js.site_text_share\`. The call that runs it is CC-20's; the grade that reads it is CC-17's.`,

    `## The two renders of a page

Both sides of a page are renders by Cloudflare Browser Run's REST \`/content\` endpoint, from the same
network, with the same request but for one field:

${table(
  ['Setting', 'Value'],
  [
    ['Endpoint', code(BROWSER_RUN.endpoint)],
    ['User agent', code(RENDER_USER_AGENT)],
    ['Viewport', `${RENDER_VIEWPORT.width} × ${RENDER_VIEWPORT.height}`],
    ['Wait', `${code(RENDER_WAIT_UNTIL)}, capped at ${seconds(RENDER_TIMEOUT_MS)}`],
    ['Refused on both sides', list(REJECTED_RESOURCE_TYPES)],
    ['Refused on the static side', list(STATIC_REJECTED_RESOURCE_TYPES)],
    ['JavaScript on the static side', 'off (`setJavaScriptEnabled: false`)'],
    ['Request timeout, reply included', seconds(REQUEST_TIMEOUT_MS)],
    ['Largest reply read', `${MAX_REPLY_BYTES / 1024 / 1024} MiB`],
  ],
)}

Refusing the \`script\` resource type is documented to stop script files from loading. A script
written inline in the HTML is not a request, so the static side also sends
\`setJavaScriptEnabled: false\`: were an inline script to run there, the text it writes would count
on both sides and raise the share, reading a page that needs JavaScript as one that does not.
Cloudflare documents that field for \`/snapshot\` (read ${BROWSER_RUN.read_on}); the \`/content\` page
does not name it. ${
      STATIC_JS_OFF_SHOWN_LIVE === null
        ? '**Whether `/content` honours it is unproven:** no passing run of the live inline-script probe (below) is recorded here. If it shows the setting ignored, the static side moves to `/snapshot`, where it is documented. If `/content` refuses the field instead, each static side comes back as a failure (`api_error`, `page_failed` or `bad_reply`, depending on the reply) and no page is measured; the probe fails on that too, since it expects a 200.'
        : `The live inline-script probe (below) showed \`/content\` honouring it on ${STATIC_JS_OFF_SHOWN_LIVE}, with the page sent as \`html\`.`
    }

The user agent is the one the v2 fixtures record on their \`identity_role: render\` rows. Browser Run's
documentation (automatic request headers, read ${BROWSER_RUN.read_on}) says it adds headers a request
cannot remove that name it as Browser Run's (\`cf-brapi-request-id\`, \`Signature-agent\`), so the user
agent does not hide what the request is.

Both sides are counted by one function: \`extractMainContent\` on the HTML, then runs of non-space
characters. Before that, a space is written before each opening and closing tag of ${BOUNDARY_ELEMENTS.length} elements a
browser lays out as their own block, line or box (\`p\`, \`div\`, \`li\`, \`td\`, \`button\`, \`br\` and the
rest in \`words.ts\`), because the extractor joins text nodes as they are and markup a script builds
usually has no whitespace between its tags. Text in adjacent inline elements with nothing between them
(\`<span>a</span><span>b</span>\`) stays one word, as a browser shows it. \`chars\` stay with the thin gate;
nothing here uses them.

The crawl worker's served-text word count (\`AccessTest.word_count\`) is a different measure, from a
different request and a different extractor. It is not \`raw_words\`, and must not be shown next to
the share as if it were.`,

    `## Browser Run, as documented

Read on ${BROWSER_RUN.read_on}; the limits page was last updated ${BROWSER_RUN.limits_updated}. Cloudflare
renamed Browser Rendering to Browser Run on 2026-04-15; the token variable keeps the old name.

${table(
  ['Limit (Workers Paid)', 'Value'],
  [
    ['Quick Actions requests per second', String(BROWSER_RUN.requests_per_second)],
    ['Browser timeout', `${BROWSER_RUN.browser_timeout_s} s`],
    ['Longest `gotoOptions.timeout`', `${BROWSER_RUN.max_goto_timeout_s} s`],
    ['Price', `$${BROWSER_RUN.usd_per_browser_hour} per browser-hour`],
    ['Included', `${BROWSER_RUN.included_browser_hours_per_month} browser-hours a month`],
    ['Browser time per request', `the ${code(BROWSER_RUN.browser_ms_header)} reply header`],
  ],
)}`,

    `## What the browser may request

The browser runs on Cloudflare, so our code is not asked about each request a page makes. Every render
sends the resource types above and the URL patterns below for Browser Run to enforce, as its
documentation describes (\`rejectResourceTypes\`, \`rejectRequestPattern\`). **By design, sub-requests are
filtered by these patterns, not by per-request interception in our process.** Each pattern is sent as
the regular expression's source, with no slashes. The live policy probe (below) showed that form
applied on ${PATTERNS_SHOWN_LIVE}: the rules it covers, ${list(LIVE_PROBED_RULES)}, each refused a request
while the twin requests loaded. It does not cover ${list(URL_RULES.map((r) => r.name).filter((n) => !(LIVE_PROBED_RULES as readonly string[]).includes(n)))}, and a host rule is
shown for one host of its list, not each. Sent
wrapped in slashes, as this build first did and as one of the documentation's examples shows, none
was refused. \`policy.test.ts\` pins the form.

**WebSockets are not stopped (known limit).** On ${PATTERNS_SHOWN_LIVE} the probe's WebSocket opened with
the \`websocket\` resource type refused and with the \`scheme\` rule, which matches \`wss:\`, sent. No
setting found here stops it. The browser runs on Cloudflare's network, not ours, so where a page
opens one the connection leaves from Cloudflare. Text a page received over one would count on the
rendered side; the probe saw the connection open, not text arrive.

${table(
  ['Rule', 'Refuses'],
  URL_RULES.map((r) => [code(r.name), r.refuses]),
)}

Hosts are matched by name. A sub-request to a public name that resolves to a private address matches
no rule and loads; it loads on Cloudflare's network, not ours.

The host lists are a reject-list, compiled by hand on ${REJECTED_HOSTS_AS_OF} from what was known of each
vendor's embed snippet, not fetched from the vendors or taken from a maintained block list, so it misses
hosts. A host missing here loads like any other script.

${table(
  ['List', 'Hosts (and their subdomains)'],
  REJECTED_HOSTS.map((l) => [l.name, list(l.hosts)]),
)}

**Why a reject-list.** \`text_share\` is static words over rendered words. A script the browser may not
load cannot add words, so each script blocked by mistake shrinks the rendered side and raises the
share: a page that needs JavaScript reads as one that does not. An allow-list of script origins does
that to each site whose own JavaScript is served from a CDN under another name. So the hosts refused
are those whose scripts are usually not the page's content. Usually: a tag manager can inject text, and
its words are then missing from the rendered side.

**Downloads** are refused by path ending, in any case. A download a server signals with
\`Content-Disposition\` on an ordinary path is not refused by a pattern; the \`/content\` reply is
documented to carry the page's HTML only, and nothing is written to our disk.

**Admission.** The navigation URL is checked in our process before anything is sent: it is refused
when a pattern above matches it, since Browser Run would block it anyway (so a page on a listed host
is not rendered), and then the host is resolved and a private or reserved address is refused
(\`validateUrlOrThrow\`). Admission is a parameter of the render; the caller can pass the project's URL
admission instead. The resolution happens in our process and the browser resolves the name again on
Cloudflare, possibly to another address, so the default is a defence, not a guarantee.

**Redirects.** The \`/content\` reply carries the HTML only: no final URL and no status code, so
admitting the URL a redirect ends on is not possible with this endpoint. A redirect's target is not
admitted in our process, and whether Browser Run applies the patterns to it is not verified here.`,

    `## Challenge pages

A render has no status code or headers, only HTML, so a challenge is read from that alone. A side is
taken for a challenge page when its title is one of ${list(CHALLENGE_TITLES)} (whole, trimmed, any case),
or ends with ${list(CHALLENGE_TITLE_ENDINGS)}, or its HTML contains one of ${list(CHALLENGE_MARKERS)}. The
worker reads body text only on a 403 or 503; without a status, a fragment that also appears on ordinary
pages would mark them challenged, so Cloudflare's \`/cdn-cgi/challenge-platform/\` path, which it loads
on pages it serves normally, is not a marker here, and neither is "just a moment" in body text. A page
that merely quotes a marker is taken for a challenge and not measured. A block page these do not
recognise, served to both sides, has the same words on both and reads as share 1.`,

    `## One page

\`text_share\` = \`raw_words\` / \`rendered_words\`, clamped to 1 when the static side shows more words.
A page whose rendered side has no words, or either of whose sides is taken for a challenge page, has
no share: it is not rendered, with the reason.

${table(
  ['Share', 'No previous state, or previous partial/readable', 'Previous state `empty_shell`'],
  [
    [`below ${EMPTY_SHELL_BELOW}`, '`empty_shell`', '`empty_shell`'],
    [`${EMPTY_SHELL_BELOW} to ${EMPTY_SHELL_LEAVES_ABOVE}`, '`partial`', '`empty_shell`'],
    [`above ${EMPTY_SHELL_LEAVES_ABOVE}, below ${READABLE_FROM}`, '`partial`', '`partial`'],
    [`${READABLE_FROM} and above`, '`readable`', '`readable`'],
  ],
)}

The \`empty_shell\` line carries hysteresis (DECISION-LOG B7) because a client-rendered fix opens on it:
a page in that state stays in it until its share rises above ${EMPTY_SHELL_LEAVES_ABOVE}. The
partial/readable line at ${READABLE_FROM} has none.`,

    `## Which pages are rendered

A check renders in two phases, the graded phase and then the empty-root phase, each a pure function of
the crawl (and, for the graded phase, the site's open client-rendered fixes) and its cap.

### The graded phase

A page can be picked when it is graded (a ${code('content')} page that answered 200 with HTML) and the crawl fetched it
as our crawler under our robots.txt group; a page robots.txt disallows to us is not rendered. Picks are
made in this order until the cap (${FREE_MAX_RENDERS} on Free, passed by the caller):

1. ${PAGES_PER_FIX_TEMPLATE} pages of each template with an open client-rendered fix, templates by key;
2. one page of each other template, largest template first;
3. the highest-PageRank pages not yet picked.

Within a template, pages go by PageRank; ties go by URL or template key, and a URL listed twice is
taken once, under the template key that sorts first. When the cap is below what covering each template
needs, some templates get no render; the estimate then says "K of T templates" and Readable reports a
range.

### The empty-root phase

An empty-root page answered 200 with HTML, v1's classifier classed it \`thin\`, and v1's JS detector
read the bytes the crawl fetched as an app shell (\`content_features.client_rendered\`). It is not
graded, so the graded phase never picks it. The pool is every crawled page, not the access sample.
The picks are the empty-root pages ordered by template key, then PageRank (highest first), then URL,
at most ${EMPTY_ROOT_PER_TEMPLATE} of a template (\`EMPTY_ROOT_PER_TEMPLATE\`) and ${EMPTY_ROOT_MAX_RENDERS} in all
(\`EMPTY_ROOT_MAX_RENDERS\`), less any URL the graded phase took. A URL listed twice is taken once,
and not at all when any listing of it is not an empty-root page. An open fix's template is not put
first here: the order is by key alone.

The phase runs after the graded phase has settled (below), so the graded phase's pages, and the
estimate, which is drawn from them alone, are what they would be with no empty-root page in the crawl.
It comes last in the budget too: its allowance is the per-check browser time the graded phase left,
not render slots. So on a large site whose graded renders are fast the empty-root phase still renders,
and where the graded phase uses the time, no empty-root page renders and a template of empty-root
pages alone reads \`not_rendered\`. An empty-root page's \`without_js\` is written to its
\`PageResult\`. The \`client_rendered_template\` detector reads it only for a template with no graded
page: a template with a graded page is judged on its graded renders alone, as before. It reaches
neither the site estimate nor Readable, which read graded pages only.`,

    `## The links of a rendered page

A measured page's outcome also carries \`links\`: the same-site link targets of its static side and of
its rendered side (\`links.ts\`, CC-32 D6). One extractor reads both sides, the crawl's own (extract.ts
\`extractPage\`, share actions and media files left out), so each target is in \`canonicalizeUrl\`'s
spelling. A target is kept when it is on the page's own site by the crawl planner's rule
(\`inSiteScope\`: the page's host or its \`www.\` twin, on the default port), is not the page itself, and
is at most ${MAX_URL_LENGTH} characters. Each side keeps at most ${MAX_RENDER_LINKS} targets
(\`MAX_RENDER_LINKS\`), the first in sorted order, once each. \`truncated\` is set when either side had
more, or had a target past the URL bound.

The lists stay on the render outcome, which the pipeline keeps as evidence; they are never written to
\`PageResult.without_js\`, whose stored shape holds the four keys above. A page whose links cannot be read
keeps its measurement and carries no \`links\`, and so does every page of an outcome stored before this.
The \`js_only_navigation\` detector (detectors/js-only-navigation.ts) reads them: a page's JS-only targets
are its rendered side's less its static side's, and a page with a truncated side, or with no \`links\`, is
not evidence. A record keeps at most ${MAX_JS_ONLY_TARGETS} of a page's targets.`,

    `## The site estimate

\`\`\`text
ratio(t)        = median text_share of template t's measured pages
site_text_share = Σ_t pages(t) × ratio(t) / Σ_t pages(t), over templates with a measured page
unrendered      = graded pages in templates with no measured page / graded pages
Readable range  = 30 × site_text_share × (1 − unrendered)  to  that + 30 × unrendered
\`\`\`

\`pages(t)\` is t's graded pages, the weight CC-17's Readable uses, and graded pages robots.txt kept from
the render count in it. A template with no measured page is left out of the share, not guessed at;
\`unrendered\` (the field \`unrendered_share\`) says how much of the graded site that leaves out; a
template whose pages were rendered but none measured counts in it. When nothing was measured there is no
share, \`unrendered\` is 1 and the range is 0 to 30. \`single_render_weight\` is the part of the share's
weight resting on templates with one measured page, whose ratio is one page's share.

The label reads "estimated from N measured pages across K of T templates", then, where each is above
zero, "X % of graded pages are in templates with no measured page" and "Y % of the estimate's weight
rests on one measured page per template". A template with no measured page includes one whose renders
failed or came back challenged. A part above zero is printed as "<1 %" rather than "0 %"
(\`estimate.test.ts\`).`,

    `## Cost and limits

${table(
  ['Variable', 'Meaning'],
  [
    [code(ENV.account), 'Cloudflare account id'],
    [code(ENV.token), 'API token with the `Browser Run - Edit` permission'],
    [code(CAP_ENV.perCheck), 'browser-seconds one check may use'],
    [code(CAP_ENV.perDay), 'browser-seconds all checks may use in a day'],
    [
      code(IN_FLIGHT_ENV),
      `requests one check keeps open at once, 1 to ${RENDER_IN_FLIGHT_MAX}; otherwise ${RENDER_IN_FLIGHT_DEFAULT}`,
    ],
  ],
)}

Without both credentials nothing renders (\`not_configured\`). Each cap is a whole number of seconds;
unset, empty or anything else reads as zero, and a cap that is not a positive finite number renders
nothing (\`caps_not_configured\`). The count of what today has used lives in the caller's store.

**Today's budget is asked once per phase**, before any of the phase's pages, to reserve the phase's
allowance against the per-day value. The graded phase's allowance is the check's cap, or
${seconds(2 * RESERVE_PER_RENDER_MS)} for each of its pages, whichever is less; the empty-root phase's is
what the cap leaves after the graded phase counted, or ${seconds(2 * RESERVE_PER_RENDER_MS)} for each of its
pages, whichever is less. When the budget refuses, no page of the phase renders and each is
\`daily_cap\`; when it throws, each is \`daily_budget_unavailable\`, and admission is not run for any of
them. A phase whose allowance is below one page's ${seconds(2 * RESERVE_PER_RENDER_MS)} does not ask, and each
of its pages is \`check_cap\`. When it grants, the budget is settled once, after the phase's last page
has finished, at the browser time the phase counted; a settle that throws is returned as
\`settle_failed\`, and the day may still count the whole allowance, depending on the store. So a day with
room for some pages of a phase but not its allowance renders none of that phase. When the budget
refused the graded phase or threw, the empty-root phase does not ask it, and each of its pages carries
the graded phase's reason. A refusal by the budget, or a page Browser Run fails, in the empty-root
phase reaches only that phase's pages. If a page throws out of the render, the other pages of its
phase go on, taking and rendering the phase's pages left in the queue; once all have finished, the
budget is settled at what the phase counted. A throw in the graded phase is then passed on, so the
check's results are discarded and the empty-root phase does not run; a throw in the empty-root phase
leaves each of its pages \`phase_threw\`, and the graded phase's pages stand.

Within a phase, before a page starts it reserves both of its renders at ${seconds(RESERVE_PER_RENDER_MS)} each
from the phase's allowance. When the allowance cannot take them while other pages of the phase are in
flight, the page waits for one to finish and tries again; when nothing is in flight, rendering stops for
the rest of the phase. A render counts the browser time its reply reports, whatever happened
after the reply arrived. A reply that reports none, and a request that got no reply, is counted at the
request timeout, the longest it could have been open and the same as its reservation; the browser's
own time could still be longer. The header is not read on a 429: it is counted at zero, on the
assumption that no browser time was used. A render can report more than its reservation, so
a phase can end above its allowance by that excess on the pages in flight, and which pages a binding cap
leaves unrendered depends on how long the earlier renders took.

The empty-root phase adds wall time after the graded phase, inside the same render step and its
function time limit: at most ${EMPTY_ROOT_MAX_RENDERS} pages, each two requests of at most
${seconds(REQUEST_TIMEOUT_MS)} apart from the waits on a 429 below. Its browser time is added to
\`browser_ms\`, which the usage event's \`compute_seconds\` counts (\`build/lineage.ts\` \`usageOf\`).

**Across checks.** The empty-root phase spends per-check browser time the graded phase left, under
the unchanged per-check and per-day caps. A day's total can therefore be reached sooner, and a later
check's graded phase can then be refused \`daily_cap\`, and its Readable read with fewer renders. Within
one check no grade input moves; across checks this is the one way the empty-root phase can, bounded by
${EMPTY_ROOT_MAX_RENDERS} renders a check.

One check keeps at most \`${IN_FLIGHT_ENV}\` requests open at once, ${RENDER_IN_FLIGHT_DEFAULT} unless set; checks
running together each have their own. A 429 is retried no sooner than its \`Retry-After\` asks, as a
number of seconds or as an HTTP date; when it gives neither, after ${RENDER_RETRY.base_ms} ms doubling to at
most ${RENDER_RETRY.max_ms} ms; up to ${RENDER_RETRY.attempts} tries. A page asked to wait longer than
${RENDER_RETRY.max_ms} ms is left \`rate_limited\` rather than retried sooner.

On Workers Free, Cloudflare's limits page gives one Quick Actions request every
${BROWSER_RUN.free_request_every_s} s per account and ${BROWSER_RUN.free_browser_minutes_per_day} browser-minutes a day. The live run of
2026-11-05, on such an account, was answered 429 on a request sent at once after another, and 200
on one sent ${BROWSER_RUN.free_request_every_s} s after a 429; the 429s carried no \`Retry-After\` in seconds.
Each page sends its two requests back to back, so a check exceeds that rate at any in-flight setting,
and production rendering needs Workers Paid.
No reason below fails the check:

${table(
  ['Reason', 'Meaning'],
  Object.entries(NOT_RENDERED).map(([k, v]) => [code(k), v]),
)}`,

    `## Known biases

What is known to move the measured share, with the direction where it is known.

Upward, towards "readable":

- **No scrolling.** DECISION-LOG I8 named scroll steps; this build does not scroll. Content a page
  loads as it is scrolled is missing from the rendered side.
- **The wait cap.** A page still loading at ${seconds(RENDER_TIMEOUT_MS)} can come back with what had
  loaded, short on the rendered side. (One that fails instead, which Browser Run's documentation gives
  as a 422, leaves the sample: below.)
- **Refused connections and hosts.** Text a page receives from a reject-listed host, or over an
  eventsource (refused by resource type, not observed live), is missing from the rendered side.
- **The clamp.** Where the rendered side is counted short of the static side, the share is clamped
  and the page reads as share 1. Where a script really removed text, share 1 may be the right reading.
- **Block pages the challenge rule does not recognise**, served to both sides, read as share 1.${
      STATIC_JS_OFF_SHOWN_LIVE === null
        ? '\n- **Inline scripts on the static side, if `/content` ignores `setJavaScriptEnabled`.** Text they\n  write would count on both sides. Unproven either way until the live inline-script probe passes.'
        : ''
    }

Downward, towards "empty shell":

- **Third-party widgets not on the reject-list** can add words to the rendered side only, where a
  script file loads them and the extractor keeps their text.

Direction not known:

- **Renders that fail leave the sample**, and their template is then estimated from the pages that
  rendered, or moves into the unrendered share.
- **The sample within a template is its highest-PageRank pages**, not a random draw.`,

    `## Contract gaps

The contract carries none of these, and each goes into the next contract revision:

- browser-seconds per check (\`UsageEvent.compute_seconds\` is worker and server time, per account);
  the engine returns it as \`browser_ms\` on \`RenderOutcome\`;
- why a picked page has no \`without_js\`; the engine returns it as each page's \`reason\`;
- what \`Check.without_js.site_text_share\` was estimated from: the measured pages and templates, the
  unrendered share and \`single_render_weight\`. A reader of that field alone sees a share with no sign
  of how much of the site stands behind it. Each can be recomputed from the check's
  \`PageResult\` rows (\`template_key\`, the graded fields and \`without_js\`), which that reader may not
  have.`,

    `## Determinism and the live tests

Offline, a replayed reply is identical every time, so the bounds below are held to real renders only.
\`live.test.ts\` runs when the environment holds the credentials, or when \`RENDER_LIVE=1\` and
\`~/.config/crawlmouse/render.env\` (outside the repository) holds them, and is skipped otherwise:

- five renders of one page within ${pct(REPEAT_SPREAD)} of each other in rendered words (I8);
- the two sides of a page served with no script (CERN's first web page) within ${pct(PARITY_SPREAD)};
- the inline-script probe (\`fixtures/v2/render/inline-script.html\`): a page whose inline script
  writes a marker assembled at run time, and which loads a script file. The static side must not
  hold the marker; the rendered side must hold the marker and report the file loaded;
- the same page on the static side's request with JavaScript turned back on, so its inline script
  can report the file: it must report the file blocked;
- the probes send the page as \`html\`, where production sends \`url\`, so they show the request's
  settings on that input;
- a probe page whose requests report whether they loaded, rendered twice, each render waiting
  (\`waitForSelector\`) until the page has reported every request: with the rules left out,
  each request and a WebSocket must load; with them, rules \`ip_literal\` and \`download\` and one
  host from each list must be refused while two twin requests still load, and the WebSocket is
  expected to open (the known limit above), so a change in that is noticed;

The probe does not cover \`scheme\`, \`credentials\`, \`reserved_name\` or \`port\`: a page's own browser
refuses the first three requests itself, so a refusal would not show whose it was, and no endpoint was
found that loads on another port. Running these tests nightly is a CC-20 item.`,
  ];
  return `${sections.join('\n\n')}\n`;
}
