# Security baseline: what is enforced, and how to check it

The controls CC-SEC put in place (`docs/specs/v2/sec-baseline.md` holds the decisions), each with the
command that shows it holds. Run the `pnpm` commands from the repository root; run `curl` anywhere.

## Enforced

| Control                                                                                                                                                                                                                                                 | Check                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and `X-Frame-Options: DENY` on everything but the badge, `/embed/<domain>`, on every route class                                                                                     | `pnpm --filter @crawlmouse/web exec vitest run __tests__/security/headers.test.ts` (config) and, on a production build, the `security-browser` CI job                                                                         |
| CSP `frame-ancestors`, `object-src`, `base-uri`, `form-action`, `upgrade-insecure-requests`                                                                                                                                                             | same two checks; live: `curl -sI https://crawlmouse.com/ \| grep -i '^content-security-policy:'`                                                                                                                              |
| Every route handler is registered with a class, and its source shows the class's mechanism                                                                                                                                                              | `pnpm --filter @crawlmouse/web exec vitest run __tests__/security/route-policy.test.ts`                                                                                                                                       |
| Every signed-in route refuses a caller with no session, and writes nothing first                                                                                                                                                                        | `pnpm --filter @crawlmouse/web exec vitest run __tests__/security/route-anonymous.test.ts`                                                                                                                                    |
| A cross-site state change to an origin-checked API route gets 403 before the route runs                                                                                                                                                                 | `pnpm --filter @crawlmouse/web exec vitest run middleware.test.ts`; on a build, `security-browser`                                                                                                                            |
| The same on the deployed function, which serves dynamic routes in any case                                                                                                                                                                              | after each deploy: `curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'origin: https://evil.example' -H 'content-type: application/json' -d '{}' https://crawlmouse.com/API/reports/no-such-report/visibility` prints `403` |
| A public JSON route refuses a state change whose body is not declared JSON (415), before any rate-limit bucket or insert                                                                                                                                | `pnpm --filter @crawlmouse/web exec vitest run __tests__/security/json-body.test.ts`                                                                                                                                          |
| `POST /api/auth/claim` is gone and nothing calls its URL                                                                                                                                                                                                | `pnpm --filter @crawlmouse/web exec vitest run __tests__/security/claim-route-removed.test.ts`                                                                                                                                |
| Every SECURITY DEFINER function in `public`, `research` and `partitions` searches `pg_catalog` first and `pg_temp` last; no client role can create in `public`                                                                                          | catalog check `09-definer-search-path.sql`: `pnpm --filter @crawlmouse/scripts exec tsx db/check.ts --project-ref ezspnfeyzwsisymytssm --yes-production` (after the migration is applied)                                     |
| Semgrep CE (`p/typescript`, `p/javascript`, `p/nodejs`, `p/react`): an ERROR result fails the `semgrep` job unless the reviewed baseline lists it (until 2026-12-08); so does a scan that read no file or ran fewer than 50 rules. Not a required check | the `semgrep` job in `.github/workflows/ci.yml`; gate and baseline: `pnpm --filter @crawlmouse/web exec vitest run __tests__/security/semgrep-gate.test.ts`                                                                   |
| CodeQL `security-extended`, while the repository is public only (the job is skipped once it is private): a high or critical result fails CI unless the reviewed baseline lists it (until 2026-12-08)                                                    | the `codeql` job in `.github/workflows/ci.yml`; gate and baseline: `pnpm --filter @crawlmouse/web exec vitest run __tests__/security/sarif-gate.test.ts`                                                                      |

## Report-only

| Control                                              | Where the reports go                                                                      | Next step                                         |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------- |
| The full CSP (`Content-Security-Policy-Report-Only`) | Sentry project `crawlmouse`, as security reports (`report-uri` and `Reporting-Endpoints`) | After seven days of reports, CC-SEC-2 enforces it |

## Advisory

| Control                                                                                             | Where                                                        | Next step                                             |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------- |
| ZAP passive baseline over `/`, `/pricing`, `/login`, `/r/ci-fixture`, `/api/health` on `next start` | CI job `zap-baseline`, report artifact `zap-<run>-<attempt>` | Triage its first findings, then make the job required |

## Data the owner applies

| Control                                         | File                         | How                            |
| ----------------------------------------------- | ---------------------------- | ------------------------------ |
| Edge rate limits and the sign-in page challenge | `infra/vercel/firewall.json` | `docs/ops/edge-firewall.md`    |
| Uptime monitors and alert rules                 | below                        | Sentry API, by the owner's CTO |

## Monitoring

### Uptime monitors

Read on 2026-11-08 (Sentry, org `nahl-technologies-inc`): one monitor, `https://crawlmouse.com`, every
60 s. To exist:

| Monitor            | URL                                 | Interval | Since                  |
| ------------------ | ----------------------------------- | -------- | ---------------------- |
| Home page (exists) | `https://crawlmouse.com`            | 60 s     | —                      |
| Health             | `https://crawlmouse.com/api/health` | 60 s     | now                    |
| Worker             | the worker's `/healthz`             | 60 s     | once CC-20b deploys it |

Create one through Sentry's API, with a token holding the `project:write` scope. The fields are those
of Sentry's "Create an Uptime Monitor" endpoint; check its current reference before running it:

```bash
read -rs SENTRY_TOKEN && curl -sS -X POST -H "Authorization: Bearer $SENTRY_TOKEN" -H 'Content-Type: application/json' https://us.sentry.io/api/0/projects/nahl-technologies-inc/crawlmouse/uptime/ -d '{"name":"Health","url":"https://crawlmouse.com/api/health","method":"GET","intervalSeconds":60,"timeoutMs":10000,"environment":"production"}'; unset SENTRY_TOKEN
```

### Alert rules

Read on 2026-11-08, five issue rules exist: "Send a notification when pull requests are ready",
"Audit failures", "Prod error-rate spike", "Stripe webhook signature failures (proven signal)" and
"Send a notification for high priority issues". To add:

| Rule          | Fires when                                                           | Why                                                                                                              |
| ------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Refusal spike | the `security.refused` issue is seen more than 20 times in 5 minutes | One event in ten is sent, so this is about 200 cross-site refusals in 5 minutes: a probe or a broken client      |
| CSP reports   | more than 50 CSP security reports in an hour                         | During the report-only week this is the signal to look; after CC-SEC-2 it means the enforced policy broke a page |

`security.refused` events group as one issue: they share a message. A refusal-spike rule through the
API ("Create an Issue Alert Rule"):

```bash
read -rs SENTRY_TOKEN && curl -sS -X POST -H "Authorization: Bearer $SENTRY_TOKEN" -H 'Content-Type: application/json' https://us.sentry.io/api/0/projects/nahl-technologies-inc/crawlmouse/rules/ -d '{"name":"Refusal spike (security.refused)","frequency":30,"actionMatch":"all","filterMatch":"all","conditions":[{"id":"sentry.rules.conditions.event_frequency.EventFrequencyCondition","value":20,"interval":"5m"}],"filters":[{"id":"sentry.rules.filters.event_attribute.EventAttributeFilter","attribute":"message","match":"eq","value":"security.refused"}],"actions":[{"id":"sentry.mail.actions.NotifyEmailAction","targetType":"IssueOwners","fallthroughType":"ActiveMembers"}]}'; unset SENTRY_TOKEN
```

In project settings → Inbound Filters, turn on the browser-extension filter so extension-injected
scripts do not fill the CSP reports.

## Known gaps (and who closes them)

The spec's "Known gaps and follow-ups" section is the list, each with its owner.
