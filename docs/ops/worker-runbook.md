# Crawl worker runbook (staging)

The crawl worker is `packages/worker`, deployed to Fly as `crawlmouse-worker-staging` (region `iad`,
one machine). It fetches signed batches of URLs for the app and returns evidence rows; its routes,
limits and verdict rules are in `docs/specs/v2/12-crawl-worker.md`.

It holds two values, both set as Fly secrets: `WORKER_SIGNING_SECRET` (shared with the app) and
`WORKER_JWT_PUBLIC_KEY` (the app's Ed25519 public key; not secret, kept with the other). Check the
names, never the values: `flyctl secrets list --app crawlmouse-worker-staging`.

## Before the first deploy (owner, once)

- **Fly token.** `FLY_API_TOKEN` in the GitHub `staging` environment must be able to create an app in
  the organisation, so it is an organisation token (`flyctl tokens create org <slug>`). Once the app
  exists, it can be replaced by an app-scoped deploy token (`flyctl tokens create deploy --app
crawlmouse-worker-staging`), which is the least it needs.
- **Fly organisation.** Set the variable (not a secret) `FLY_ORG` on the `staging` environment to the
  organisation's slug. The workflow refuses to create the app without it, rather than guess.
- **Branch restriction.** Restrict the `staging` environment's deployment branches to `main`
  (Settings, Environments, staging). Without it, a workflow on any branch that names
  `environment: staging` can read the token.

## First deploy

1. Generate the signing secret and the JWT key pair on a trusted machine:

   ```bash
   openssl rand -base64 48
   ```

   ```bash
   node -e "const {generateKeyPairSync}=require('node:crypto');const k=generateKeyPairSync('ed25519');console.log('public', k.publicKey.export({format:'jwk'}).x);console.log('private', k.privateKey.export({format:'pem',type:'pkcs8'}))"
   ```

   The private key belongs to the app (the pipeline that mints batch JWTs, CC-20), never to the
   worker. Store it where the app's secrets live.

2. Push to `main` with a change the workflow's path filter covers. The `worker-staging` workflow
   creates the app, then stops at "Require the worker's secrets", because they are not set yet.

3. Set the two secrets. They are read from the terminal and passed on standard input, so neither
   lands in shell history:

   ```bash
   read -rs SIGNING && read -rs PUBLIC && printf 'WORKER_SIGNING_SECRET=%s\nWORKER_JWT_PUBLIC_KEY=%s\n' "$SIGNING" "$PUBLIC" | flyctl secrets import --stage --app crawlmouse-worker-staging; unset SIGNING PUBLIC
   ```

   Then re-run the failed run from the Actions tab within seven days (its bundle artifact expires
   after that), and only if no later run has deployed since: re-running an older run ships its older
   bundle. Otherwise push a new commit. The run deploys, then allocates the app's egress pair and
   checks it (it allocates only when the region has no egress IPv4 yet).

4. Record the egress address (below).

## Deploy

Automatic: a push to `main` that touches what the bundle is built from (the workflow's `paths`) runs
`.github/workflows/worker-staging.yml`: worker tests, typecheck, bundle, then deploy that bundle, a
health check, the egress allocation if none exists, and the egress check. The egress check restarts
the machine, so a deploy restarts it twice. It does not wait for `ci.yml`.

By hand, from the repository root:

```bash
pnpm --filter @crawlmouse/worker build
```

```bash
flyctl deploy packages/worker --app crawlmouse-worker-staging --config packages/worker/fly.toml --remote-only --ha=false
```

A deploy restarts the machine. Batches running at that moment are lost; polls for them answer 404
and the caller sends them again. So does a crash: `fly.toml` sets `[[restart]] policy = "always"`, so
Fly starts the process again whatever its exit. Fly's default (`on-failure`, 10 tries in 5 minutes)
would leave the machine stopped after a crash loop until the next deploy.

## Roll back

List releases with their images, then deploy the previous image:

```bash
flyctl releases --app crawlmouse-worker-staging --image
```

```bash
flyctl deploy --app crawlmouse-worker-staging --config packages/worker/fly.toml --image <image of the previous release> --ha=false
```

Then revert the commit on `main`, or the next push deploys it again.

## Logs and metrics

```bash
flyctl logs --app crawlmouse-worker-staging
```

The worker logs JSON lines: `listening`, `batch_accepted`, `batch_done` (with requests and any
partial reasons), `batch_failed`, `request_failed`, `stopping`. It does not log URLs, headers,
secrets or JWTs. `GET /metrics` is signed with the signing secret, purpose `metrics`; it gives
memory, event-loop lag p99 since start, batches running and stored, and requests started per site.
To read it without handling the secret, sign it inside the machine:

```bash
flyctl ssh console --app crawlmouse-worker-staging -C "node -e \"const c=require('node:crypto');const ts=String(Date.now());const sig=c.createHmac('sha256',process.env.WORKER_SIGNING_SECRET).update(ts+'.metrics').digest('hex');fetch('http://127.0.0.1:8080/metrics',{headers:{'x-crawlmouse-ts':ts,'x-crawlmouse-signature':sig}}).then(r=>r.text()).then(console.log)\""
```

## Rotate the signing secret

The worker holds one signing secret at a time, so a rotation has a short window in which requests
signed with the old one are refused with 401.

1. Generate a new secret (`openssl rand -base64 48`).
2. Set it on the worker, from standard input; the machine restarts and running batches are lost:

   ```bash
   read -rs SIGNING && printf 'WORKER_SIGNING_SECRET=%s\n' "$SIGNING" | flyctl secrets import --app crawlmouse-worker-staging; unset SIGNING
   ```

3. Set the same value on the app side and redeploy it. Batches refused in between are sent again by
   the caller.

Rotate the JWT key pair the same way: the new public key to `WORKER_JWT_PUBLIC_KEY`, the private key
to the app.

## Stop all crawling

- **Refuse new batches:** set the pause flag, read as the app reads its own (`1`, whitespace
  ignored). Setting it restarts the machine, which also drops running batches. `POST /batch` then
  answers 503 `paused`, and it stays that way across deploys.

  ```bash
  flyctl secrets set --app crawlmouse-worker-staging CRAWL_PAUSED=1
  ```

  Resume with `flyctl secrets unset --app crawlmouse-worker-staging CRAWL_PAUSED`.

- **Stop the machine at once:**

  ```bash
  flyctl scale count 0 --app crawlmouse-worker-staging --yes
  ```

  The next deploy starts a machine again (a deploy launches one into an empty group), and a weekly
  dependency update can trigger one. Set `CRAWL_PAUSED=1` as well, so a machine that comes back
  refuses batches. Bring it back with `flyctl scale count 1 --app crawlmouse-worker-staging --yes`.

## Egress address

Sites see the worker's requests from the app's static egress pair (IPv4 and IPv6), which the deploy
workflow allocates after the first deploy (`flyctl ips allocate-egress --app
crawlmouse-worker-staging -r iad --yes`). Allocating before the first deploy would stop that deploy
from allocating the app's ingress addresses. On each deploy the workflow checks that the IPv4 address
the world sees is the app's egress IPv4 and is the same before and after a machine restart; it masks
both readings.

Recorded after the first deploy (echo check through `api.ipify.org` and `api6.ipify.org`, before
and after `flyctl machine restart`):

| Family | Address      | Before restart | After restart | Recorded |
| ------ | ------------ | -------------- | ------------- | -------- |
| IPv4   | not recorded |                |               |          |
| IPv6   | not recorded |                |               |          |

To take the reading (each family is read on its own, so one failing does not hide the other):

```bash
flyctl ssh console --app crawlmouse-worker-staging -C "node -e \"Promise.allSettled(['https://api.ipify.org','https://api6.ipify.org'].map(u=>fetch(u).then(r=>r.text()))).then(a=>console.log(a.map(x=>x.value??x.reason.message).join(' ')))\""
```

Run it, restart the machine (`flyctl machine restart <id> --app crawlmouse-worker-staging`), run it
again, and record both readings here. The address is published nowhere else yet.

The deploy itself has already happened when the egress check fails. It tries a reading 15 times, a
minute apart, so it gives up after at least 15 minutes, and keeps flyctl's error output in the log.
If it ends with "not the app's egress IPv4" after a first allocation, the address may still be
applying (Fly says 5 to 10 minutes): re-run the job. If it ends with "could not read the address
seen", read the error lines: the token may not be allowed to open an SSH console (take the reading
above by hand with an organisation token), or the machine may not be running.

## What each verdict means

Each tested crawler gets one verdict per sampled page, from the decision table in the spec.

<!-- generated by `pnpm --filter @crawlmouse/worker spec`: do not edit by hand -->

| Verdict                  | Means                                                                                                                                                                                                                                                                                                                                                                                           | Evidence on the row                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `allowed`                | The crawler's tagged request was served, with at least 80% of the browser control's words.                                                                                                                                                                                                                                                                                                      | The crawler's request and response: status, verdict headers, first 2000 bytes, word count.                         |
| `allowed_thin`           | Served, but with under 80% of the browser control's words.                                                                                                                                                                                                                                                                                                                                      | The crawler's response; a limitation gives both word counts.                                                       |
| `disallowed_by_robots`   | robots.txt tells the crawler not to fetch the path, so nothing was requested as it.                                                                                                                                                                                                                                                                                                             | The robots.txt request (evidence class declared).                                                                  |
| `blocked_by_ua_rule`     | The crawler was refused while the tagged Googlebot canary was served on the same page: the site demonstrably does not verify crawler IPs there, so the refusal is aimed at the user agent.                                                                                                                                                                                                      | The crawler's response; the canary's own row on the same page.                                                     |
| `challenged_ua`          | The crawler was given a challenge while the browser control was served. The real crawler, from its own IPs, may pass.                                                                                                                                                                                                                                                                           | The crawler's response; a limitation names the header, redirect target or body text that identified the challenge. |
| `refused_unverified`     | The crawler was refused and the canary was not served, so a rule against the user agent cannot be told apart from IP verification. The real crawler may pass.                                                                                                                                                                                                                                   | The crawler's response; a limitation says what the canary got and which crawlers were served on the page.          |
| `rate_limited`           | The crawler was answered with 429.                                                                                                                                                                                                                                                                                                                                                              | The crawler's response, with Retry-After when sent.                                                                |
| `payment_required`       | The crawler was answered with 402: the site charges crawlers.                                                                                                                                                                                                                                                                                                                                   | The crawler's response, with crawler-price when sent.                                                              |
| `edge_blocks_automation` | The untagged browser control was itself challenged or refused, so the site treats our requests this way whatever the user agent. The crawlers were not requested.                                                                                                                                                                                                                               | The control's request and response.                                                                                |
| `redirected_away`        | The crawler was redirected to another site; the target was not requested.                                                                                                                                                                                                                                                                                                                       | The redirect response, its Location, and the final URL it pointed to.                                              |
| `not_measured`           | No verdict could be measured: robots.txt unreachable or too large to evaluate, the site refused by the SSRF guard, a Crawl-delay over the worker's limit, robots.txt asking Crawlmouse not to fetch, the control not served, a word count that could not be taken, a control with no words against a crawler response of another type, a budget spent, the site stopped, or the request failed. | Whatever request was made, if any; the limitation says which reason applied.                                       |

<!-- end of generated section -->
