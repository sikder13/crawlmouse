# QA lab — the sites the QA accounts audit

Static, invented websites under `*.lab.crawlmouse.com`, one per host the QA account set names in
`scripts/qa/accounts.ts` (`QA_HOSTS`). Every business, person and place in them is invented, and
every page says so in its footer (app-shell's footer is built by its script).

## How it is served

- **Vercel project `crawlmouse-qa-lab`** (team `nahl-technologies-projects`), Root Directory
  `fixtures/qa-lab`, no framework and no build. `vercel.json`'s `ignoreCommand` skips a deployment
  when nothing under this folder changed since the last deployed commit, and builds when that commit
  is unknown.
- **Routing by host.** `vercel.json` rewrites each host into `sites/<label>/`. The lab's own paths
  (`/sites/…`, `/blocked.html`, `/404.html`, with or without a trailing slash, in any case) and any path holding a `%` answer 404 on every host,
  because Vercel serves a file at the requested path ahead of a rewrite, percent-encoded spellings
  included. So nothing else may sit at the lab's root (`scripts/qa/accounts.test.ts` holds it). The bare deployment URL answers 404. Another name under
  `*.lab` resolves but has no certificate, so a request to it fails at TLS.
- **Two small functions.** A static file cannot answer late, so `slow.lab.crawlmouse.com` is rewritten to `api/slow.mjs`,
  which serves the files of `sites/slow/` by looking the path up in that folder's list. A static file cannot change
  by itself either, so `sentinel.lab.crawlmouse.com` and `sentinel-b.lab.crawlmouse.com` are rewritten to
  `api/sentinel.mjs`, which tells them apart by the `Host` header, does the same for each host's own folder
  (`sites/sentinel/`, `sites/sentinel-b/`) and writes robots.txt from the clock. Each host must be added to the
  Vercel project before it answers; `/api/*` answers 404 on every host when requested directly.
- **Redirects.** A site may list moved addresses (`site.redirects` in `generate.mjs`). Each becomes a route that
  answers 301 with the absolute address it moved to, ahead of the host's rewrite, so a moved address has no page.
- **The large lab's function.** The four `large*` hosts are rewritten to `api/large.mjs`, which renders
  about 2,500 pages from the request path and fixed tables, so none is a committed file. It tells the hosts
  apart by the `Host` header. Each host must be added to the Vercel project before it answers (see
  [The large lab](#the-large-lab)).
- **Kept out of search** (`docs/OPERATING-RULES.md` §13). Every page and 404 the routes answer carries `X-Robots-Tag:
noindex`, except to a user agent containing `Crawlmouse`. Vercel's own redirects and errors (the
  308s that add https or collapse `//`, a 400 for a raw `..`) carry none and hold no content. The exception is
  load-bearing: the engine drops a `noindex` page from the graded population, so a lab served with
  the header to our crawler would be refused a grade. robots.txt does not disallow search engines: a
  crawler kept out by robots.txt never fetches the page, so never reads the header.
- **DNS.** One record in Cloudflare zone `crawlmouse.com`: `*.lab` CNAME `cname.vercel-dns.com`, DNS
  only. Vercel issues each host's certificate.
- **Politeness.** Every lab host shares the politeness key `crawlmouse.com`, so checks of different
  lab sites wait on one another (`docs/specs/v2/38-launch-qa.md`, Known gaps), unless the staging
  worker sets `LAB_HOST_POLITENESS=1` (`docs/ops/worker-runbook.md`, "Lab hosts on staging").

## Editing

`generate.mjs` writes `sites/`, `vercel.json`, `404.html` and `blocked.html`. Edit the generator, never
its output, then:

```bash
node fixtures/qa-lab/generate.mjs
pnpm --filter @crawlmouse/scripts exec vitest run qa/accounts.test.ts
```

The test fails when the committed output is not what the generator writes, when a lab host in
`QA_HOSTS` has no folder or route, or when the pages pass 500. The four `large*` hosts are exempt from
the 500, and only they: the test names them, holds each to 2,600, and keeps every other host under 500
together. `api/large.mjs` is edited by hand; its tests are `scripts/qa/large-lab.test.ts`.

## What each site is built to show

What a site _contains_ is set in `generate.mjs`, one commented block per site. What the engine
_grades_ it is measured, not written here; to read it:

```bash
pnpm smoke -- --url=https://healthy.lab.crawlmouse.com
```

| Host                  | Built to show                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `healthy`             | a well-linked guide site: no orphans, depth ≤ 3, varied anchors, sitemap, `llms.txt`, JSON-LD                                                                                   |
| `app-shell`           | a client-rendered app: the HTML is an empty `<div id="root">` and a script                                                                                                      |
| `cf-blocked`          | a firewall block: 403 to a user agent containing `Crawlmouse`, 200 to a browser                                                                                                 |
| `client-1`            | sitemap-only orphan pages; one repeated anchor into each section; no JSON-LD                                                                                                    |
| `client-2`            | a deep chain of pages; "Read more" links; a few orphans                                                                                                                         |
| `client-3`            | two broken internal links (404); three redirected links (301: one hop to a page, two hops to a page, two hops to a 404); a deep chain; no sitemap; robots.txt disallows GPTBot  |
| `client-4`            | a larger, mostly sound site whose text nav links three sections with the same words on every page                                                                               |
| `client-5`            | many orphans, generic anchors and deep pages on a small site; no JSON-LD                                                                                                        |
| `client-6`            | a five-item text nav on every page, deep pages, orphans; robots.txt disallows GPTBot                                                                                            |
| `trial-client-1`      | a middling site for the Agency trial: some orphans, "Learn more" links                                                                                                          |
| `demo-1` … `3`        | polished fictional businesses with a few fixes that read well                                                                                                                   |
| `slow`                | an ordinary small site whose HTML pages each answer after 3 seconds (`api/slow.mjs`, journey J0.8g)                                                                             |
| `sentinel`            | a small site whose robots.txt disallows GPTBot in odd UTC hours (`api/sentinel.mjs`, journey J2.4i)                                                                             |
| `sentinel-b`          | the same function's twin: robots.txt disallows GPTBot on even UTC days (days since 1970-01-01), so a watch on an even day finds a block that a full check on an odd day did not |
| `large`               | about 2,500 pages of an invented garden shop, answered at once (`api/large.mjs`)                                                                                                |
| `large-slow`          | the same pages, each HTML page answered after 1 second                                                                                                                          |
| `large-throttle`      | the same pages; 429 with `Retry-After` above the throttle rule below                                                                                                            |
| `large-throttle-bare` | the same pages; 429 without `Retry-After` above the same rule                                                                                                                   |
| `dense`               | 2,000 pages, about 100 links each, about 200,000 edges, the same on every check (`api/dense.mjs`)                                                                               |

Check every host answers:

```bash
for h in healthy app-shell cf-blocked client-{1..6} trial-client-1 demo-{1..3}; do
  printf '%-16s %s\n' "$h" "$(curl -s -o /dev/null -w '%{http_code}' "https://$h.lab.crawlmouse.com/")"
done
curl -sI -A "Crawlmouse/1.0" https://cf-blocked.lab.crawlmouse.com/ | head -1
curl -sI https://healthy.lab.crawlmouse.com/sites/cf-blocked/ | head -1
```

The loop prints 200 for each host; the next line prints `HTTP/2 403` and the last `HTTP/2 404`.

Check the lab stays out of search and in reach of the crawler:

```bash
curl -sI https://healthy.lab.crawlmouse.com/ | grep -i x-robots-tag
curl -sI -A "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" \
  https://demo-1.lab.crawlmouse.com/ | grep -i x-robots-tag
curl -sI -A "CrawlmouseBot/1.0 (+https://crawlmouse.com/bot)" https://healthy.lab.crawlmouse.com/ \
  | grep -ci x-robots-tag
```

The first two print `x-robots-tag: noindex`; the third prints `0`.

## The large lab

Four hosts serve the same pages from `api/large.mjs`, for the large-crawl design study (inbox 067). A
page differs between hosts only in the host name in its absolute URLs (canonical, sitemap, robots.txt).

**The pages.** An invented garden-supply shop: a home page, eight departments, forty sections whose
article lists are paginated twelve to a page, articles with breadcrumbs, dated "Filed under" topic
links and next, previous and same-subject links, forty-eight topic pages, an about page, a contact
page, and a shop diary whose entries link only to their neighbours (the deep tail). Every page's footer
says the business is invented. `sitemap.xml` lists every page; `robots.txt` allows everything and names
the host's sitemap. The page count and the depth histogram, by a breadth-first walk over the links the
served HTML holds, are printed by the test:

```bash
pnpm --filter @crawlmouse/scripts exec vitest run qa/large-lab.test.ts 2>&1 | grep 'depth histogram'
```

**How each host answers.**

| Host                                     | Answer                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `large.lab.crawlmouse.com`               | at once                                                                |
| `large-slow.lab.crawlmouse.com`          | each HTML page after 1,000 ms; robots.txt, the sitemap and CSS at once |
| `large-throttle.lab.crawlmouse.com`      | the throttle rule, with `Retry-After`                                  |
| `large-throttle-bare.lab.crawlmouse.com` | the throttle rule, with no `Retry-After`                               |

**The throttle rule** (`THROTTLE_LIMIT` and `THROTTLE_WINDOW_MS` in `api/large.mjs`): requests are
counted per client address and per host, in fixed 10-second windows that start at whole multiples of
ten seconds of Unix time. **More than 18 requests in a window answers 429**: the 19th request in a
window and every later one in that window. Every request counts, the 429s, 404s, robots.txt and the
sitemap included. On `large-throttle` the 429 carries `Retry-After`, the seconds left in the window
rounded up (1 to 10); on `large-throttle-bare` it carries none.

Why 18: it is 1.8 requests a second. A crawler at a steady 2 a second sends 20 a window and gets 429
on 2 of every 20 (the 19th and 20th), so it is throttled sometimes and not always; one at 1.8 a second
or slower is never throttled; one at 5 a second gets 429 on 32 of every 50.

**How a client recovers.** At the next window boundary, at most 10 seconds after any 429, the count
starts again from one, so the next 18 requests in that window answer 200. Nothing else is kept: there
is no ban, no penalty for the number of 429s, and a count from a past window is never read. A client
that waits out the window (on `large-throttle`, for `Retry-After` seconds) gets 200 again; one that
slows to 18 requests a window or fewer gets 200 on every request from the next window on. Slowing down
inside a window does not help within that window, because its 429s still count. The tests that hold
this, on both throttle hosts: `recovers: after many 429s…` in `scripts/qa/large-lab.test.ts`.

**The count is per function instance.** It lives in the instance's memory and is not shared, so when
Vercel runs two instances a client's requests are split between two counts and it can send more than
18 in a window without a 429. What the site really did is therefore in the runtime logs, not in the
rule: every request to the four hosts writes one JSON line to the function's output.

```json
{
  "lab": "large",
  "t": "2026-11-23T12:00:04.100Z",
  "host": "large-throttle.lab.crawlmouse.com",
  "variant": "throttle",
  "path": "/",
  "client": "<16 hex>",
  "instance": "<uuid>",
  "window": "2026-11-23T12:00:00.000Z",
  "count": 19,
  "limit": 18,
  "status": 429,
  "retryAfter": 6,
  "delayMs": 0
}
```

`client` is the first 16 hex characters of the SHA-256 of the address Vercel reports (the first
`x-forwarded-for` entry), unsalted, so a reader who knows an address can match it, and it is a pseudonym
rather than anonymisation. `instance` tells instances apart, and `count` is that instance's count.
`count`, `limit` and `window` are `null` on the fast and slow hosts, which count nothing. To check a
measurement, read the lines for the crawl's time span from the project's runtime logs, group them by
`instance`, and compare each 429 and 200 with what the crawler recorded.

**Domains.** Each of the four hosts must be added to the Vercel project `crawlmouse-qa-lab` before it
answers; until then a request fails at TLS like any other unnamed `*.lab` host. The `*.lab` DNS record
already covers them.

Check the hosts answer, as the crawler (the `Crawlmouse` user agent gets no `X-Robots-Tag`):

```bash
UA="CrawlmouseBot/1.0 (+https://crawlmouse.com/bot)"
for h in large large-slow large-throttle large-throttle-bare; do
  curl -s -o /dev/null -A "$UA" -w "$h %{http_code} %{time_total}s\n" "https://$h.lab.crawlmouse.com/about/"
done
for i in $(seq 1 22); do
  curl -s -o /dev/null -A "$UA" -w '%{http_code} ' https://large-throttle.lab.crawlmouse.com/robots.txt
done; echo
```

The first loop prints 200 for each host, `large-slow` about a second slower than the rest. The second
prints 200s then 429s once a window passes 18, if the 22 requests reach one instance inside one window.

## The dense lab

`dense.lab.crawlmouse.com` is served by `api/dense.mjs`, for the persist work (c/038). It is 2,000 pages, each built from its path and fixed tables with a seeded generator, so the site is the same on every request and between checks.

- **The shape:** a home page, 20 sections and 1,979 notes.
  - The home page links to the 20 sections and the first 80 notes.
  - A section links to the home page and each of its notes.
  - A note links to the home page, its section, its neighbours in the section and seeded others, 100 in all.
- **Depth:** every note is two clicks from the home page.
- **Sitemap and robots:** `sitemap.xml` lists all 2,000 pages, and `robots.txt` allows everything.
- **The figures** are held by `scripts/qa/dense-lab.test.ts`: the page count, the links per page, the edge total and the depth.

**Domain.** The host must be added to the Vercel project `crawlmouse-qa-lab` before it answers, like the large four. The `*.lab` DNS record already covers it.

```bash
curl -s -o /dev/null -A "CrawlmouseBot/1.0 (+https://crawlmouse.com/bot)" -w "%{http_code}\n" https://dense.lab.crawlmouse.com/p/0001/
```
