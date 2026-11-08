# CC-SEC — the application security baseline

The controls a security reviewer checks first, put in place before the v2 opening: response headers
and a content security policy, a registry of every route handler and how each is protected, a
cross-site refusal for state changes, the end of an unused claim route, definer functions that search
the caller's temporary schema last, CodeQL and a ZAP scan in CI, edge rate limits as reviewed data,
an event for refusals, and an incident plan. No screen or copy changes.

`docs/ops/security-baseline.md` lists what is enforced, report-only and advisory, each with its
verifying command. This file records the decisions and the evidence behind them. Commands run from the
repository root.

## Decisions

Each decision is the brief's (2026-11-08), with what the build found. Where the build departs from the
brief's wording, the departure was put to the owner as a ruling with a recommendation (the rulings
list, below) and built as recommended.

### D1 — one headers module

`apps/web/lib/security/headers.mjs`, applied by `apps/web/next.config.mjs` `headers()`. It is `.mjs`
and not `.ts` because `next.config.mjs` imports it at build time and cannot import TypeScript (ruling 8).
Two route classes: `/embed/*`, the grade badge other sites frame, has no `X-Frame-Options` and
`frame-ancestors *`; every other path has `X-Frame-Options: DENY` and `frame-ancestors 'none'`. Every
path carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and
`Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`.

A `next.config` header replaces a header a route sets for itself, and a later `headers()` entry
replaces an earlier one (measured on `next start` by the plan reviewer). `/login/verify` sets
`Referrer-Policy: same-origin`, so a third entry keeps that value there (ruling 7d).

Verify, the config through Next's own matcher on one URL per class, with and without a DSN:

```bash
pnpm --filter @crawlmouse/web exec vitest run __tests__/security/headers.test.ts
```

and what `next start` sends, in CI's `security-browser` job (`apps/web/__tests__/security/browser/headers.pw.ts`).

**HSTS** is Vercel's (`max-age=63072000`), not set here. `includeSubDomains; preload` waits for the owner
to confirm every subdomain serves HTTPS. Measured on 2026-11-08: `crawlmouse.com` and `www.crawlmouse.com`
have address records (`dig +short crawlmouse.com A`, `dig +short www.crawlmouse.com`); the
certificate-transparency log names those two and a wildcard, `*.crawlmouse.com`
(`curl -s 'https://crt.sh/?q=%25.crawlmouse.com&output=json' | jq -r '.[].name_value' | sort -u`). The
wildcard means any other host the Cloudflare zone holds is covered by a certificate, so the owner checks
the zone export, not only these two names.

### D2 — the CSP in two headers

`Content-Security-Policy` enforces `frame-ancestors`, `object-src 'none'`, `base-uri 'self'`,
`form-action 'self' https://checkout.stripe.com https://billing.stripe.com` and
`upgrade-insecure-requests`. `Content-Security-Policy-Report-Only` carries the full policy, with the
enforced directives included, so CC-SEC-2's enforcement is a change of header name.
`upgrade-insecure-requests` is left out of the report-only header only because browsers ignore it
there and log that they did.

Reports go to Sentry's security endpoint, built from `NEXT_PUBLIC_SENTRY_DSN` at build time
(`report-uri` and `report-to csp` with a `Reporting-Endpoints` header). With no DSN the reporting
directives and the Sentry origin are left out.

No nonces: a per-request nonce makes every page dynamic and loses the CDN cache the home page relies on
(`curl -sI https://crawlmouse.com/ | grep -i x-vercel-cache` → `HIT` on 2026-11-08). `script-src` keeps
`'unsafe-inline'` for Next's inline runtime scripts: a known gap, closed by hashes in a follow-up.
`next dev` adds `'unsafe-eval'` to the report-only `script-src` (React Refresh); production builds do not.

The one `dangerouslySetInnerHTML` in the app, `apps/web/lib/seo/jsonld.tsx`, writes a
`<script type="application/ld+json">` data block, which the browser does not execute, so `script-src`
does not govern it. Every page renders one through the root layout.

**Ruling 3:** the signed-in header calls Supabase from the browser
(`apps/web/components/layout/HeaderNav.tsx`, token refresh against `NEXT_PUBLIC_SUPABASE_URL`), so the
Supabase origin belongs in `connect-src`, and `report-uri` belongs on the enforced header too. Not built
yet: it waits for the ruling, because it adds to the brief's list.

Verify in a browser on `next start`, with Turnstile, PostHog and Sentry working through the policy and
no violation (`apps/web/__tests__/security/browser/csp.pw.ts`, CI job `security-browser`). Its last case
shows the watch catches a report-only violation when one happens.

### D3 — a route policy registry

`apps/web/lib/security/route-policy.ts` lists every `app/**/route.ts` (ruling 4 extended the brief's
`app/api/**` to the five handlers outside `/api`) with its class: `public` with a reason, `user`,
`member`, `service`, `webhook`. Print the registry:

```bash
pnpm --filter @crawlmouse/web exec tsx -e "import('./lib/security/route-policy.ts').then((m) => console.table(m.ROUTE_POLICIES.map((p) => ({ route: p.route, class: p.class, methods: p.methods.join(' '), sameOrigin: p.sameOrigin }))))"
```

The tests, all run by

```bash
pnpm --filter @crawlmouse/web exec vitest run __tests__/security/route-policy.test.ts __tests__/security/route-anonymous.test.ts
```

hold it:

- **To the disk.** Each route file has exactly one row, each row has a file, and each row's methods are
  the ones its file exports, in the four spellings the code uses.
- **To the source**, read through the TypeScript AST, so neither comments nor whitespace count:
  - `user` and `member` routes call `getUser()` before any `supabaseAdmin()`. `member` routes also check
    membership through `rpc('is_member' | 'is_member_for_site' | 'member_role')` first.
  - `webhook` routes call their verifier (`constructEvent`, svix `verify`, Inngest `serve`) before any
    call into the app's own code, and never parse the body with `json()`.
  - `service` routes check the bearer credential before `supabaseAdmin()`.
  - A route that answers 401 after `getUser()` is never `public`. A `public` route that calls `getUser()`
    is marked `session: 'optional'`.
  - Each checker also runs on a synthetic source it must reject.
- **By behaviour.** Every `user` route is called with no session, its writers recording: each one
  refuses (401, or `{ owned: false }` for the owner probe, or a redirect to `/login` for `/billing`),
  and no service-role or session write, rate-limit bucket, Stripe, Inngest or claim call happens first.

`member` has no rows today: no route calls `is_member` (`grep -rln is_member apps/web/app` prints
nothing). Its checker is tested on synthetic sources.

### D4 — the cross-site refusal

`apps/web/middleware.ts` sees every API path but `/ingest` and the webhooks. A request to a route the
registry marks `sameOrigin` is refused before the route runs, with 403 `{"code":"cross_site"}` and a
`security.refused` event, when two things hold:

- its method is anything but GET, HEAD or OPTIONS, so an unknown method counts as a state change;
- it does not come from one of our pages. That rule is the sign-in POST's (CC-25), now in
  `apps/web/lib/security/same-origin.ts`: the Origin is ours, or the browser sent none (or `null`) with
  `Sec-Fetch-Site: same-origin`.

The path is percent-decoded, its repeated slashes are collapsed and its trailing slash is dropped
before the lookup. With `skipTrailingSlashRedirect` a trailing slash reaches the route handler, and the
plan reviewer measured exactly that. Other API requests pass through with no session refresh and no
cookie, as before.

The origin-checked routes are the 10 state-changing `user` routes, plus `audits/[id]/cancel` and
`auth/logout`, which are cookie-authorised but `public` (ruling 2).
`app/login/verify/route.ts` still holds its own copy of the rule. Importing the shared one there is
ruling 7a, outside the brief's allowed paths.

Verify the unit, every row and spelling, and the matcher through Next's own matcher:

```bash
pnpm --filter @crawlmouse/web exec vitest run middleware.test.ts
```

On the built app, CI's `security-browser` job sends a cross-site POST to each row and to four spellings
of one.

**Ruling 2, not yet built:** the public state-changing routes (`audits/start`, `reports/mint`,
`reports/hide`, `audits/[id]/notify`, `takedown`, `developers`) take a cross-site request with no
cookie. `audits/start` reads `req.json()` whatever the Content-Type, so any page can make its visitors'
browsers start crawls from their own IPs, draining `global:audits:day`, which fails closed. The
recommendation is magic-link's lenient rule on those rows: refuse `Sec-Fetch-Site: cross-site` or a
foreign Origin, allow a missing one.

### D5 — `POST /api/auth/claim` is gone

It claimed anonymous v1 audits without the binding check the sign-in POST applies, and nothing called
it. Verify, the file is absent and no tracked code or config names its URL:

```bash
pnpm --filter @crawlmouse/web exec vitest run __tests__/security/claim-route-removed.test.ts
```

### D6 — definer functions search `pg_temp` last

Migration `infra/supabase/migrations/20261108000002_v2_definer_search_path.sql` sets `search_path` on
the 19 SECURITY DEFINER functions in `public` that left `pg_temp` out. The value is
`pg_catalog, public, pg_temp`, except `v2_premake_month_partitions`, which searched `pg_catalog` alone
and keeps to that with `pg_temp` last (ruling 6). Two things are unchanged: no body changes, and
`start_trial_with_ledger` keeps `''`. The rollback restores each function's setting as production held
it; both lists are in the two files.

**Why it matters, reproduced.** With `pg_temp` left out, Postgres searches it first for relations and
types, even before `pg_catalog`. A caller's temp domain then stands in for a type, and its CHECK runs as
the function's owner, `postgres`. Before the migration, in PGlite:

- **`is_member`, `member_role` and `is_member_for_site`** (callable by `authenticated`). Their bodies
  name no type, but they call `auth.uid()`, a plain SQL function that Postgres inlines; its `::uuid` then
  resolves under the helper's path. Production's `auth.uid()` has the same shape:
  `select prosrc, proconfig from pg_proc where oid = 'auth.uid()'::regprocedure`.
- **`crawl_worker_check_id`, `crawl_worker_lineage_id` and `crawl_worker_part_path_ok`** (callable by
  `crawl_worker`), through a declared `jsonb`, `text` or `uuid` variable.
- **`usage_counts`**: its `::date` resolves to the caller's domain, and `RETURN QUERY` then refuses the
  row shape before any CHECK runs. The name is taken over; no code runs as the owner.

After the migration none of these happens. Verify:

```bash
pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-definer-search-path.test.ts
```

Using any of this needs a SQL session that can create temp objects. PostgREST gives none, and
`crawl_worker` cannot log in (only `authenticator` may switch to it), so the migration is
defence-in-depth against a session that should not exist. Every role holds `TEMP` on the database:
`select r, has_database_privilege(r, current_database(), 'TEMP') from unnest(array['anon','authenticated','crawl_worker','service_role']) r`.

**Why reordering is safe.** Moving `pg_catalog` ahead of `public` changes a resolution only where a
`public` object shares a name with a `pg_catalog` one. On 2026-11-08 none did, across relations, types,
functions and operators. This query returned no row:

```sql
with pub as (
  select c.relname n from pg_class c where c.relnamespace = 'public'::regnamespace
  union all select t.typname from pg_type t where t.typnamespace = 'public'::regnamespace
  union all select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace
  union all select o.oprname from pg_operator o where o.oprnamespace = 'public'::regnamespace
), cat as (
  select c.relname n from pg_class c where c.relnamespace = 'pg_catalog'::regnamespace
  union select t.typname from pg_type t where t.typnamespace = 'pg_catalog'::regnamespace
  union select p.proname from pg_proc p where p.pronamespace = 'pg_catalog'::regnamespace
  union select o.oprname from pg_operator o where o.oprnamespace = 'pg_catalog'::regnamespace
)
select distinct pub.n from pub join cat using (n);
```

**Check 09** (`infra/supabase/checks/09-definer-search-path.sql`) allows a definer function in
`public`, `research` or `partitions` exactly `""`, `pg_catalog, pg_temp` or
`pg_catalog, public, pg_temp`. It also fails if a role other than a superuser or a member of `public`'s
owner may create objects in `public`, because `public` ahead of `pg_temp` is safe only then. A rule of
"ends in `pg_temp`" would pass `search_path = pg_temp` alone, which lets unqualified names fall through
to the temp schema.

**Fingerprint.** The migration changes the `functions` section only. Its 19 lines are in
`scripts/db/fixtures/20261108000002-expected-change.json`, read from production: each line as it stands,
and the line with its SET clause replaced, md5'd there. Applied on PGlite, the migration produces exactly
those lines:

```bash
pnpm --filter @crawlmouse/scripts exec vitest run db/definer-search-path.test.ts
```

Pipeline: the dry run on the pull request, merge, then the owner approves `db-apply-prod.yml`.

### D7 — CodeQL

The `codeql` job in `.github/workflows/ci.yml` runs `security-extended` over the JavaScript and
TypeScript on every push and pull request. `.github/workflows/scripts/sarif-gate.mjs` fails it on a
result whose rule has security-severity 7.0 or more, reading the rules where CodeQL writes them
(`tool.extensions`). It also fails a SARIF with no run or no extracted file. Uploads to code scanning
happen from this repository's own pushes and pull requests; a fork's token cannot write them. Verify the
gate:

```bash
pnpm --filter @crawlmouse/web exec vitest run __tests__/security/sarif-gate.test.ts
```

Code scanning is free while the repository is public. Going private (planned before CC-29) needs GitHub
Advanced Security, or this Semgrep OSS job in its place (ruling 9: it lives here, not commented out in
the workflow):

```yaml
semgrep:
  runs-on: ubuntu-24.04
  timeout-minutes: 15
  env:
    # renovate: datasource=docker depName=semgrep/semgrep
    SEMGREP_IMAGE: semgrep/semgrep:<version>@sha256:<digest of that version>
  steps:
    - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      with:
        persist-credentials: false
    - name: semgrep
      run: |
        docker run --rm -v "$PWD:/src" -w /src "$SEMGREP_IMAGE" semgrep scan \
          --config p/typescript --config p/nextjs --config p/react --config p/owasp-top-ten \
          --severity ERROR --error --metrics off
```

Pin the image when the job is turned on.

### D8 — ZAP baseline

The `zap-baseline` job runs ZAP's passive scan (image pinned by digest) over `next start` of the build
job's output: `/`, `/pricing`, `/login`, `/r/ci-fixture`, `/api/health` and a one-minute spider. It has
`continue-on-error: true` and a six-minute limit, and keeps its HTML and JSON reports as an artifact.
CI has no database, so `/r/ci-fixture` is the not-found page: ZAP sees its headers and markup, not a
populated report. It is promoted to required once its first findings are triaged.

### D9 — edge rate limits as data

`infra/vercel/firewall.json`, applied by the owner's CTO (`docs/ops/edge-firewall.md`). The rules:

- `POST /api/auth/magic-link`: 30 per 60 s per IP, deny.
- `POST /api/audits/start`: 60 per 600 s per IP, deny.
- `POST /api/checks/<id>/claim`: 30 per 60 s per IP, deny.
- `GET /login` and `/signup`: a browser challenge. `/login/verify`, where the email link lands, is not
  challenged.

Vercel Pro caps a rate-limit window at 10 minutes, so D9's "60 / hour" is 60 per 10 minutes (ruling 5).
It stays above the app's highest per-IP bucket for that route (40 a day). Paths match by regex with an
optional trailing slash, because a trailing slash reaches the route. Verify against Vercel's request
schema, the Pro limits and the app's own limits:

```bash
pnpm --filter @crawlmouse/web exec vitest run __tests__/security/firewall.test.ts
```

No rule keys on a bot or user agent: every AI crawler stays allowed (OPERATING-RULES §12).

### D10 — monitoring

`security.refused` (`apps/web/lib/security/refusal-event.ts`): the reason, the route's registry row
(never the requested path, which can hold an audit id), its class, the method and the status. It goes
to Sentry as a warning and to PostHog with a fixed distinct id and no person profile. One refusal in
ten is sent, and an instance sends at most 30 a minute.

In the middleware the Sentry SDK puts the request on the scope (URL, headers with the visitor's
referrer and location) and names the transaction after the path. The sink drops the request, user,
transaction and breadcrumbs from its event. Verify through the installed SDK's own pipeline:

```bash
pnpm --filter @crawlmouse/web exec vitest run __tests__/security/refusal-event.test.ts __tests__/security/refusal-event-sentry.test.ts
```

It is emitted for the middleware's 403s. 401s and 429s are returned inside the routes, out of the
middleware's sight, so they are not emitted in this step (ruling 1). The monitors and alert rules to
create are in `docs/ops/security-baseline.md`.

### D11 — the incident plan

`docs/ops/incident-plan.md`.

### D12 — out of this step

In the follow-ups below.

## Rulings put to the owner (2026-11-08)

Each is built as recommended unless marked otherwise; an overruling is a small change.

1. D10: emit for the middleware's 403s only; 401/429 follow when the routes adopt one `requireUser()`.
2. D4: the strict rule also on `cancel` and `logout` (built), and the lenient rule on the public
   state-changing routes (**not built until ruled**).
3. D2: the Supabase origin in `connect-src`, and `report-uri` on the enforced header (**not built until
   ruled**).
4. D3: register every `app/**/route.ts`.
5. D9: 60 per 600 s on `/api/audits/start`; regex paths with an optional trailing slash.
6. D6: `pg_catalog, pg_temp` for `v2_premake_month_partitions`; check 09 as an exact allow-list plus no
   CREATE on `public`.
7. Allowed paths:
   - (a) `app/login/verify/route.ts` imports the shared same-origin rule: **not built until ruled**.
   - (b) Regenerate `docs/specs/v2/06c-trial-function.md`: built, because its spec test fails otherwise.
   - (c) The `scripts/db` tests and fixture: built.
   - (d) The `/login/verify` header entry: built.
8. D1: `headers.mjs`.
9. D7: the Semgrep job in this spec.
10. OPERATING-RULES §13: the Search Console numbers come from the owner, or are stated as not measured.

## Known gaps and follow-ups

| Item                                                                                                                                                                            | Owner                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Enforce the full CSP after seven days of report-only data (CC-SEC-2)                                                                                                            | engineering                                     |
| Hash-based `script-src` in place of `'unsafe-inline'`                                                                                                                           | engineering                                     |
| `security.refused` for 401s and 429s, through one `requireUser()` helper in the routes                                                                                          | engineering (CC-SEC-2)                          |
| `audits/[id]/reaudit` reads the audit row as the service role before refusing a caller with no session; nothing reaches the caller, and `route-anonymous.test.ts` pins the read | engineering                                     |
| `checks/[id]/claim` and `auth/magic-link` keep their own looser origin checks; the middleware's runs first on the former                                                        | engineering, at the next change to those routes |
| `GET /billing` creates a Stripe portal session on a cookie-authorised GET                                                                                                       | engineering                                     |
| `/api/trpc` is a reserved surface with no caller                                                                                                                                | engineering (delete, like D5, or build on it)   |
| The Inngest route's GET and PUT are not signature-verified; pin `INNGEST_SERVE_HOST` and keep the production signing key out of previews                                        | owner                                           |
| `scripts/p5/driver.mjs` posts `/api/billing/checkout` with no Origin and now gets 403                                                                                           | engineering, if it is run again                 |
| HSTS `includeSubDomains; preload`, after the subdomain check above                                                                                                              | owner                                           |
| WAF tuning after four weeks of traffic                                                                                                                                          | owner's CTO                                     |
| External penetration test before the first paid agency                                                                                                                          | owner                                           |
| Renovate installation                                                                                                                                                           | owner                                           |
| 2FA on every provider account                                                                                                                                                   | owner                                           |
| Supabase point-in-time recovery                                                                                                                                                 | owner                                           |
| Cloudflare AI-crawler and managed-robots settings (OPERATING-RULES §12)                                                                                                         | owner                                           |
