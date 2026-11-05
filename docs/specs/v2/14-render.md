# SPEC 14 — Rendering and the words a page serves without JavaScript

> Generated from `packages/engine/src/v2/render` by `pnpm --filter @crawlmouse/engine exec tsx src/v2/render/write-spec.ts`.
> `pnpm --filter @crawlmouse/engine exec vitest run src/v2/render` fails when this file differs from what the code renders.
> What the code computes is held to offline tests there. What Browser Run does with the request is held
> only by `live.test.ts`, which needs a token; this build has not run it.

This step measures; it grades nothing. For each sampled page it produces `PageResult.without_js`
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
| Request timeout, reply included | 45 s                                                                                                    |
| Largest reply read              | 10 MiB                                                                                                  |

Refusing the `script` resource type is documented to stop script files from loading; the live script
probe (below) is what shows it. A script written inline in the
HTML still runs on the static side, so text such a script writes is counted on both sides and does not
lower the share.

The user agent is the one the v2 fixtures record on their `identity_role: render` rows. Browser Run's
documentation (automatic request headers, read 2026-11-05) says it adds headers a request
cannot remove that name it as Browser Run's (`cf-brapi-request-id`, `Signature-agent`), so the user
agent does not hide what the request is.

Both sides are counted by one function: `extractMainContent` on the HTML, then runs of non-space
characters. Before that, a space is written before each opening and closing tag of 46 elements a
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
filtered by these patterns, not by per-request interception in our process.** Each pattern is sent as the regular
expression between slashes; the documentation shows that form and also one without the closing slash.
This build has not observed Browser Run reading or enforcing them: that is the live probe's job (below).

| Rule               | Refuses                                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `scheme`           | any scheme but http, https, data and blob (file:, ws:, wss:, chrome: and the rest)                                                           |
| `credentials`      | a user name or password in the URL                                                                                                           |
| `ip_literal`       | an IP address in place of a host name, IPv4 or bracketed IPv6                                                                                |
| `port`             | a port other than 80 and 443                                                                                                                 |
| `reserved_name`    | a single-label host, `localhost`, or a name under `.localhost`, `.local`, `.internal`, `.home.arpa`, `.onion`, `.i2p`                        |
| `download`         | a path ending in `.zip`, `.rar`, `.7z`, `.tar`, `.gz`, `.tgz`, `.bz2`, `.xz`, `.exe`, `.msi`, `.dmg`, `.pkg`, `.deb`, `.rpm`, `.apk`, `.iso` |
| `host_advertising` | advertising hosts and their subdomains                                                                                                       |
| `host_analytics`   | analytics hosts and their subdomains                                                                                                         |
| `host_consent`     | consent hosts and their subdomains                                                                                                           |
| `host_chat`        | chat hosts and their subdomains                                                                                                              |

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

**Redirects.** The `/content` reply carries the HTML only: no final URL and no status code. A
redirect's target is therefore not admitted in our process, and whether Browser Run applies the
patterns to it is not verified here.

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

A pure function of the crawl, the site's open client-rendered fixes and the cap. A page can be
rendered when it is graded (a `content` page that answered 200 with HTML) and the crawl fetched it
as our crawler under our robots.txt group; a page robots.txt disallows to us is not rendered. Picks are
made in this order until the cap (25 on Free, passed by the caller):

1. 2 pages of each template with an open client-rendered fix, templates by key;
2. one page of each other template, largest template first;
3. the highest-PageRank pages not yet picked.

Within a template, pages go by PageRank; ties go by URL or template key, and a URL listed twice is
taken once, under the template key that sorts first. When the cap is below what covering each template
needs, some templates get no render; the estimate then says "K of T templates" and Readable reports a
range.

## The site estimate

```text
ratio(t)        = median text_share of template t's rendered pages
site_text_share = Σ_t pages(t) × ratio(t) / Σ_t pages(t), over templates with a rendered page
unrendered      = graded pages in templates with no rendered page / graded pages
Readable range  = 30 × site_text_share × (1 − unrendered)  to  that + 30 × unrendered
```

`pages(t)` is t's graded pages, the weight CC-17's Readable uses, and graded pages robots.txt kept from
the render count in it. A template with no rendered page is left out of the share, not guessed at;
`unrendered` says how much of the graded site that leaves out. When nothing was rendered there is no
share, `unrendered` is 1 and the range is 0 to 30. `single_render_weight` is the part of the share's
weight resting on templates with one measured page, whose ratio is one page's share.

The label reads "estimated from N rendered pages across K of T templates", then, where each is above
zero, "X % of graded pages are in templates with no measured page" and "Y % of the estimate's weight
rests on one measured page per template". A template with no measured page includes one whose renders
failed or came back challenged. A part above zero is printed as "<1 %" rather than "0 %"
(`estimate.test.ts`).

## Cost and limits

| Variable                               | Meaning                                            |
| -------------------------------------- | -------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`                | Cloudflare account id                              |
| `CLOUDFLARE_BROWSER_RENDERING_TOKEN`   | API token with the `Browser Run - Edit` permission |
| `RENDER_MAX_BROWSER_SECONDS_PER_CHECK` | browser-seconds one check may use                  |
| `RENDER_MAX_BROWSER_SECONDS_PER_DAY`   | browser-seconds all checks may use in a day        |

Without both credentials nothing renders (`not_configured`). Each cap is a whole number of seconds;
unset, empty or anything else reads as zero, and a cap that is not a positive finite number renders
nothing (`caps_not_configured`). The per-day value is handed to the caller's budget with each
reservation; the count of what today has used lives in the caller's store.

Before a page starts it reserves both of its renders at 45 s each, against the
check's cap and against today's budget. When either cannot take them while other pages of the check are
in flight, the page waits for one to settle and tries again; when nothing is in flight, rendering stops
for the rest of the check. A render settles at the browser time Browser Run reports. A reply that
reports none, and a request that timed out or failed, is counted at the request timeout, the longest it
could have been open and the same as its reservation; the browser's own time could still be longer. A
429 reports no browser time and is counted at zero. A render can report more than its reservation, so
a check can end above its cap by that excess on the pages in flight, and which pages a binding cap
leaves unrendered depends on how long the earlier renders took.

At most 5 requests are open at once in one check; checks running together each have
their own 5. A 429 is retried after its `Retry-After` when that is a number of seconds, or
after 1000 ms doubling to at most 16000 ms when it gives none (an HTTP date
counts as none), up to 5 tries; a wait longer than 16000 ms is not
taken. No reason below fails the check:

| Reason                     | Meaning                                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `not_configured`           | The environment holds no Browser Run account or token.                                                                                       |
| `caps_not_configured`      | A cost cap is not a positive whole number of seconds, so nothing renders.                                                                    |
| `not_admitted`             | Admission refused the URL. `detail` is the policy rule, `resolution`, `unparseable`, or `error` for an admission that threw something else.  |
| `check_cap`                | The check's cap could not take a page's two renders with no page in flight; rendering stopped for this page and those after it.              |
| `daily_cap`                | Today's budget could not take a page's two renders with no page of this check in flight; rendering stopped for this page and those after it. |
| `daily_budget_unavailable` | Today's budget threw when asked to reserve or settle; rendering stopped for this page and those after it.                                    |
| `rate_limited`             | Browser Run answered 429 on each of 5 tries, or asked for a wait longer than 16000 ms.                                                       |
| `timed_out`                | Browser Run did not answer, or did not finish its reply, within 45 s.                                                                        |
| `page_failed`              | Browser Run answered 422, which its documentation gives for a page that timed out, crashed or errored.                                       |
| `api_error`                | Browser Run answered another error status.                                                                                                   |
| `bad_reply`                | The reply was not the documented `{success: true, result: "<html>"}`.                                                                        |
| `oversize`                 | The reply passed 10 MiB and was not read further.                                                                                            |
| `network_error`            | The request failed or its reply could not be read, for a reason other than the timeout, or the client threw.                                 |
| `challenged`               | A side of the render matches a challenge title or marker listed in challenge.ts.                                                             |
| `nothing_rendered`         | The rendered side has no words, so there is no share.                                                                                        |
| `measure_failed`           | Counting the words of the two renders threw.                                                                                                 |

## Known biases

What is known to move the measured share, with the direction where it is known.

Upward, towards "readable", because the rendered side comes back short:

- **No scrolling.** DECISION-LOG I8 named scroll steps; this build does not scroll. Content a page
  loads as it is scrolled is missing from the rendered side.
- **The wait cap.** A page still loading at 15 s either fails (Browser Run's
  documentation gives 422 for a page that timed out; not observed here) or comes back with what had
  loaded, short on the rendered side.
- **Refused connections and hosts.** Text a page receives over a WebSocket or eventsource, or from a
  reject-listed host, is missing from the rendered side.
- **A short-counted rendered side.** Where the rendered side is counted short of the static side, the
  clamp reads the page as share 1. Where a script really removed text, share 1 may be the right reading.
- **Block pages the challenge rule does not recognise**, served to both sides, read as share 1.

Downward, towards "empty shell":

- **Third-party widgets not on the reject-list** add their words to the rendered side only.

Direction not known:

- **Renders that fail leave the sample**, and their template is then estimated from the pages that
  rendered, or moves into the unrendered share.
- **The sample within a template is its highest-PageRank pages**, not a random draw.

## Contract gaps

The contract carries none of these, and each goes into the next contract revision:

- browser-seconds per check (`UsageEvent.compute_seconds` is worker and server time, per account);
  the engine returns it as `browser_ms` on `RenderOutcome`;
- why a sampled page has no `without_js`; the engine returns it as each page's `reason`;
- what `Check.without_js.site_text_share` was estimated from: the rendered pages and templates, the
  unrendered share and `single_render_weight`. A reader of that field alone sees a share with no sign
  of how much of the site stands behind it. All of them can be recomputed from the check's
  `PageResult` rows (`template_key`, the graded fields and `without_js`), which that reader may not
  have.

## Determinism and the live tests

Offline, a replayed reply is identical every time, so the bounds below are held to real renders only.
`live.test.ts` runs when the environment holds the credentials and is skipped otherwise:

- five renders of one page within 2 % of each other in rendered words (I8);
- the two sides of a static page within 5 %;
- a page with an external script file loads it on the rendered side and not on the static side;
- a probe page whose requests report whether they loaded, rendered twice: with the rules left out,
  each request and a WebSocket must load; with them, rules `ip_literal` and `download`, one host
  from each list and the WebSocket must be refused while two twin requests still load.

The probe does not cover `scheme`, `credentials`, `reserved_name` or `port`: a page's own browser
refuses the first three requests itself, so a refusal would not show whose it was, and no endpoint was
found that loads on another port. Running these tests nightly is a CC-20 item.
