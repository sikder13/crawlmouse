# Cloudflare AI-crawler policy panel

Cloudflare's default AI-crawler settings change on **15 September 2026**. This directory measures
what actually changes, on a fixed panel of websites, with snapshots taken before and after the date.

The code and the raw snapshots are public on purpose. A study of who blocks which crawler is only
worth reading if someone else can re-run it, so the panel, the method and every captured file are in
the repository rather than described in a write-up.

## What this is not

It is not a crawler. It never requests a page, never reads page content, never follows a link found
on a site, and stores no HTML. It reads two public policy files and one set of response headers.

## The panel

`panel.json` — built once, then frozen.

Domains are drawn from a **dated Tranco list** (`tranco-list.eu`), whose list id and download URL are
recorded in `panel.json`. "The Tranco list" changes daily, so a study that records only the name of
the list cannot be re-derived; the id is what makes this reproducible.

Candidates are sampled at a uniform stride across **ranks 1,000–100,000**, so the panel is not just
mega-sites. Each candidate is probed for two public signals:

- **Cloudflare-proxied** — the homepage response carries a `cf-ray` header, or `server: cloudflare`.
- **Ad-supported** — `/ads.txt` returns 200 with a body that parses as a plausible ads.txt: at least
  one line of three or more comma-separated fields whose first field is a domain. Bodies that begin
  with `<` are rejected, because a great many sites answer `/ads.txt` with an HTML error page and
  those soft 404s would otherwise fill the ad-supported stratum with sites that carry no ads.

Probing stops as soon as all three strata are full, so the panel's ACHIEVED rank range is narrower
than the sampling window: the baseline panel spans ranks 1,000–67,716 (median 17,094) because
`cf_ads` filled at candidate 5,160 of 7,616. `rankRange` in panel.json records the window that was
sampled, not the range that was reached; the reached range is a property of the entries.

Three strata are filled, and probing stops once they are full:

| group | Cloudflare | ads.txt | target |
|---|---|---|---|
| `cf_ads` | yes | yes | 400 |
| `cf_no_ads` | yes | no | 100 |
| `ads_no_cf` | no | yes | 100 |

Each entry records the domain, its Tranco rank, its group, and the probe evidence the assignment was
made from — the `server` header, whether `cf-ray` was present, and both status codes — so an
assignment can be audited rather than taken on trust.

**The panel is frozen after the first snapshot.** `research:build-panel` refuses to overwrite
`panel.json` once any snapshot directory exists. The panel is the denominator of every published
percentage; changing it mid-study would silently change what the before/after numbers compare.

## What each run captures

`snapshots/<YYYY-MM-DD>/<domain>.json`, one file per domain:

- `fetchedAt` — ISO timestamp.
- `robots` — final URL after redirects, HTTP status, the raw body, its `sha256`, the body length in
  bytes, and a `truncated` flag. Bodies are stored up to **512 KB**; the hash is of the **stored**
  bytes, so a hash in a file always describes the text in that file. A robots.txt over 2 MB is
  recorded as an error rather than truncated.
- `access` — per-token access, one row per crawler token (see below).
- `contentSignals` — every Content Signals line, verbatim and in file order. These live in robots.txt
  *comments*, so they are read from the raw text; a parser that strips comments cannot see them.
- `homepage` — status, `server` header, and whether `cf-ray` was present.
- `adsTxt` — status code only. The body is read during panel construction and never stored.
- `groupMismatch` — set when the re-verified signals no longer match the frozen group assignment.
  **Read this field with care: it compares across two different request methods.** The panel build
  fetches `/ads.txt` with GET, because it needs the body to decide whether the file is real; a
  snapshot uses HEAD, because it only needs the status. A great many WAFs answer HEAD with 403 on a
  URL they serve happily over GET, so a `200 → 403` mismatch is usually the method, not the site. Of
  the 600 domains in the baseline run, 19 flagged this way and every one was an ads.txt status
  change of that shape (14 × 403, 4 × 404, 1 × 520).
  The published diff is NOT affected: it compares snapshot to snapshot, HEAD against HEAD, so both
  sides use the same method. `groupMismatch` is a diagnostic on the frozen assignment, not an input
  to any percentage in a report.

A domain that fails is written with its error, never dropped. A run whose failures disappear reports
a denominator it did not measure.

### Crawler tokens

The AI tokens are imported from `@crawlmouse/engine` (`AI_BOT_REGISTRY`) rather than re-listed here,
so the study measures the same bots the product measures. `Googlebot`, `Bingbot` and `Applebot` are
added for the multi-purpose-crawler question: Cloudflare applies the strictest matching policy to a
crawler that does more than one job, so a zone blocking Training can take a search crawler with it.

### How access is decided

User-agent groups are selected by **RFC 9309 / Google's rule**: a group matches when its user-agent
value is a case-insensitive prefix of the crawler token, and the longest matching group wins, with
`*` as the fallback. Path matching — wildcards, `$`, longest-rule-wins, allow-beats-disallow — is
delegated to the engine's matcher, so there is no second copy of it.

This is deliberately *not* the engine's own group selection, which looks the token up as an exact key
and otherwise falls through to `*`. The two disagree: given `User-agent: Applebot` / `Disallow: /`,
exact-key lookup reports `Applebot-Extended` as allowed and prefix matching reports it as blocked.
Both behaviours are pinned in `robots-access.test.ts`.

The four states are `allowed`, `disallowed_root`, `partially_disallowed` and `unmentioned`.
`unmentioned` means *nothing in the file applies* — no matching group and no `*` group. A site whose
`*` group blocks everything is reported as `disallowed_root` even though the bot is not named,
because that site has blocked the bot; the separate `mentioned` flag records whether it was named.

## Request footprint

**At most three lightweight requests per domain per run:**

1. `HEAD /` — headers only, falling back to `GET` with the body stream cancelled unread.
2. `GET /robots.txt`
3. `HEAD /ads.txt` — status only.

- Concurrency **10**, per-request timeout **10 s**.
- **One** retry, and only on a thrown network error — a DNS failure, refused connection, TLS error or
  timeout. An HTTP response is a result whatever its status, so a 403 or a 500 is recorded, never
  retried.
- User-agent: `CrawlmouseResearch/1.0 (+https://crawlmouse.com/bot)`
- Every request, and every redirect hop, passes the engine's SSRF guard.

## Reports

`pnpm research:diff -- --from <date> --to <date>` writes `reports/<from>_to_<to>.json` and prints a
table. Reports carry **aggregate counts and percentages only** — no per-domain listings. Every count
is published with the denominator it was taken over, because "10% of the panel" and "10% of the
domains whose robots.txt was readable in both runs" are different claims. The per-domain record is
the snapshot files, which anyone can read.

`--examples N` will add up to N domain names, for the researcher's own verification. It defaults to
0 and should stay there for anything published.

## Commands

```bash
nvm use 22
pnpm research:build-panel                     # once, before the first snapshot
pnpm research:snapshot                         # one run, dated today
pnpm research:diff -- --from 2026-09-10 --to 2026-09-16

pnpm research:build-panel -- --limit 15        # a 15-domain rehearsal
pnpm research:snapshot -- --limit 15 --date 2026-09-10
```

`.cache/` holds the Tranco download and is gitignored; `panel.json`, `snapshots/` and `reports/` are
committed.

## Run dates

| run | date | why |
|---|---|---|
| baseline | 2026-09-06 | before the change |
| pre-change | 2026-09-13 / 14 | immediately before, to separate ordinary churn from the change |
| after | 2026-09-16 | the day after |
| settled | 2026-09-20 | once any staged rollout has propagated |

The baseline cannot be taken after the 15th, which is the whole reason for the deadline.

The pre-change run is what makes the result defensible rather than suggestive. Without it, anything
that moves between the baseline and the 16th could be ordinary robots.txt churn; with it, the same
measurement over an equivalent quiet window gives a background rate to compare against.
