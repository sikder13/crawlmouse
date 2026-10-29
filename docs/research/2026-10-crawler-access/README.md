# Crawler access tests, October 2026

Raw material for the v2 engine design and for public research writing. Three rounds of live tests, each fetching real sites with the published user-agent strings of AI crawlers and comparing the answers with a browser control fetch.

| File | What | When | Egress |
|---|---|---|---|
| `01-homepage-probe-96-sites.md` | Homepages of 96 sites (48 large, 48 small-business and local) fetched as 8 identities, plus a 16-site tagged-UA addendum | 25 Oct 2026 | Supabase Edge Function (cloud IP) |
| `02-sample-probe.md` | Sampled pages of 10 non-discriminating sites (POC-2) and 5 discriminating sites (POC-2b); budgets, limits and probe bugs found | 26 Oct 2026 | Supabase Edge Function (cloud IP) |
| `fly-run-2/*.json` | Verdict counts per site and crawler for the same 5 discriminating sites, throughput on 9 sites, slow-host run, worker metrics | 27 Oct 2026 | Fly.io worker (dedicated cloud IP) |

## What the three rounds show together

- The answer a site gives depends on who is asking, not only on the user-agent string. nike.com, en.wikipedia.org and neilpatel.com answered differently from the Supabase egress and from the Fly egress. A simulated request therefore measures how a site treats the requesting infrastructure, and conclusions drawn from it must be labelled as simulated.
- Small-business sites mostly let every crawler in; large sites more often block automation at the edge regardless of user agent.
- Tagging our user-agent strings with a Crawlmouse suffix changed no answer on the 16 sites tested.

## Limits

Each round has its own limits section. In short: homepages are not whole sites; cloud IPs are not the crawlers' own IPs; POC-2 did not read robots.txt (a probe bug found and fixed in POC-2b); fly-run-2 saved counts per site, not each page's response. Numbers here are dated observations of the sites as they were on those days.
