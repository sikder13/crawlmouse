# CC-V1AUDIT — every piece of v1 we are building on, ruled

Owner ruling of 2026-11-08 (HARDENING-AND-GTM-WORKPLAN §2b): before the public v2 opening, every v1
route, page, Inngest function, cron and table is listed once and ruled, and every item that stays
alive is held to the bar v2 code passes. CC-SEC's route registry
(`apps/web/lib/security/route-policy.ts`) covers who may call each API route; this step covers
everything else, and the security of what each item does once called.

Base: `origin/main` at `ee11796d` (CC-SEC and CC-27 merged), measured 2026-11-09.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | The inventory is data held to disk by a test: `docs/ops/v1-inventory.json`, checked by `apps/web/__tests__/v1-inventory.test.ts`. An item on disk with no entry fails, and so does an entry naming nothing. v2 items are left out by the rule in `apps/web/__tests__/v1-inventory-source.ts`, not by a list.                                                                                       |
| D2  | Three rulings. `retire`: v2 replaces it at the cutover (migration 009 and the flags); the entry names the replacement and the redirect. `keep`: it lives past the cutover and passes D4–D7. `delete`: provably unused (not in the sitemap, not linked from a live page, not imported, no traffic for 30 days).                                                                                     |
| D3  | `delete` items are removed in this step, one commit each, with the proof in the commit body. Nothing in `app/sitemap.ts` is deleted or moved here.                                                                                                                                                                                                                                                 |
| D4  | Each `keep` page and route has a security row: input validation; output (no `user_id`, email, token or internal id to anyone but its owner; capability reads stay admin reads); `Cache-Control: private, no-store` on authenticated pages; open redirects; error bodies; crawled or user text escaped and hrefs scheme-checked; rate limit or Turnstile where an action costs money or sends mail. |
| D5  | Each v1 table: who writes it, who reads it, what personal data it holds, and its actual retention against what `/privacy` states.                                                                                                                                                                                                                                                                  |
| D6  | Background jobs: `auditFn` fetches through `safe-fetch`, respects the plan's concurrency cap, honours `CRAWL_PAUSED` and reports `onFailure`; `reconcileBillingFn` is dry-run by construction and livemode-guarded; `cleanupExpiredAuditsFn` is bounded, idempotent and never touches `public_reports` snapshots.                                                                                  |
| D7  | `keep` pages answer their designed status on the production build, log no console error, and keep `main`'s title, canonical and robots meta: `apps/web/tests/e2e/v1-keep.spec.ts`, driven by the inventory.                                                                                                                                                                                        |
| D8  | A blocker or major in a `keep` item outside the engine and outside CC-20b's and CC-03's files is fixed here, test first. Engine findings go to CC-SEC-2 (a blocker stops the step); CC-20b and CC-03 findings go to those sessions through the owner; minors become follow-ups with an owner.                                                                                                      |
| D9  | `apps/web/lib/seo/jsonld.tsx` escapes `<`, `>`, `&`, U+2028 and U+2029 in its serialised JSON, whoever calls it.                                                                                                                                                                                                                                                                                   |
| D10 | The advisor's four `SECURITY DEFINER` functions are each tested on PGlite: a caller with no seat gets nothing. "Leaked password protection" is recorded as not applicable.                                                                                                                                                                                                                         |
| D11 | No migration, no engine edit, no v2 code, no change to `robots.txt`, the sitemap or any public page's title, heading or canonical, except D9's escaping and D3's deletions.                                                                                                                                                                                                                        |
| D12 | This document is the deliverable. Its inventory sections are rendered from the JSON.                                                                                                                                                                                                                                                                                                               |

## What counts as v1

The finders in `apps/web/__tests__/v1-inventory-source.ts` list, from the tree:

- every `page.*`, Next metadata or special file (`layout`, `opengraph-image`, `icon`, `apple-icon`,
  `not-found`, `global-error`, `sitemap` and the rest of Next's conventions) and `route.*` under
  `apps/web/app`, except under the `(v2-preview)` or `(account)` route group or `app/api/checks/`;
- every top-level `export const x = inngest.createFunction(…)` in the `inngest` package, and the cron
  in its trigger. CC-20b and CC-03 build their functions inside factories registered behind their
  flags, so they are not listed;
- every table created by a migration whose file name does not contain `_v2_`.

## Inventory by kind and ruling

<!-- prettier-ignore-start -->
<!-- v1-inventory:counts -->
| kind | keep | retire | delete | total |
| --- | ---: | ---: | ---: | ---: |
| page | 18 | 6 | 0 | 24 |
| metadata | 9 | 0 | 0 | 9 |
| route | 25 | 9 | 0 | 34 |
| inngest | 2 | 2 | 0 | 4 |
| cron | 1 | 1 | 0 | 2 |
| table | 11 | 7 | 0 | 18 |
| **all** | 66 | 25 | 0 | 91 |
<!-- /v1-inventory:counts -->
<!-- prettier-ignore-end -->

## Cutover list

Every `retire` item, with what replaces it and where its URL goes. The source of each is ARCH-2 §6.2
(URLs), its legacy-table table and §6.1 (migration 009), and its list of Inngest function ids; the
rows that matter here are reproduced below so this repository holds the basis of each ruling.

<!-- prettier-ignore-start -->
<!-- v1-inventory:cutover -->
| kind | item | replaced by | redirect |
| --- | --- | --- | --- |
| page | `/` (`app/page.tsx`) | v2 Home (CC-21 screens/home), same URL | / |
| page | `/audit/[id]` (`app/audit/[id]/page.tsx`) | v2 result and segment pages under /audit/[id] (CC-22), same ids | /audit/[id] |
| page | `/compare` (`app/compare/page.tsx`) | v2 competitor feature inside the account | none |
| page | `/compare/[a]/[b]` (`app/compare/[a]/[b]/page.tsx`) | v2 competitor feature inside the account | none |
| page | `/dashboard` (`app/dashboard/page.tsx`) | v2 Dashboard home (CC-26), same URL | /dashboard |
| page | `/top/[platform]` (`app/top/[platform]/page.tsx`) | nothing; leaderboards are removed at cutover | 410 |
| route | `app/api/audits/[id]/cancel/route.ts` | /api/checks/* (CC-22), behind a 90-day alias for cached clients | alias |
| route | `app/api/audits/[id]/export/route.ts` | /api/checks/* (CC-22), behind a 90-day alias for cached clients | alias |
| route | `app/api/audits/[id]/llms-txt/route.ts` | /api/checks/* (CC-22), behind a 90-day alias for cached clients | alias |
| route | `app/api/audits/[id]/notify/route.ts` | /api/checks/* (CC-22), behind a 90-day alias for cached clients | alias |
| route | `app/api/audits/[id]/reaudit/route.ts` | /api/checks/* (CC-22), behind a 90-day alias for cached clients | alias |
| route | `app/api/audits/[id]/stream/route.ts` | /api/checks/* (CC-22), behind a 90-day alias for cached clients | alias |
| route | `app/api/audits/start/route.ts` | /api/checks (CC-22), behind a 90-day alias | alias |
| route | `app/api/trpc/[trpc]/route.ts` | nothing; removed at cutover | none |
| route | `app/billing/route.ts` | /settings/plan (v2 settings) | /settings/plan |
| inngest | `inngest/audit.ts#auditFn` | crawlmouse.check.run (CC-20b checkFn) | n/a |
| inngest | `inngest/billing.ts#cleanupExpiredAuditsFn` | crawlmouse.cleanup.daily (v2) | n/a |
| cron | `inngest/billing.ts#cleanupExpiredAuditsFn` | the crawlmouse.cleanup.daily schedule (v2) | n/a |
| table | `public.audits` | checks | n/a |
| table | `public.pages` | page_results | n/a |
| table | `public.links` | link_edges | n/a |
| table | `public.findings` | fixes and page_results columns | n/a |
| table | `public.fixes` | site_fixes | n/a |
| table | `public.sessions` | Supabase Auth (never used) | n/a |
| table | `public.benchmark_cohorts` | nothing (leaderboards leave) | n/a |
<!-- /v1-inventory:cutover -->
<!-- prettier-ignore-end -->

## Every ruling

<!-- prettier-ignore-start -->
<!-- v1-inventory:rulings -->
| kind | item | ruling | reason | evidence |
| --- | --- | --- | --- | --- |
| page | `/` (`app/page.tsx`) | retire | v2 serves a new Home at the same URL; the v1 component goes at cutover | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| page | `/ai-readiness-checker` (`app/ai-readiness-checker/page.tsx`) | keep | SEO landing in the sitemap; ARCH-2 keeps it as a landing page that posts to /api/checks | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| page | `/audit/[id]` (`app/audit/[id]/page.tsx`) | retire | capability URL kept; V2_READS switches it to read checks | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| page | `/aup` (`app/aup/page.tsx`) | keep | legal page, kept | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| page | `/authors/[slug]` (`app/authors/[slug]/page.tsx`) | keep | blog author pages, kept with the blog | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| page | `/blog` (`app/blog/page.tsx`) | keep | organic traffic, kept with the same slugs | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| page | `/blog/[slug]` (`app/blog/[slug]/page.tsx`) | keep | organic traffic, kept with the same slugs | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| page | `/blog/research` (`app/blog/research/page.tsx`) | keep | blog tag page, kept with the blog | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| page | `/bot` (`app/bot/page.tsx`) | keep | crawler UA page referenced in the UA string, kept | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| page | `/compare` (`app/compare/page.tsx`) | retire | head-to-head leaves with v1; not in the sitemap, and ARCH-2 names no target for the index (questions Q2) | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| page | `/compare/[a]/[b]` (`app/compare/[a]/[b]/page.tsx`) | retire | kept 90 days with noindex; ARCH-2 says 301 to /r/[a], but [a] is an audit id and /r/ takes a minted slug, so that target would 404 (questions Q5); not in the sitemap | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| page | `/dashboard` (`app/dashboard/page.tsx`) | retire | v2 serves the dashboard at the same URL | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| page | `/developers` (`app/developers/page.tsx`) | keep | OG holding page and waitlist, kept | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| page | `/guides` (`app/guides/page.tsx`) | keep | organic traffic, kept | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| page | `/login` (`app/login/page.tsx`) | keep | magic-link sign-in, kept; /signup is added beside it | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| page | `/pricing` (`app/pricing/page.tsx`) | keep | kept | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| page | `/privacy` (`app/privacy/page.tsx`) | keep | legal page, kept (gains the evidence-retention statement) | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| page | `/r/[slug]` (`app/r/[slug]/page.tsx`) | keep | public reports; old snapshots keep rendering with the v1 component until re-minted | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| page | `/status` (`app/status/page.tsx`) | keep | kept | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| page | `/subprocessors` (`app/subprocessors/page.tsx`) | keep | legal page, kept | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| page | `/takedown` (`app/takedown/page.tsx`) | keep | legal page and form, kept | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| page | `/terms` (`app/terms/page.tsx`) | keep | legal page, kept | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| page | `/top/[platform]` (`app/top/[platform]/page.tsx`) | retire | removed at cutover (410 Gone); not in the sitemap and noindex while thin | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| page | `/verify/[id]` (`app/verify/[id]/page.tsx`) | keep | domain verification for claims, kept | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| metadata | `app/layout.tsx` | keep | root layout of every v1 page and of the v2 route groups | apps/web/app/layout.tsx:1 |
| metadata | `app/opengraph-image.tsx` | keep | site OG card | apps/web/app/opengraph-image.tsx:1 |
| metadata | `app/blog/[slug]/opengraph-image.tsx` | keep | blog post OG cards; the blog is kept | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| metadata | `app/r/[slug]/opengraph-image.tsx` | keep | public report OG cards; /r/ is kept | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| metadata | `app/icon.tsx` | keep | favicon | apps/web/app/icon.tsx:1 |
| metadata | `app/apple-icon.tsx` | keep | touch icon | apps/web/app/apple-icon.tsx:1 |
| metadata | `app/not-found.tsx` | keep | site 404 page | apps/web/app/not-found.tsx:1 |
| metadata | `app/global-error.tsx` | keep | root error boundary (reports to Sentry) | apps/web/app/global-error.tsx:1 |
| metadata | `app/sitemap.ts` | keep | sitemap; outside this step's allowed paths (§13) | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| route | `app/api/admin/takedown/process/route.ts` | keep | takedown processing; legal obligation | apps/web/lib/security/route-policy.ts:37 |
| route | `app/api/audits/[id]/cancel/route.ts` | retire | v1 audit API, replaced by the checks API | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| route | `app/api/audits/[id]/export/route.ts` | retire | v1 audit API, replaced by the checks API | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| route | `app/api/audits/[id]/llms-txt/route.ts` | retire | v1 audit API, replaced by the checks API | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| route | `app/api/audits/[id]/notify/route.ts` | retire | v1 audit API, replaced by the checks API | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| route | `app/api/audits/[id]/reaudit/route.ts` | retire | v1 audit API, replaced by the checks API | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| route | `app/api/audits/[id]/stream/route.ts` | retire | v1 audit API, replaced by the checks API | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| route | `app/api/audits/start/route.ts` | retire | v1 audit start, replaced by the checks API | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| route | `app/api/auth/logout/route.ts` | keep | auth routes are kept | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| route | `app/api/auth/magic-link/route.ts` | keep | auth routes are kept (v2 door fields behind V2_ACCOUNT_DOOR) | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| route | `app/api/billing/checkout/route.ts` | keep | kept with new bodies; CC-03 owns these files | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| route | `app/api/billing/portal/route.ts` | keep | kept with new bodies; CC-03 owns these files | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| route | `app/api/billing/status/route.ts` | keep | kept with new bodies; CC-03 owns these files | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| route | `app/api/developers/route.ts` | keep | waitlist form behind /developers, kept | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| route | `app/api/health/route.ts` | keep | liveness probe | apps/web/app/api/health/route.ts:1 |
| route | `app/api/reports/hide/route.ts` | keep | /api/reports/* kept as is | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| route | `app/api/reports/mint/route.ts` | keep | /api/reports/* kept as is | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| route | `app/api/reports/[slug]/claim/route.ts` | keep | /api/reports/* kept as is | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| route | `app/api/reports/[slug]/logo/route.ts` | keep | /api/reports/* kept as is | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| route | `app/api/reports/[slug]/mine/route.ts` | keep | /api/reports/* kept as is | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| route | `app/api/reports/[slug]/visibility/route.ts` | keep | /api/reports/* kept as is | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| route | `app/api/reports/[slug]/white-label/route.ts` | keep | /api/reports/* kept as is | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| route | `app/api/takedown/route.ts` | keep | public takedown form, kept | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| route | `app/api/trpc/[trpc]/route.ts` | retire | ARCH-2: removed unless something still calls it; not deletable now, app/layout.tsx imports its provider | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| route | `app/api/verify/check/[id]/route.ts` | keep | /api/verify/* kept | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| route | `app/api/verify/start/route.ts` | keep | /api/verify/* kept | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| route | `app/api/webhooks/inngest/route.ts` | keep | Inngest serve route; v2 functions register through it too | apps/web/app/api/webhooks/inngest/route.ts:31 |
| route | `app/api/webhooks/resend/route.ts` | keep | email events webhook, kept | apps/web/lib/security/route-policy.ts:163 |
| route | `app/api/webhooks/stripe/route.ts` | keep | Stripe webhook, kept (dual-write until 009) | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| route | `app/billing/route.ts` | retire | v1 redirect to the Stripe portal | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| route | `app/embed/[domain]/route.ts` | keep | badge image; kept forever | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| route | `app/llms.txt/route.ts` | keep | kept | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| route | `app/login/verify/route.ts` | keep | magic-link verify, kept | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| route | `app/robots.txt/route.ts` | keep | kept; outside this step's allowed paths (§12, §13) | ARCH-2 §6.2 (owner cutover plan, ~/crawlmouse-plan/ARCH-2.md "6.2 URLs") |
| inngest | `inngest/audit.ts#auditFn` | retire | ARCH-2 Appendix: crawlmouse.audit is retired | ARCH-2 Appendix "Inngest function ids" (~/crawlmouse-plan/ARCH-2.md) |
| inngest | `inngest/billing.ts#reconcileBillingFn` | keep | crawlmouse.stripe-reconcile is kept in v2 | ARCH-2 Appendix "Inngest function ids" |
| inngest | `inngest/billing.ts#reconcileBillingManualFn` | keep | crawlmouse.stripe-reconcile-manual is kept in v2 | ARCH-2 Appendix "Inngest function ids" |
| inngest | `inngest/billing.ts#cleanupExpiredAuditsFn` | retire | ARCH-2 Appendix: crawlmouse.audits-ttl-cleanup is retired | ARCH-2 Appendix "Inngest function ids" |
| cron | `inngest/billing.ts#reconcileBillingFn` | keep | its function is kept | inngest/billing.ts:49 |
| cron | `inngest/billing.ts#cleanupExpiredAuditsFn` | retire | its function is retired | inngest/billing.ts:88 |
| table | `public.audits` | retire | dropped in migration 009 | ARCH-2 §2 legacy-table table and §6.1 migration 009 (~/crawlmouse-plan/ARCH-2.md) |
| table | `public.pages` | retire | dropped in migration 009 | ARCH-2 §2 legacy-table table and §6.1 migration 009 (~/crawlmouse-plan/ARCH-2.md) |
| table | `public.links` | retire | dropped in migration 009 | ARCH-2 §2 legacy-table table and §6.1 migration 009 (~/crawlmouse-plan/ARCH-2.md) |
| table | `public.findings` | retire | dropped in migration 009 | ARCH-2 §2 legacy-table table and §6.1 migration 009 (~/crawlmouse-plan/ARCH-2.md) |
| table | `public.fixes` | retire | dropped in migration 009 | ARCH-2 §2 legacy-table table and §6.1 migration 009 (~/crawlmouse-plan/ARCH-2.md) |
| table | `public.sessions` | retire | dropped in migration 009 | ARCH-2 §2 legacy-table table and §6.1 migration 009 (~/crawlmouse-plan/ARCH-2.md) |
| table | `public.benchmark_cohorts` | retire | dropped in migration 009 | ARCH-2 §2 legacy-table table and §6.1 migration 009 (~/crawlmouse-plan/ARCH-2.md) |
| table | `public.users` | keep | kept; pro_until and stripe_customer_id dropped in 009 | ARCH-2 §2 legacy-table table and §6.1 migration 009 (~/crawlmouse-plan/ARCH-2.md) |
| table | `public.rate_limits` | keep | kept unchanged | ARCH-2 §2 legacy-table table and §6.1 migration 009 (~/crawlmouse-plan/ARCH-2.md) |
| table | `public.domain_verifications` | keep | kept; user_id dropped in 009 | ARCH-2 §2 legacy-table table and §6.1 migration 009 (~/crawlmouse-plan/ARCH-2.md) |
| table | `public.public_reports` | keep | kept; v1 columns dropped in 009, snapshots never mutated | ARCH-2 §2 legacy-table table and §6.1 migration 009 (~/crawlmouse-plan/ARCH-2.md) |
| table | `public.embed_badges` | keep | kept; user_id dropped in 009 | ARCH-2 §2 legacy-table table and §6.1 migration 009 (~/crawlmouse-plan/ARCH-2.md) |
| table | `public.takedown_requests` | keep | kept unchanged | ARCH-2 §2 legacy-table table and §6.1 migration 009 (~/crawlmouse-plan/ARCH-2.md) |
| table | `public.stripe_events` | keep | kept; gains account_id | ARCH-2 §2 legacy-table table and §6.1 migration 009 (~/crawlmouse-plan/ARCH-2.md) |
| table | `public.email_events` | keep | kept; gains account_id, kind | ARCH-2 §2 legacy-table table and §6.1 migration 009 (~/crawlmouse-plan/ARCH-2.md) |
| table | `public.waitlist` | keep | kept unchanged | ARCH-2 §2 legacy-table table and §6.1 migration 009 (~/crawlmouse-plan/ARCH-2.md) |
| table | `public.frontier` | keep | kept; audit_id becomes check_id | ARCH-2 §2 legacy-table table and §6.1 migration 009 (~/crawlmouse-plan/ARCH-2.md) |
| table | `public.frontier_politeness` | keep | kept; audit_id becomes check_id | ARCH-2 §2 legacy-table table and §6.1 migration 009 (~/crawlmouse-plan/ARCH-2.md) |
<!-- /v1-inventory:rulings -->
<!-- prettier-ignore-end -->

## D4 security rows

One row per `keep` and `retire` page and route (a `retire` item is live until the cutover). Each cell
is the verdict word; the full verdict with its evidence is the entry's `checks` in
`docs/ops/v1-inventory.json`.

<!-- prettier-ignore-start -->
<!-- v1-inventory:checks -->
| item | ruling | input | output | cache | redirect | errors | escaping | abuse |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` (`app/page.tsx`) | retire | n/a | pass | pass | n/a | n/a | pass | pass |
| `/ai-readiness-checker` (`app/ai-readiness-checker/page.tsx`) | keep | n/a | pass | pass | n/a | n/a | pass | pass |
| `/audit/[id]` (`app/audit/[id]/page.tsx`) | retire | pass | pass | pass | n/a | pass | pass | pass |
| `/aup` (`app/aup/page.tsx`) | keep | n/a | pass | pass | n/a | n/a | pass | n/a |
| `/authors/[slug]` (`app/authors/[slug]/page.tsx`) | keep | pass | pass | pass | n/a | n/a | pass | n/a |
| `/blog` (`app/blog/page.tsx`) | keep | n/a | pass | pass | n/a | n/a | pass | n/a |
| `/blog/[slug]` (`app/blog/[slug]/page.tsx`) | keep | pass | pass | pass | n/a | n/a | pass | n/a |
| `/blog/research` (`app/blog/research/page.tsx`) | keep | n/a | pass | pass | n/a | n/a | pass | n/a |
| `/bot` (`app/bot/page.tsx`) | keep | n/a | pass | pass | n/a | n/a | pass | n/a |
| `/compare` (`app/compare/page.tsx`) | retire | n/a | pass | pass | n/a | n/a | pass | pass |
| `/compare/[a]/[b]` (`app/compare/[a]/[b]/page.tsx`) | retire | pass | pass | pass | n/a | pass | pass | n/a |
| `/dashboard` (`app/dashboard/page.tsx`) | retire | pass | pass | pass | pass | pass | pass | n/a |
| `/developers` (`app/developers/page.tsx`) | keep | n/a | pass | pass | n/a | n/a | pass | pass |
| `/guides` (`app/guides/page.tsx`) | keep | n/a | pass | pass | n/a | n/a | pass | n/a |
| `/login` (`app/login/page.tsx`) | keep | pass | pass | pass | pass | n/a | pass | pass |
| `/pricing` (`app/pricing/page.tsx`) | keep | n/a | pass | pass | n/a | n/a | pass | pass |
| `/privacy` (`app/privacy/page.tsx`) | keep | n/a | pass | pass | n/a | n/a | pass | n/a |
| `/r/[slug]` (`app/r/[slug]/page.tsx`) | keep | pass | pass | pass | n/a | pass | pass | n/a |
| `/status` (`app/status/page.tsx`) | keep | n/a | pass | pass | n/a | n/a | pass | n/a |
| `/subprocessors` (`app/subprocessors/page.tsx`) | keep | n/a | pass | pass | n/a | n/a | pass | n/a |
| `/takedown` (`app/takedown/page.tsx`) | keep | n/a | pass | pass | n/a | n/a | pass | pass |
| `/terms` (`app/terms/page.tsx`) | keep | n/a | pass | pass | n/a | n/a | pass | n/a |
| `/top/[platform]` (`app/top/[platform]/page.tsx`) | retire | pass | pass | pass | n/a | pass | pass | n/a |
| `/verify/[id]` (`app/verify/[id]/page.tsx`) | keep | pass | pass | pass | pass | pass | pass | pass |
| `app/layout.tsx` | keep | n/a | pass | pass | n/a | n/a | pass | n/a |
| `app/blog/[slug]/opengraph-image.tsx` | keep | pass | pass | pass | n/a | n/a | pass | n/a |
| `app/r/[slug]/opengraph-image.tsx` | keep | pass | pass | pass | n/a | n/a | pass | n/a |
| `app/global-error.tsx` | keep | n/a | pass | n/a | n/a | pass | n/a | n/a |
| `app/api/admin/takedown/process/route.ts` | keep | pass | pass | pass | n/a | pass | n/a | pass |
| `app/api/audits/[id]/cancel/route.ts` | retire | pass | pass | pass | n/a | pass | n/a | pass |
| `app/api/audits/[id]/export/route.ts` | retire | pass | pass | finding | n/a | pass | pass | n/a |
| `app/api/audits/[id]/llms-txt/route.ts` | retire | pass | pass | finding | n/a | pass | n/a | n/a |
| `app/api/audits/[id]/notify/route.ts` | retire | pass | pass | pass | n/a | pass | n/a | pass |
| `app/api/audits/[id]/reaudit/route.ts` | retire | pass | pass | pass | n/a | pass | n/a | pass |
| `app/api/audits/[id]/stream/route.ts` | retire | finding | pass | finding | n/a | pass | n/a | finding |
| `app/api/audits/start/route.ts` | retire | pass | pass | pass | n/a | finding | n/a | pass |
| `app/api/auth/logout/route.ts` | keep | n/a | pass | pass | pass | pass | n/a | n/a |
| `app/api/auth/magic-link/route.ts` | keep | finding | pass | pass | pass | pass | n/a | pass |
| `app/api/billing/checkout/route.ts` | keep | pass | pass | pass | pass | pass | n/a | finding |
| `app/api/billing/portal/route.ts` | keep | n/a | pass | pass | pass | pass | n/a | finding |
| `app/api/billing/status/route.ts` | keep | n/a | pass | pass | n/a | n/a | n/a | n/a |
| `app/api/developers/route.ts` | keep | pass | pass | pass | n/a | pass | n/a | pass |
| `app/api/health/route.ts` | keep | n/a | pass | pass | n/a | n/a | n/a | n/a |
| `app/api/reports/hide/route.ts` | keep | pass | pass | pass | n/a | pass | n/a | pass |
| `app/api/reports/mint/route.ts` | keep | pass | pass | pass | n/a | pass | n/a | pass |
| `app/api/reports/[slug]/claim/route.ts` | keep | pass | pass | pass | n/a | pass | n/a | pass |
| `app/api/reports/[slug]/logo/route.ts` | keep | pass | pass | pass | n/a | pass | pass | pass |
| `app/api/reports/[slug]/mine/route.ts` | keep | pass | pass | pass | n/a | pass | n/a | n/a |
| `app/api/reports/[slug]/visibility/route.ts` | keep | pass | pass | pass | n/a | pass | n/a | pass |
| `app/api/reports/[slug]/white-label/route.ts` | keep | pass | pass | pass | n/a | pass | pass | pass |
| `app/api/takedown/route.ts` | keep | pass | pass | pass | n/a | pass | n/a | finding |
| `app/api/trpc/[trpc]/route.ts` | retire | pass | pass | pass | n/a | pass | n/a | n/a |
| `app/api/verify/check/[id]/route.ts` | keep | pass | pass | pass | n/a | pass | n/a | pass |
| `app/api/verify/start/route.ts` | keep | pass | pass | pass | n/a | pass | n/a | pass |
| `app/api/webhooks/inngest/route.ts` | keep | pass | n/a | n/a | n/a | n/a | n/a | n/a |
| `app/api/webhooks/resend/route.ts` | keep | pass | n/a | n/a | n/a | pass | n/a | n/a |
| `app/api/webhooks/stripe/route.ts` | keep | pass | n/a | n/a | n/a | pass | n/a | n/a |
| `app/billing/route.ts` | retire | n/a | pass | pass | pass | n/a | n/a | finding |
| `app/embed/[domain]/route.ts` | keep | pass | pass | pass | n/a | pass | pass | n/a |
| `app/llms.txt/route.ts` | keep | n/a | pass | pass | n/a | n/a | n/a | n/a |
| `app/login/verify/route.ts` | keep | pass | pass | pass | pass | pass | n/a | pass |
| `app/robots.txt/route.ts` | keep | n/a | pass | pass | n/a | n/a | n/a | n/a |
<!-- /v1-inventory:checks -->
<!-- prettier-ignore-end -->

## Findings

Every finding of the three workstreams, most severe first. "Owner" findings could not be fixed here:
the engine (D8), CC-03's or CC-20b's files, or a change D11 rules out (a migration, a cron, legal
text).

<!-- prettier-ignore-start -->
<!-- v1-inventory:findings -->
| id | severity | item | evidence | what happens | fixed in / owner |
| --- | --- | --- | --- | --- | --- |
| C-1 | major | `inngest/audit.ts#auditFn` | node_modules got-scraping@4.2.1 dist/index.js:543-552,577-585; packages/engine/src/crawler.ts:575 | got-scraping's header generator opens a TLS connection (ALPN probe) to each new https host:port with system DNS, ignoring the pinned dnsLookup; with a rebinding hostname a blind TLS handshake reaches an internal ip:port (reproduced: a 1,604-byte ClientHello reached 127.0.0.1; with useHeaderGenerator:false nothing arrived). No HTTP request is sent and nothing is read back. | CC-SEC-2 (engine; crawl-path change needs the deployed-function smoke) |
| B-F1 | major | `public.rate_limits`, `app/privacy/page.tsx` | apps/web/app/privacy/page.tsx:158 | /privacy calls rate-limit records short-lived; production holds 1,138 rows, 1,027 older than 30 days, oldest 157 days, 468 keys embedding a raw IP and 52 a raw email; nothing deletes the table (measured 2026-11-09). | owner follow-up: a daily delete (Inngest cron or pg_cron migration), both outside this step (D11) |
| B-F2 | major | `public.users`, `app/privacy/page.tsx`, `app/terms/page.tsx` | apps/web/app/privacy/page.tsx:152; apps/web/app/terms/page.tsx:205 | /privacy and /terms promise erasure on request; no code deletes public.users, public.users has no FK to auth.users, and the email also sits unlinked in rate_limits keys, email_events, audits.notify_email, waitlist and takedown_requests. | owner follow-up: an erasure runbook and an auth.users cascade migration (owner-applied) |
| A-1 | minor | `app/api/audits/[id]/stream/route.ts` | apps/web/app/api/audits/[id]/stream/route.ts:253; apps/web/app/api/audits/[id]/stream/route.ts:309 | the id is not validated and the stream has no rate limit: a garbage id polls the database every 2.5 s until the 250 s self-close; its no-cache header lacks private. | lead follow-up (retired at cutover) |
| A-2 | minor | `app/api/audits/[id]/export/route.ts`, `app/api/audits/[id]/llms-txt/route.ts` | apps/web/app/api/audits/[id]/export/route.ts:85; apps/web/app/api/audits/[id]/llms-txt/route.ts:43 | owner-only bodies with no Cache-Control; dynamic, not CDN-cached, so hardening. | lead follow-up (retired at cutover) |
| A-3 | minor | `app/api/audits/start/route.ts` | apps/web/app/api/audits/start/route.ts:45; packages/engine/src/ssrf-guard.ts:164 | the engine's validation message is returned verbatim, including the private address a name resolved to. | CC-SEC-2 (the message is the engine's) |
| A-4 | minor | `app/api/auth/magic-link/route.ts` | apps/web/app/api/auth/magic-link/route.ts:32 | email has no maximum length. | lead follow-up |
| A-5 | minor | `app/api/takedown/route.ts` | apps/web/app/api/takedown/route.ts:39 | the per-domain bucket (3 a day) is spent before the report lookup, so three junk posts block a domain's takedown form for a day; Turnstile runs only when a token is sent. No mail is sent. | lead follow-up |
| A-6 | minor | `app/api/billing/checkout/route.ts`, `app/api/billing/portal/route.ts`, `app/billing/route.ts` | apps/web/app/api/billing/checkout/route.ts:23; apps/web/app/api/billing/portal/route.ts:15; apps/web/app/billing/route.ts:20 | a Stripe API call per request with no per-user rate limit (signed-in only). | CC-03 |
| A-7 | minor | `app/r/[slug]/page.tsx` | apps/web/middleware.ts:62 | the initial HTML of a missing report carries two robots metas (noindex and index, follow); the middleware's X-Robots-Tag noindex covers /r/, so nothing is indexed. | lead follow-up |
| B-F3 | minor | `app/privacy/page.tsx` | apps/web/app/privacy/page.tsx:34 | "We do not store passwords" while 11 of 12 auth.users rows hold a hash (most likely GoTrue's random password for magic-link sign-ups; not checked against GoTrue source). | owner (legal text) |
| B-F4 | minor | `public.email_events`, `app/privacy/page.tsx` | apps/web/app/privacy/page.tsx:97 | email delivery events are not named on /privacy and are never cleaned up (109 rows, 91 older than 30 days, 33 to non-account addresses). | owner (legal text) and lead follow-up (cleanup) |
| B-F5 | minor | `public.public_reports`, `app/terms/page.tsx` | apps/web/app/terms/page.tsx:210 | public reports outlive their audits and are never deleted (78 of 96 have a null audit_id); /privacy is silent and Terms §18 says reports are deleted after termination, with no code path. | owner (legal text) |
| B-F6 | minor | `app/privacy/page.tsx` | apps/web/lib/anon-session.ts:5 | the crawlmouse_anon cookie (httpOnly, one year) is missing from the cookie list. | owner (legal text) |
| B-F7 | minor | `app/privacy/page.tsx`, `public.waitlist`, `public.takedown_requests` | apps/web/app/privacy/page.tsx:97 | email addresses of people without an account (waitlist, takedown requests, audits.notify_email) are not listed. | owner (legal text) |
| C-2 | minor | `inngest/audit.ts#auditFn` | packages/engine/src/ssrf-guard.ts:46 | the blocklist misses 192.0.0.0/24, 198.18.0.0/15, 224.0.0.0/4, 240.0.0.0/4 and IPv6 fec0::/10, 100::/64. | CC-SEC-2 |
| C-3 | minor | `inngest/audit.ts#auditFn` | inngest/audit.ts:126 | INNGEST_AUDIT_CONCURRENCY from 6 to 100 passes the clamp; above the Free cap the whole app sync is rejected. | CC-20b (its PLAN_CONCURRENCY_CAP closes it) |
| C-4 | minor | `inngest/billing.ts#cleanupExpiredAuditsFn` | inngest/billing-helpers.ts:228 | the TTL cleanup does not exempt an audit behind a minted report; the report keeps its snapshot (FK on delete set null). One 2026-06-14 report has neither snapshot nor audit and renders through the legacy fallback (apps/web/app/r/[slug]/page.tsx:68). | lead follow-up |
| C-5 | minor | `app/api/webhooks/inngest/route.ts` | apps/web/app/api/webhooks/inngest/route.ts:31 | with INNGEST_DEV set in production the SDK accepts unsigned invocations; nothing in the repo sets it, production env could not be read. | owner: confirm INNGEST_DEV is absent with vercel env ls production |
| C-6 | minor | `inngest/audit.ts#auditFn` | packages/engine/src/crawler.ts:550 | the Crawlee path passes extraHeaders without safeFetch's forbidden-header filter; no web route sets it today. | CC-SEC-2 |
| D9-1 | minor | `app/blog/[slug]/page.tsx` | apps/web/lib/seo/jsonld.tsx:118 | JSON-LD was serialised with bare JSON.stringify into a script tag; every caller passes our own constants today, so this was hardening. | fixed in `fed2923e` |
<!-- /v1-inventory:findings -->
<!-- prettier-ignore-end -->

## What was not checked, and why

_Filled at integration._
