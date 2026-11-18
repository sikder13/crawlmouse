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
  (`/sites/…`, `/blocked.html`, `/404.html`) and any path holding a `%` answer 404 on every host,
  because Vercel serves a file at the requested path ahead of a rewrite, percent-encoded spellings
  included. So nothing else may sit at the lab's root (`scripts/qa/accounts.test.ts` holds it). The bare deployment URL answers 404. Another name under
  `*.lab` resolves but has no certificate, so a request to it fails at TLS.
- **Kept out of search** (`docs/OPERATING-RULES.md` §13). Every response carries
  `X-Robots-Tag: noindex` except to a user agent containing `Crawlmouse`, and every `robots.txt`
  disallows the search engines (Googlebot, Bingbot and the other major ones) while allowing everyone
  else. The Crawlmouse exception is load-bearing: the engine drops a `noindex` page from the graded
  population, so a lab served with the header to our crawler would be refused a grade.
- **DNS.** One record in Cloudflare zone `crawlmouse.com`: `*.lab` CNAME `cname.vercel-dns.com`, DNS
  only. Vercel issues each host's certificate.
- **Politeness.** Every lab host shares the politeness key `crawlmouse.com`, so checks of different
  lab sites wait on one another (`docs/specs/v2/38-launch-qa.md`, Known gaps).

## Editing

`generate.mjs` writes `sites/`, `vercel.json`, `404.html` and `blocked.html`. Edit the generator, never
its output, then:

```bash
node fixtures/qa-lab/generate.mjs
pnpm --filter @crawlmouse/scripts exec vitest run qa/accounts.test.ts
```

The test fails when the committed output is not what the generator writes, when a lab host in
`QA_HOSTS` has no folder or route, or when the pages pass 500.

## What each site is built to show

What a site _contains_ is set in `generate.mjs`, one commented block per site. What the engine
_grades_ it is measured, not written here; to read it:

```bash
pnpm smoke -- --url=https://healthy.lab.crawlmouse.com
```

| Host             | Built to show                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `healthy`        | a well-linked guide site: no orphans, depth ≤ 3, varied anchors, sitemap, `llms.txt`, JSON-LD     |
| `app-shell`      | a client-rendered app: the HTML is an empty `<div id="root">` and a script                        |
| `cf-blocked`     | a firewall block: 403 to a user agent containing `Crawlmouse`, 200 to a browser                   |
| `client-1`       | sitemap-only orphan pages; one repeated anchor into each section; no JSON-LD                      |
| `client-2`       | a deep chain of pages; "Read more" links; a few orphans                                           |
| `client-3`       | two broken internal links (404); a deep chain; no sitemap; robots.txt disallows GPTBot            |
| `client-4`       | a larger, mostly sound site whose text nav links three sections with the same words on every page |
| `client-5`       | many orphans, generic anchors and deep pages on a small site; no JSON-LD                          |
| `client-6`       | a five-item text nav on every page, deep pages, orphans; robots.txt disallows GPTBot              |
| `trial-client-1` | a middling site for the Agency trial: some orphans, "Learn more" links                            |
| `demo-1` … `3`   | polished fictional businesses with a few fixes that read well                                     |

Check every host answers:

```bash
for h in healthy app-shell cf-blocked client-{1..6} trial-client-1 demo-{1..3}; do
  printf '%-16s %s\n' "$h" "$(curl -s -o /dev/null -w '%{http_code}' "https://$h.lab.crawlmouse.com/")"
done
curl -sI -A "Crawlmouse/1.0" https://cf-blocked.lab.crawlmouse.com/ | head -1
curl -sI https://healthy.lab.crawlmouse.com/sites/cf-blocked/ | head -1
```

The loop prints 200 for each host; the next line prints `HTTP/2 403` and the last `HTTP/2 404`.
