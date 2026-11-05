/**
 * Renders docs/specs/v2/14-render.md from the render module's own constants and lists, so the spec
 * cannot name a number or a rule the code does not hold. spec.test.ts fails when the file differs.
 */
import { code, pct, table } from '../detectors/spec.js';
import { CAP_ENV } from './budget.js';
import { CHALLENGE_MARKERS, CHALLENGE_TITLES } from './challenge.js';
import {
  BROWSER_RUN,
  ENV,
  MAX_REPLY_BYTES,
  RENDER_TIMEOUT_MS,
  RENDER_USER_AGENT,
  RENDER_VIEWPORT,
  RENDER_WAIT_UNTIL,
} from './client.js';
import { PARITY_SPREAD, REPEAT_SPREAD } from './parity.js';
import {
  REJECTED_HOSTS,
  REJECTED_HOSTS_AS_OF,
  REJECTED_RESOURCE_TYPES,
  STATIC_REJECTED_RESOURCE_TYPES,
  URL_RULES,
} from './policy.js';
import { NOT_RENDERED, RENDER_IN_FLIGHT, RENDER_RETRY, RESERVE_PER_RENDER_MS } from './run.js';
import { FREE_MAX_RENDERS, PAGES_PER_FIX_TEMPLATE } from './sample.js';
import { EMPTY_SHELL_BELOW, EMPTY_SHELL_LEAVES_ABOVE, READABLE_FROM } from './state.js';
import { BLOCK_ELEMENTS } from './words.js';

export const SPEC_URL = new URL('../../../../../docs/specs/v2/14-render.md', import.meta.url);

const list = (xs: readonly string[]) => xs.map(code).join(', ');
const seconds = (ms: number) => `${ms / 1000} s`;

export function renderRenderSpec(): string {
  const sections = [
    `# SPEC 14 — Rendering and the words a page serves without JavaScript

> Generated from \`packages/engine/src/v2/render\` by \`pnpm --filter @crawlmouse/engine exec tsx src/v2/render/write-spec.ts\`.
> \`pnpm --filter @crawlmouse/engine exec vitest run src/v2/render\` fails when this file differs from what the code renders,
> and holds each rule below to a test.

This step measures; it grades nothing. For each sampled page it produces \`PageResult.without_js\`
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
    ['Largest reply read', `${MAX_REPLY_BYTES / 1024 / 1024} MiB`],
  ],
)}

Refusing the \`script\` resource type stops script files from loading. A script written inline in the
HTML still runs on the static side, so text such a script writes is counted on both sides and does not
lower the share.

The user agent is the one the v2 fixtures record on their \`identity_role: render\` rows. Browser Run
adds headers that cannot be removed and name the request as its own (\`cf-brapi-request-id\`,
\`Signature-agent\`), so the user agent does not hide what the request is.

Words are counted the same way on both sides: \`extractMainContent\` on the HTML, then runs of
non-space characters. Before that, each of ${BLOCK_ELEMENTS.length} block elements gets a space on either
side, because the extractor joins text nodes as they are and markup a script builds usually has no
whitespace between its tags; without it the rendered side would lose a word at each block boundary.
\`chars\` stay with the thin gate; nothing here uses them.

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
sends the resource types above and the URL patterns below, which Cloudflare enforces. **Sub-requests are
filtered by these patterns, not by per-request interception in our process.**

${table(
  ['Rule', 'Refuses'],
  URL_RULES.map((r) => [code(r.name), r.refuses]),
)}

The host lists are a reject-list, compiled by hand on ${REJECTED_HOSTS_AS_OF} from the hosts each vendor's
standard embed snippet loads from; a vendor missing here is loaded like any other script.

${table(
  ['List', 'Hosts (and their subdomains)'],
  REJECTED_HOSTS.map((l) => [l.name, list(l.hosts)]),
)}

**Why a reject-list.** \`text_share\` is static words over rendered words. A script the browser may not
load cannot add words, so each script blocked by mistake shrinks the rendered side and inflates the
share: a page that needs JavaScript reads as one that does not. An allow-list of script origins does
that to every site whose own JavaScript is served from a CDN under another name. So only hosts whose
scripts are not the page's content are refused.

**Downloads** are refused by path ending only. A download a server signals with
\`Content-Disposition\` on an ordinary path is not refused by a pattern; Browser Run returns the page's
HTML and nothing else, and nothing is written to our disk.

**Admission.** The navigation URL is checked in our process before anything is sent: it is refused
when a pattern above matches it, since Browser Run would block it anyway (so a page on a listed host
is not rendered), and then the host is resolved and a private or reserved address is refused
(\`validateUrlOrThrow\`). Admission is a parameter of the render; the caller can pass the project's URL
admission instead. The resolution happens in our process and the browser resolves the name again on
Cloudflare, possibly to another address, so the default is a defence, not a guarantee.

**Redirects.** The \`/content\` reply carries the HTML only: no final URL and no status code. A
redirect's target is therefore not admitted in our process, and whether Browser Run applies the
patterns to it is not verified here.`,

    `## Challenge pages

A render has no status code or headers, only HTML, so a challenge is read from that alone. A side is a
challenge page when its title is one of ${list(CHALLENGE_TITLES)} (whole, trimmed, any case), or its
HTML contains one of ${list(CHALLENGE_MARKERS)}. The worker reads body text only on a 403 or 503;
without a status, a fragment that also appears on ordinary pages would mark them challenged, so
Cloudflare's \`/cdn-cgi/challenge-platform/\` path, which it loads on pages it serves normally, is not a
marker here, and neither is "just a moment" in body text.`,

    `## One page

\`text_share\` = \`raw_words\` / \`rendered_words\`, clamped to 1 when the static side shows more words.
A page whose rendered side has no words, or either of whose sides is a challenge page, has no share:
it is not rendered, with the reason.

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

A pure function of the crawl. A page can be rendered when it is graded (a ${code('content')} page that
answered 200 with HTML) and the crawl fetched it as our crawler under our robots.txt group; a page
robots.txt disallows to us is not rendered. Picks are made in this order until the cap
(${FREE_MAX_RENDERS} on Free, passed by the caller):

1. ${PAGES_PER_FIX_TEMPLATE} pages of each template with an open client-rendered fix;
2. one page of each other template, largest template first;
3. the highest-PageRank pages not yet picked.

Within a template, pages go by PageRank; ties go by URL or template key. When the cap is below what
covering each template needs, some templates get no render; the estimate then says "K of T templates"
and Readable reports a range.`,

    `## The site estimate

\`\`\`text
ratio(t)        = median text_share of template t's rendered pages
site_text_share = Σ_t pages(t) × ratio(t) / Σ_t pages(t), over templates with a rendered page
unrendered      = graded pages in templates with no rendered page / graded pages
Readable range  = 30 × site_text_share × (1 − unrendered)  to  that + 30 × unrendered
\`\`\`

\`pages(t)\` is t's graded pages, the weight CC-17's Readable uses. A template with no rendered page is
left out of the share, not guessed at; \`unrendered\` says how much of the graded site that leaves out.
The label reads "estimated from N rendered pages across K of T templates".`,

    `## Cost and limits

${table(
  ['Variable', 'Meaning'],
  [
    [code(ENV.account), 'Cloudflare account id'],
    [code(ENV.token), 'API token with `Browser Run - Edit`'],
    [code(CAP_ENV.perCheck), 'browser-seconds one check may use'],
    [code(CAP_ENV.perDay), 'browser-seconds all checks may use in a day'],
  ],
)}

Without both credentials nothing renders (\`not_configured\`). Each cap is a whole number of seconds;
unset, empty or anything else reads as zero, and a zero cap renders nothing (\`caps_not_configured\`).
Before a page starts it reserves both of its renders at ${seconds(RESERVE_PER_RENDER_MS)} each, against
the check's cap and against the day's budget, which the caller keeps; when either cannot take them,
rendering stops for the rest of the check. A render settles at the browser time Browser Run reports;
a reply that reports none is counted at the wait cap, and a 429 at zero. A render can report more than
the wait cap, so a check can end above its cap by that excess on the pages in flight, and which pages a
binding cap leaves unrendered depends on how long the earlier renders took.

At most ${RENDER_IN_FLIGHT} requests are open at once. A 429 is retried after its \`Retry-After\`, or after
${RENDER_RETRY.base_ms} ms doubling to at most ${RENDER_RETRY.max_ms} ms, up to ${RENDER_RETRY.attempts} tries.
No reason below fails the check:

${table(
  ['Reason', 'Meaning'],
  Object.entries(NOT_RENDERED).map(([k, v]) => [code(k), v]),
)}`,

    `## Contract gaps

The engine returns \`browser_ms\` and each unrendered page's reason on its own \`RenderOutcome\`. The
contract has no field for either: browser-seconds per check (\`UsageEvent.compute_seconds\` is worker
and server time, per account), and the reason a sampled page has no \`without_js\`. Both go into the
next contract revision.`,

    `## Determinism

Offline, a replayed reply is identical every time, so the two bounds are held to real renders only.
\`live.test.ts\` runs when the environment holds the credentials and is skipped otherwise: two renders of
one page within ${pct(REPEAT_SPREAD)} in rendered words; the two sides of a static page within
${pct(PARITY_SPREAD)}; and a probe page showing Cloudflare refuses what the policy refuses while an
ordinary request loads. Running it nightly is a CC-20 item.`,
  ];
  return `${sections.join('\n\n')}\n`;
}
