# SPEC 14 — Rendering and the words a page serves without JavaScript

> Generated from `packages/engine/src/v2/render` by `pnpm --filter @crawlmouse/engine exec tsx src/v2/render/write-spec.ts`.
> `pnpm --filter @crawlmouse/engine exec vitest run src/v2/render` fails when this file differs from what the code renders,
> and holds each rule below to a test.

This step measures; it grades nothing. For each sampled page it produces `PageResult.without_js`
(`raw_words`, `rendered_words`, `text_share`, `state`), and for the check the estimate behind
`Check.without_js.site_text_share`. The call that runs it is CC-20's; the grade that reads it is CC-17's.

## The two renders of a page

Both sides of a page are renders by Cloudflare Browser Run's REST `/content` endpoint, from the same
network, with the same request but for one field:

| Setting                    | Value                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| Endpoint                   | `https://api.cloudflare.com/client/v4/accounts/{account_id}/browser-run/content`                        |
| User agent                 | `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36` |
| Viewport                   | 1366 × 768                                                                                              |
| Wait                       | `networkidle0`, capped at 15 s                                                                          |
| Refused on both sides      | `websocket`, `eventsource`, `media`                                                                     |
| Refused on the static side | `websocket`, `eventsource`, `media`, `script`                                                           |
| Largest reply read         | 10 MiB                                                                                                  |

Refusing the `script` resource type stops script files from loading. A script written inline in the
HTML still runs on the static side, so text such a script writes is counted on both sides and does not
lower the share.

The user agent is the one the v2 fixtures record on their `identity_role: render` rows. Browser Run
adds headers that cannot be removed and name the request as its own (`cf-brapi-request-id`,
`Signature-agent`), so the user agent does not hide what the request is.

Words are counted the same way on both sides: `extractMainContent` on the HTML, then runs of
non-space characters. Before that, each of 41 block elements gets a space on either
side, because the extractor joins text nodes as they are and markup a script builds usually has no
whitespace between its tags; without it the rendered side would lose a word at each block boundary.
`chars` stay with the thin gate; nothing here uses them.

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
sends the resource types above and the URL patterns below, which Cloudflare enforces. **Sub-requests are
filtered by these patterns, not by per-request interception in our process.**

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

The host lists are a reject-list, compiled by hand on 2026-11-05 from the hosts each vendor's
standard embed snippet loads from; a vendor missing here is loaded like any other script.

| List        | Hosts (and their subdomains)                                                                                                                                                                                                                              |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| advertising | `doubleclick.net`, `googlesyndication.com`, `googleadservices.com`, `amazon-adsystem.com`, `adnxs.com`, `criteo.com`, `criteo.net`, `taboola.com`, `outbrain.com`, `pubmatic.com`, `rubiconproject.com`, `static.ads-twitter.com`                         |
| analytics   | `google-analytics.com`, `googletagmanager.com`, `connect.facebook.net`, `bat.bing.com`, `clarity.ms`, `hotjar.com`, `cdn.segment.com`, `mixpanel.com`, `cdn.amplitude.com`, `fullstory.com`, `heapanalytics.com`, `js-agent.newrelic.com`, `plausible.io` |
| consent     | `cookielaw.org`, `onetrust.com`, `cookiebot.com`, `consentmanager.net`, `usercentrics.eu`, `trustarc.com`, `privacy-center.org`, `iubenda.com`, `cookieyes.com`, `termly.io`                                                                              |
| chat        | `intercom.io`, `intercomcdn.com`, `driftt.com`, `zdassets.com`, `zopim.com`, `crisp.chat`, `tawk.to`, `livechatinc.com`, `usemessages.com`, `tidio.co`, `olark.com`                                                                                       |

**Why a reject-list.** `text_share` is static words over rendered words. A script the browser may not
load cannot add words, so each script blocked by mistake shrinks the rendered side and inflates the
share: a page that needs JavaScript reads as one that does not. An allow-list of script origins does
that to every site whose own JavaScript is served from a CDN under another name. So only hosts whose
scripts are not the page's content are refused.

**Downloads** are refused by path ending only. A download a server signals with
`Content-Disposition` on an ordinary path is not refused by a pattern; Browser Run returns the page's
HTML and nothing else, and nothing is written to our disk.

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

A render has no status code or headers, only HTML, so a challenge is read from that alone. A side is a
challenge page when its title is one of `just a moment...`, `attention required! | cloudflare` (whole, trimmed, any case), or its
HTML contains one of `px-captcha`, `captcha-delivery.com`, `incapsula incident id`, `/.well-known/sgcaptcha`, `/_sec/cp_challenge`. The worker reads body text only on a 403 or 503;
without a status, a fragment that also appears on ordinary pages would mark them challenged, so
Cloudflare's `/cdn-cgi/challenge-platform/` path, which it loads on pages it serves normally, is not a
marker here, and neither is "just a moment" in body text.

## One page

`text_share` = `raw_words` / `rendered_words`, clamped to 1 when the static side shows more words.
A page whose rendered side has no words, or either of whose sides is a challenge page, has no share:
it is not rendered, with the reason.

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

A pure function of the crawl. A page can be rendered when it is graded (a `content` page that
answered 200 with HTML) and the crawl fetched it as our crawler under our robots.txt group; a page
robots.txt disallows to us is not rendered. Picks are made in this order until the cap
(25 on Free, passed by the caller):

1. 2 pages of each template with an open client-rendered fix;
2. one page of each other template, largest template first;
3. the highest-PageRank pages not yet picked.

Within a template, pages go by PageRank; ties go by URL or template key. When the cap is below what
covering each template needs, some templates get no render; the estimate then says "K of T templates"
and Readable reports a range.

## The site estimate

```text
ratio(t)        = median text_share of template t's rendered pages
site_text_share = Σ_t pages(t) × ratio(t) / Σ_t pages(t), over templates with a rendered page
unrendered      = graded pages in templates with no rendered page / graded pages
Readable range  = 30 × site_text_share × (1 − unrendered)  to  that + 30 × unrendered
```

`pages(t)` is t's graded pages, the weight CC-17's Readable uses. A template with no rendered page is
left out of the share, not guessed at; `unrendered` says how much of the graded site that leaves out.
The label reads "estimated from N rendered pages across K of T templates".

## Cost and limits

| Variable                               | Meaning                                     |
| -------------------------------------- | ------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`                | Cloudflare account id                       |
| `CLOUDFLARE_BROWSER_RENDERING_TOKEN`   | API token with `Browser Run - Edit`         |
| `RENDER_MAX_BROWSER_SECONDS_PER_CHECK` | browser-seconds one check may use           |
| `RENDER_MAX_BROWSER_SECONDS_PER_DAY`   | browser-seconds all checks may use in a day |

Without both credentials nothing renders (`not_configured`). Each cap is a whole number of seconds;
unset, empty or anything else reads as zero, and a zero cap renders nothing (`caps_not_configured`).
Before a page starts it reserves both of its renders at 15 s each, against
the check's cap and against the day's budget, which the caller keeps; when either cannot take them,
rendering stops for the rest of the check. A render settles at the browser time Browser Run reports;
a reply that reports none is counted at the wait cap, and a 429 at zero. A render can report more than
the wait cap, so a check can end above its cap by that excess on the pages in flight, and which pages a
binding cap leaves unrendered depends on how long the earlier renders took.

At most 5 requests are open at once. A 429 is retried after its `Retry-After`, or after
1000 ms doubling to at most 16000 ms, up to 5 tries.
No reason below fails the check:

| Reason                     | Meaning                                                                         |
| -------------------------- | ------------------------------------------------------------------------------- |
| `not_configured`           | The environment holds no Browser Run account or token.                          |
| `caps_not_configured`      | A cost cap is unset, invalid or zero, so nothing renders.                       |
| `not_admitted`             | Admission refused the URL; `detail` names the rule, or `resolution`.            |
| `check_cap`                | The check's cap could not take this page's two renders; rendering stopped.      |
| `daily_cap`                | Today's budget could not take this page's two renders; rendering stopped.       |
| `daily_budget_unavailable` | Today's budget could not be read or written; rendering stopped.                 |
| `rate_limited`             | Browser Run answered 429 on every try (5).                                      |
| `page_failed`              | Browser Run answered 422: the page timed out, crashed or errored while loading. |
| `api_error`                | Browser Run answered another error status.                                      |
| `bad_reply`                | The reply was not the documented `{success: true, result: "<html>"}`.           |
| `oversize`                 | The reply passed 10 MiB and was not read further.                               |
| `network_error`            | The request to Browser Run failed before an answer.                             |
| `challenged`               | A side of the render is a challenge or block page (challenge.ts).               |
| `measure_failed`           | Counting the words of the two renders threw.                                    |
| `nothing_rendered`         | The rendered side has no words, so there is no share.                           |

## Contract gaps

The engine returns `browser_ms` and each unrendered page's reason on its own `RenderOutcome`. The
contract has no field for either: browser-seconds per check (`UsageEvent.compute_seconds` is worker
and server time, per account), and the reason a sampled page has no `without_js`. Both go into the
next contract revision.

## Determinism

Offline, a replayed reply is identical every time, so the two bounds are held to real renders only.
`live.test.ts` runs when the environment holds the credentials and is skipped otherwise: two renders of
one page within 2 % in rendered words; the two sides of a static page within
5 %; and a probe page showing Cloudflare refuses what the policy refuses while an
ordinary request loads. Running it nightly is a CC-20 item.
