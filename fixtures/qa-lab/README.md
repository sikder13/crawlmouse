# QA lab — the sites the QA accounts audit

Static, invented websites under `*.lab.crawlmouse.com`, one per host the QA account set names in
`scripts/qa/accounts.ts` (`QA_HOSTS`). Every business, person and place in them is fictional, and
each page's footer says so.

## How it is served

- **Vercel project `crawlmouse-qa-lab`** (team `nahl-technologies-projects`), Root Directory
  `fixtures/qa-lab`, no framework and no build. `vercel.json`'s `ignoreCommand` skips a deployment
  when nothing under this folder changed.
- **Routing by host.** `vercel.json` rewrites each host into `sites/<label>/`. A host the file does
  not name, and the bare deployment URL, get a 404.
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

| Host             | Built to show                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `healthy`        | a well-linked guide site: no orphans, depth ≤ 3, varied anchors, sitemap, `llms.txt`, JSON-LD  |
| `app-shell`      | a client-rendered app: the HTML is an empty `<div id="root">` and a script                     |
| `cf-blocked`     | a firewall block: 403 to any user agent containing `Crawlmouse` or `crawlmouse`, 200 otherwise |
| `client-1`       | sitemap-only orphan pages; no JSON-LD                                                          |
| `client-2`       | a deep chain of pages; "Read more" links; a few orphans                                        |
| `client-3`       | a broken internal link (404); no sitemap; robots.txt disallows GPTBot                          |
| `client-4`       | a larger, mostly sound site whose text nav repeats one anchor per section on every page        |
| `client-5`       | many orphans, generic anchors and deep pages on a small site; no JSON-LD                       |
| `client-6`       | a five-item text nav on every page, deep pages, orphans; robots.txt disallows GPTBot           |
| `trial-client-1` | a middling site for the Agency trial: some orphans, "Learn more" links                         |
| `demo-1` … `3`   | polished fictional businesses with a few fixes that read well                                  |

Check every host answers:

```bash
for h in healthy app-shell cf-blocked client-{1..6} trial-client-1 demo-{1..3}; do
  printf '%-16s %s\n' "$h" "$(curl -s -o /dev/null -w '%{http_code}' "https://$h.lab.crawlmouse.com/")"
done
curl -sI -A "Crawlmouse/1.0" https://cf-blocked.lab.crawlmouse.com/ | head -1
```

Every line prints 200; the last prints `HTTP/2 403`.
