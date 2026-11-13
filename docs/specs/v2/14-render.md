# SPEC 14 — Rendering and the words a page serves without JavaScript

> Generated from `packages/engine/src/v2/render` by `pnpm --filter @crawlmouse/engine exec tsx src/v2/render/write-spec.ts`.
> `pnpm --filter @crawlmouse/engine exec vitest run src/v2/render` fails when this file differs from what the code renders.
> What the code computes is held to offline tests there. What Browser Run does with the request is held
> only by `live.test.ts`, which needs a token; this build has not run it.

This step measures; it grades nothing. For each page it renders it produces `PageResult.without_js`
(`raw_words`, `rendered_words`, `text_share`, `state`), and for the check the estimate behind
`Check.without_js.site_text_share`. The call that runs it is CC-20's; the grade that reads it is CC-17's.

## The two renders of a page

Both sides of a page are renders by Cloudflare Browser Run's REST `/content` endpoint, from the same
network, with the same request but for one field:

| Setting                         | Value                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Endpoint                        | `https://api.cloudflare.com/client/v4/accounts/{account_id}/browser-run/content`                        |
| User agent                      | `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36` |
| Viewport                        | 1366 × 768                                                                                              |
| Wait                            | `networkidle0`, capped at 15 s                                                                          |
| Refused on both sides           | `websocket`, `eventsource`, `media`                                                                     |
| Refused on the static side      | `websocket`, `eventsource`, `media`, `script`                                                           |
| JavaScript on the static side   | off (`setJavaScriptEnabled: false`)                                                                     |
| Request timeout, reply included | 45 s                                                                                                    |
| Largest reply read              | 10 MiB                                                                                                  |

Refusing the `script` resource type is documented to stop script files from loading. A script
written inline in the HTML is not a request, so the static side also sends
`setJavaScriptEnabled: false`: were an inline script to run there, the text it writes would count
on both sides and raise the share, reading a page that needs JavaScript as one that does not.
Cloudflare documents that field for `/snapshot` (read 2026-11-05); the `/content` page
does not name it. The live inline-script probe (below) showed `/content` honouring it on 2026-11-05, with the page sent as `html`.

The user agent is the one the v2 fixtures record on their `identity_role: render` rows. Browser Run's
documentation (automatic request headers, read 2026-11-05) says it adds headers a request
cannot remove that name it as Browser Run's (`cf-brapi-request-id`, `Signature-agent`), so the user
agent does not hide what the request is.

Both sides are counted by one function: `extractMainContent` on the HTML, then runs of non-space
characters. Before that, a space is written before each opening and closing tag of 47 elements a
browser lays out as their own block, line or box (`p`, `div`, `li`, `td`, `button`, `br` and the
rest in `words.ts`), because the extractor joins text nodes as they are and markup a script builds
usually has no whitespace between its tags. Text in adjacent inline elements with nothing between them
(`<span>a</span><span>b</span>`) stays one word, as a browser shows it. `chars` stay with the thin gate;
nothing here uses them.

The crawl worker's served-text word count (`AccessTest.word_count`) is a different measure, from a
different request and a different extractor. It is not `raw_words`, and must not be shown next to
the share as if it were.

## Browser Run, as documented

Read on 2026-11-05; the limits page was last updated 2026-10-14. Cloudflare
renamed Browser Rendering to Browser Run on 2026-04-15; the token variable keeps the old name.

| Limit (Workers Paid)              | Value                                |
| --------------------------------- | ------------------------------------ |
| Quick Actions requests per second | 30                                   |
| Browser timeout                   | 60 s                                 |
| Longest `gotoOptions.timeout`     | 60 s                                 |
| Price                             | $0.09 per browser-hour               |
| Included                          | 10 browser-hours a month             |
| Browser time per request          | the `x-browser-ms-used` reply header |

## What the browser may request

The browser runs on Cloudflare, so our code is not asked about each request a page makes. Every render
sends the resource types above and the URL patterns below for Browser Run to enforce, as its
documentation describes (`rejectResourceTypes`, `rejectRequestPattern`). **By design, sub-requests are
filtered by these patterns, not by per-request interception in our process.** Each pattern is sent as
the regular expression's source, with no slashes. The live policy probe (below) showed that form
applied on 2026-11-05: the rules it covers, `ip_literal`, `download`, `host_advertising`, `host_analytics`, `host_consent`, `host_chat`, each refused a request
while the twin requests loaded. It does not cover `scheme`, `credentials`, `port`, `reserved_name`, and a host rule is
shown for one host of its list, not each. Sent
wrapped in slashes, as this build first did and as one of the documentation's examples shows, none
was refused. `policy.test.ts` pins the form.

**WebSockets are not stopped (known limit).** On 2026-11-05 the probe's WebSocket opened with
the `websocket` resource type refused and with the `scheme` rule, which matches `wss:`, sent. No
setting found here stops it. The browser runs on Cloudflare's network, not ours, so where a page
opens one the connection leaves from Cloudflare. Text a page received over one would count on the
rendered side; the probe saw the connection open, not text arrive.

| Rule               | Refuses                                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scheme`           | any scheme but http, https, data and blob (file:, chrome: and the rest; it matches ws: and wss:, but a WebSocket opened anyway live: see the known limit) |
| `credentials`      | a user name or password in the URL                                                                                                                        |
| `ip_literal`       | an IP address in place of a host name, IPv4 or bracketed IPv6                                                                                             |
| `port`             | a port other than 80 and 443                                                                                                                              |
| `reserved_name`    | a single-label host, `localhost`, or a name under `.localhost`, `.local`, `.internal`, `.home.arpa`, `.onion`, `.i2p`                                     |
| `download`         | a path ending in `.zip`, `.rar`, `.7z`, `.tar`, `.gz`, `.tgz`, `.bz2`, `.xz`, `.exe`, `.msi`, `.dmg`, `.pkg`, `.deb`, `.rpm`, `.apk`, `.iso`              |
| `host_advertising` | advertising hosts and their subdomains                                                                                                                    |
| `host_analytics`   | analytics hosts and their subdomains                                                                                                                      |
| `host_consent`     | consent hosts and their subdomains                                                                                                                        |
| `host_chat`        | chat hosts and their subdomains                                                                                                                           |

Hosts are matched by name. A sub-request to a public name that resolves to a private address matches
no rule and loads; it loads on Cloudflare's network, not ours.

The host lists are a reject-list, compiled by hand on 2026-11-05 from what was known of each
vendor's embed snippet, not fetched from the vendors or taken from a maintained block list, so it misses
hosts. A host missing here loads like any other script.

| List        | Hosts (and their subdomains)                                                                                                                                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| advertising | `doubleclick.net`, `googlesyndication.com`, `googleadservices.com`, `amazon-adsystem.com`, `adnxs.com`, `criteo.com`, `criteo.net`, `taboola.com`, `outbrain.com`, `pubmatic.com`, `rubiconproject.com`, `static.ads-twitter.com`                                      |
| analytics   | `google-analytics.com`, `googletagmanager.com`, `connect.facebook.net`, `bat.bing.com`, `clarity.ms`, `hotjar.com`, `cdn.segment.com`, `mixpanel.com`, `mxpnl.com`, `cdn.amplitude.com`, `fullstory.com`, `heapanalytics.com`, `js-agent.newrelic.com`, `plausible.io` |
| consent     | `cookielaw.org`, `onetrust.com`, `cookiebot.com`, `consentmanager.net`, `usercentrics.eu`, `trustarc.com`, `privacy-center.org`, `iubenda.com`, `cookieyes.com`, `cdn-cookieyes.com`, `termly.io`                                                                      |
| chat        | `intercom.io`, `intercomcdn.com`, `driftt.com`, `zopim.com`, `crisp.chat`, `tawk.to`, `livechatinc.com`, `usemessages.com`, `tidio.co`, `olark.com`                                                                                                                    |

**Why a reject-list.** `text_share` is static words over rendered words. A script the browser may not
load cannot add words, so each script blocked by mistake shrinks the rendered side and raises the
share: a page that needs JavaScript reads as one that does not. An allow-list of script origins does
that to each site whose own JavaScript is served from a CDN under another name. So the hosts refused
are those whose scripts are usually not the page's content. Usually: a tag manager can inject text, and
its words are then missing from the rendered side.

**Downloads** are refused by path ending, in any case. A download a server signals with
`Content-Disposition` on an ordinary path is not refused by a pattern; the `/content` reply is
documented to carry the page's HTML only, and nothing is written to our disk.

**Admission.** The navigation URL is checked in our process before anything is sent: it is refused
when a pattern above matches it, since Browser Run would block it anyway (so a page on a listed host
is not rendered), and then the host is resolved and a private or reserved address is refused
(`validateUrlOrThrow`). Admission is a parameter of the render; the caller can pass the project's URL
admission instead. The resolution happens in our process and the browser resolves the name again on
Cloudflare, possibly to another address, so the default is a defence, not a guarantee.

**Redirects.** The `/content` reply carries the HTML only: no final URL and no status code, so
admitting the URL a redirect ends on is not possible with this endpoint. A redirect's target is not
admitted in our process, and whether Browser Run applies the patterns to it is not verified here.

## Challenge pages

A render has no status code or headers, only HTML, so a challenge is read from that alone. A side is
taken for a challenge page when its title is one of `just a moment...`, `attention required! | cloudflare`, `vercel security checkpoint` (whole, trimmed, any case),
or ends with `used cloudflare to restrict access`, or its HTML contains one of `px-captcha`, `errors.edgesuite.net`, `captcha-delivery.com`, `incapsula incident id`, `/.well-known/sgcaptcha`, `/_sec/cp_challenge`. The
worker reads body text only on a 403 or 503; without a status, a fragment that also appears on ordinary
pages would mark them challenged, so Cloudflare's `/cdn-cgi/challenge-platform/` path, which it loads
on pages it serves normally, is not a marker here, and neither is "just a moment" in body text. A page
that merely quotes a marker is taken for a challenge and not measured. A block page these do not
recognise, served to both sides, has the same words on both and reads as share 1.

## One page

`text_share` = `raw_words` / `rendered_words`, clamped to 1 when the static side shows more words.
A page whose rendered side has no words, or either of whose sides is taken for a challenge page, has
no share: it is not rendered, with the reason.

| Share                 | No previous state, or previous partial/readable | Previous state `empty_shell` |
| --------------------- | ----------------------------------------------- | ---------------------------- |
| below 0.3             | `empty_shell`                                   | `empty_shell`                |
| 0.3 to 0.45           | `partial`                                       | `empty_shell`                |
| above 0.45, below 0.8 | `partial`                                       | `partial`                    |
| 0.8 and above         | `readable`                                      | `readable`                   |

The `empty_shell` line carries hysteresis (DECISION-LOG B7) because a client-rendered fix opens on it:
a page in that state stays in it until its share rises above 0.45. The
partial/readable line at 0.8 has none.

## Which pages are rendered

A check renders in two phases, the graded phase and then the empty-root phase, each a pure function of
the crawl (and, for the graded phase, the site's open client-rendered fixes) and its cap.

### The graded phase

A page can be picked when it is graded (a `content` page that answered 200 with HTML) and the crawl fetched it
as our crawler under our robots.txt group; a page robots.txt disallows to us is not rendered. Picks are
made in this order until the cap (25 on Free, passed by the caller):

1. 2 pages of each template with an open client-rendered fix, templates by key;
2. one page of each other template, largest template first;
3. the highest-PageRank pages not yet picked.

Within a template, pages go by PageRank; ties go by URL or template key, and a URL listed twice is
taken once, under the template key that sorts first. When the cap is below what covering each template
needs, some templates get no render; the estimate then says "K of T templates" and Readable reports a
range.

### The empty-root phase

An empty-root page answered 200 with HTML, v1's classifier classed it `thin`, and v1's JS detector
read the bytes the crawl fetched as an app shell (`content_features.client_rendered`). It is not
graded, so the graded phase never picks it. The pool is every crawled page, not the access sample.
The picks are the empty-root pages of templates with no graded page in the crawl: the detector
judges a template with a graded page on its graded renders alone, so an empty-root render there
would decide nothing. They are ordered by template key, then PageRank (highest first), then URL,
at most 2 of a template (`EMPTY_ROOT_PER_TEMPLATE`) and 5 in all
(`EMPTY_ROOT_MAX_RENDERS`), less any URL the graded phase took. A URL listed twice is taken once,
and not at all when any listing of it is not an empty-root page. An open fix's template is not put
first here: the order is by key alone.

The phase runs after the graded phase has settled (below), so the graded phase's pages, and the
estimate, which is drawn from them alone, are what they would be with no empty-root page in the crawl.
It comes last in the budget too: its allowance is the per-check browser time the graded phase left,
not render slots. So on a large site whose graded renders are fast the empty-root phase still renders,
and where the graded phase uses the time, no empty-root page renders and a template of empty-root
pages alone reads `not_rendered`. An empty-root page's `without_js` is written to its
`PageResult`. The `client_rendered_template` detector reads it only for a template with no graded
page: a template with a graded page is judged on its graded renders alone, as before. It reaches
neither the site estimate nor Readable, which read graded pages only.

## The links of a rendered page

A measured page's outcome also carries `links`: what its script adds to its same-site links
(`links.ts`, CC-32 D6). One extractor reads both sides, the crawl's own (extract.ts `extractPage`,
share actions and media files left out), so each target is in `canonicalizeUrl`'s spelling with no
options, the spelling the worker's edges carry. A `www.` twin is a target of its own, as it is a page
of its own in the worker's crawl (the older single-function engine path, `audit.ts` under its ENGINE_V2
flag, unifies `www.`; its pages never reach this detector). A target is read when it is on the page's own site by the crawl planner's
rule (`inSiteScope`: the page's host or its `www.` twin, on the default port), is not the page itself,
and is at most 2048 characters; a longer one is left out on both sides alike, as the worker
leaves it out of its edges, so it is never JS-only.

Both sides are read whole, in memory, and the difference, the rendered side's targets less the static
side's, is taken over the whole sets. Only the difference is kept: `js_only`, sorted, the longest
prefix that holds at most 200 targets (`MAX_RENDER_LINKS`) and 32 KiB of URL characters
(`MAX_RENDER_LINK_CHARS`); `js_only_count`, the whole difference's size; and `truncated`, set when the
bound left some out. An empty difference is evidence that the script adds no same-site link, however
many links the page has.

So a rendered page adds at most 32 KiB of URL characters to the stored outcome; a canonical URL is
ASCII, so that is also its bytes, before JSON quoting. On the Free cap, 25 graded and 5 empty-root
renders, a check adds at most 960 KiB. The graded cap is the caller's (`maxRenders`), so a larger cap
raises the second figure by 32 KiB a render.

The lists stay on the render outcome, which the pipeline keeps as evidence; they are never written to
`PageResult.without_js`, whose stored shape holds the four keys above. A page whose links cannot be read
keeps its measurement and carries no `links`, and so does every page of an outcome stored before this.
The build reads `links` back from evidence JSON through `readRenderLinks`: an entry in any other shape
(an earlier one, or a count that is not a whole number) is read as no `links`.
The `js_only_navigation` detector (detectors/js-only-navigation.ts) reads them: a measured page with
`links` is evidence, whether or not its kept list was cut, and a page with no `links` is not. A record
keeps at most 20 of a page's targets, with its whole count.

## The site estimate

```text
ratio(t)        = median text_share of template t's measured pages
site_text_share = Σ_t pages(t) × ratio(t) / Σ_t pages(t), over templates with a measured page
unrendered      = graded pages in templates with no measured page / graded pages
Readable range  = 30 × site_text_share × (1 − unrendered)  to  that + 30 × unrendered
```

`pages(t)` is t's graded pages, the weight CC-17's Readable uses, and graded pages robots.txt kept from
the render count in it. A template with no measured page is left out of the share, not guessed at;
`unrendered` (the field `unrendered_share`) says how much of the graded site that leaves out; a
template whose pages were rendered but none measured counts in it. When nothing was measured there is no
share, `unrendered` is 1 and the range is 0 to 30. `single_render_weight` is the part of the share's
weight resting on templates with one measured page, whose ratio is one page's share.

The label reads "estimated from N measured pages across K of T templates", then, where each is above
zero, "X % of graded pages are in templates with no measured page" and "Y % of the estimate's weight
rests on one measured page per template". A template with no measured page includes one whose renders
failed or came back challenged. A part above zero is printed as "<1 %" rather than "0 %"
(`estimate.test.ts`).

## Cost and limits

| Variable                               | Meaning                                                     |
| -------------------------------------- | ----------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`                | Cloudflare account id                                       |
| `CLOUDFLARE_BROWSER_RENDERING_TOKEN`   | API token with the `Browser Run - Edit` permission          |
| `RENDER_MAX_BROWSER_SECONDS_PER_CHECK` | browser-seconds one check may use                           |
| `RENDER_MAX_BROWSER_SECONDS_PER_DAY`   | browser-seconds all checks may use in a day                 |
| `RENDER_MAX_IN_FLIGHT`                 | requests one check keeps open at once, 1 to 10; otherwise 2 |

Without both credentials nothing renders (`not_configured`). Each cap is a whole number of seconds;
unset, empty or anything else reads as zero, and a cap that is not a positive finite number renders
nothing (`caps_not_configured`). The count of what today has used lives in the caller's store.

**Today's budget is asked once per phase**, before any of the phase's pages, to reserve the phase's
allowance against the per-day value. The graded phase's allowance is the check's cap, or
90 s for each of its pages, whichever is less; the empty-root phase's is
what the cap leaves after the graded phase counted, or 90 s for each of its
pages, whichever is less. When the budget refuses, no page of the phase renders and each is
`daily_cap`; when it throws, each is `daily_budget_unavailable`, and admission is not run for any of
them. A phase whose allowance is below one page's 90 s does not ask, and each
of its pages is `check_cap`. When it grants, the budget is settled once, after the phase's last page
has finished, at the browser time the phase counted; a settle that throws is returned as
`settle_failed`, and the day may still count the whole allowance, depending on the store. So a day with
room for some pages of a phase but not its allowance renders none of that phase. When the budget
refused the graded phase or threw, the empty-root phase does not ask it, and each of its pages carries
the graded phase's reason. A refusal by the budget, or a page Browser Run fails, in the empty-root
phase reaches only that phase's pages. If a page throws out of the render, the other pages of its
phase go on, taking and rendering the phase's pages left in the queue; once all have finished, the
budget is settled at what the phase counted. A throw in the graded phase is then passed on, so the
check's results are discarded and the empty-root phase does not run; a throw in the empty-root phase
leaves each of its pages `phase_threw`, and the graded phase's pages stand.

Within a phase, before a page starts it reserves both of its renders at 45 s each
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
function time limit: at most 5 pages, each two requests of at most
45 s apart from the waits on a 429 below; at 2 requests open at
once that is up to about 225 s. A check can now make up to
30 renders (25 graded and 5 empty-root) under the unchanged browser-time caps. The render step has no
deadline of its own: the one it needs before production renders are switched on has to cover both
phases. Its browser time is added to `browser_ms`, which the usage event's `compute_seconds`
counts (`build/lineage.ts` `usageOf`). A page left `phase_threw` records no detail of the error.

**Across checks.** The empty-root phase spends per-check browser time the graded phase left, under
the unchanged per-check and per-day caps. A day's total can therefore be reached sooner, and a later
check's graded phase can then be refused `daily_cap`, and its Readable read with fewer renders. Within
one check no grade input moves; across checks this is the one way the empty-root phase can, bounded by
5 renders a check.

One check keeps at most `RENDER_MAX_IN_FLIGHT` requests open at once, 2 unless set; checks
running together each have their own. A 429 is retried no sooner than its `Retry-After` asks, as a
number of seconds or as an HTTP date; when it gives neither, after 2000 ms doubling to at
most 60000 ms; up to 5 tries. A page asked to wait longer than
60000 ms is left `rate_limited` rather than retried sooner.

On Workers Free, Cloudflare's limits page gives one Quick Actions request every
10 s per account and 10 browser-minutes a day. The live run of
2026-11-05, on such an account, was answered 429 on a request sent at once after another, and 200
on one sent 10 s after a 429; the 429s carried no `Retry-After` in seconds.
Each page sends its two requests back to back, so a check exceeds that rate at any in-flight setting,
and production rendering needs Workers Paid.
No reason below fails the check:

| Reason                     | Meaning                                                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `not_configured`           | The environment holds no Browser Run account or token.                                                                                                         |
| `caps_not_configured`      | A cost cap is not a positive whole number of seconds, so nothing renders.                                                                                      |
| `not_admitted`             | Admission refused the URL. `detail` is the policy rule, `resolution`, `unparseable`, or `error` for an admission that threw something else.                    |
| `check_cap`                | The phase's allowance could not take a page's two renders with no page of the phase in flight; rendering stopped for this page and the phase's pages after it. |
| `daily_cap`                | Today's budget refused the phase's allowance, asked for once before any of its pages; no page of the phase rendered.                                           |
| `daily_budget_unavailable` | Today's budget threw when asked for the phase's allowance; no page of the phase rendered.                                                                      |
| `rate_limited`             | Browser Run answered 429 on each of 5 tries, or its Retry-After asked for a wait longer than 60000 ms.                                                         |
| `timed_out`                | Browser Run did not answer, or did not finish its reply, within 45 s.                                                                                          |
| `page_failed`              | Browser Run answered 422, which its documentation gives for a page that timed out, crashed or errored.                                                         |
| `api_error`                | Browser Run answered another error status.                                                                                                                     |
| `bad_reply`                | The reply was not the documented `{success: true, result: "<html>"}`.                                                                                          |
| `oversize`                 | The reply passed 10 MiB and was not read further.                                                                                                              |
| `network_error`            | The request failed or its reply could not be read, for a reason other than the timeout, or the client threw.                                                   |
| `challenged`               | A side of the render matches a challenge title or marker listed in challenge.ts.                                                                               |
| `nothing_rendered`         | The rendered side has no words, so there is no share.                                                                                                          |
| `measure_failed`           | Counting the words of the two renders threw.                                                                                                                   |
| `phase_threw`              | A page of the empty-root phase threw out of the render; each page of that phase is left unrendered, and the graded phase's pages stand.                        |

## Known biases

What is known to move the measured share, with the direction where it is known.

Upward, towards "readable":

- **No scrolling.** DECISION-LOG I8 named scroll steps; this build does not scroll. Content a page
  loads as it is scrolled is missing from the rendered side.
- **The wait cap.** A page still loading at 15 s can come back with what had
  loaded, short on the rendered side. (One that fails instead, which Browser Run's documentation gives
  as a 422, leaves the sample: below.)
- **Refused connections and hosts.** Text a page receives from a reject-listed host, or over an
  eventsource (refused by resource type, not observed live), is missing from the rendered side.
- **The clamp.** Where the rendered side is counted short of the static side, the share is clamped
  and the page reads as share 1. Where a script really removed text, share 1 may be the right reading.
- **Block pages the challenge rule does not recognise**, served to both sides, read as share 1.

Downward, towards "empty shell":

- **Third-party widgets not on the reject-list** can add words to the rendered side only, where a
  script file loads them and the extractor keeps their text.

Direction not known:

- **Renders that fail leave the sample**, and their template is then estimated from the pages that
  rendered, or moves into the unrendered share.
- **The sample within a template is its highest-PageRank pages**, not a random draw.

## Contract gaps

The contract carries none of these, and each goes into the next contract revision:

- browser-seconds per check (`UsageEvent.compute_seconds` is worker and server time, per account);
  the engine returns it as `browser_ms` on `RenderOutcome`;
- why a picked page has no `without_js`; the engine returns it as each page's `reason`;
- what `Check.without_js.site_text_share` was estimated from: the measured pages and templates, the
  unrendered share and `single_render_weight`. A reader of that field alone sees a share with no sign
  of how much of the site stands behind it. Each can be recomputed from the check's
  `PageResult` rows (`template_key`, the graded fields and `without_js`), which that reader may not
  have.

## Determinism and the live tests

Offline, a replayed reply is identical every time, so the bounds below are held to real renders only.
`live.test.ts` runs when the environment holds the credentials, or when `RENDER_LIVE=1` and
`~/.config/crawlmouse/render.env` (outside the repository) holds them, and is skipped otherwise:

- five renders of one page within 2 % of each other in rendered words (I8);
- the two sides of a page served with no script (CERN's first web page) within 5 %;
- the inline-script probe (`fixtures/v2/render/inline-script.html`): a page whose inline script
  writes a marker assembled at run time, and which loads a script file. The static side must not
  hold the marker; the rendered side must hold the marker and report the file loaded;
- the same page on the static side's request with JavaScript turned back on, so its inline script
  can report the file: it must report the file blocked;
- the probes send the page as `html`, where production sends `url`, so they show the request's
  settings on that input;
- a probe page whose requests report whether they loaded, rendered twice, each render waiting
  (`waitForSelector`) until the page has reported every request: with the rules left out,
  each request and a WebSocket must load; with them, rules `ip_literal` and `download` and one
  host from each list must be refused while two twin requests still load, and the WebSocket is
  expected to open (the known limit above), so a change in that is noticed;

The probe does not cover `scheme`, `credentials`, `reserved_name` or `port`: a page's own browser
refuses the first three requests itself, so a refusal would not show whose it was, and no endpoint was
found that loads on another port. Running these tests nightly is a CC-20 item.
