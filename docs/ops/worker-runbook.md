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
health check, a check that every machine runs the CPU kind and count, memory and
`BATCH_CONCURRENCY` the toml sets (`flyctl machines list`), the egress allocation if none exists,
and the egress check. The egress check restarts the machine, so a deploy restarts it twice. It does
not wait for `ci.yml`. The build job has 25 minutes; the worker's test step took 566 s of a 4-vCPU runner in CI run 44255066523 (`gh run view 44255066523 --log`, job `test (worker)`).

By hand, from the repository root:

```bash
pnpm --filter @crawlmouse/worker build
```

```bash
flyctl deploy packages/worker --app crawlmouse-worker-staging --config "$PWD/packages/worker/fly.toml" --remote-only --ha=false
```

A deploy restarts the machine. Batches running at that moment are lost; polls for them answer 404
and the caller sends them again. So does a crash: `fly.toml` sets `[[restart]] policy = "always"`, so
Fly starts the process again whatever its exit. Fly's default (`on-failure`, 10 tries in 5 minutes)
would leave the machine stopped after a crash loop until the next deploy.

## Check the page facts after a deploy

After a deploy that changes what a crawl row records, send one signed crawl batch to staging with
`scripts/worker-batch.ts` ("Send one signed batch (operators)", below) and read its result. What each
field means is in SPEC 12, "The page facts on a crawl row". Choose URLs that show each fact, and
check the result for:

- a URL that redirects twice: `redirect.hops` lists both hops with their statuses, `loop: false`, and
  `final_url` is the last Location;
- a page with a self `rel=canonical` and one with a cross-host canonical: `canonical_declared.href`
  as written, `url` resolved, and `canonical_url` null for both;
- a page with hreflang alternates: `hreflang.links` in page order, `complete: true` unless the page
  also sends a `Link` header with hreflang;
- an article page: `content_simhash` is 16 hex digits, and a two-line page has none;
- every fetched HTML page: `links_read: true` unless a limitation says why not (read in part, links
  past the read limit or over the URL cap, or a page URL over the cap);
- a site whose robots.txt names Googlebot or bingbot: `robots_search` differs per engine as the file
  says, on `robots_disallowed` rows too;
- an access batch: every row with a `raw_status` has `method: GET`, `http_version: 1.1`;
- a page with a title and a meta description, and one with neither: `title` and
  `meta_description` give the collapsed text, its `chars` and `cut: false`; the second gives
  `{ text: null, chars: 0, cut: false }` for both;
- every row of both batches: `source_ip_class: fly_egress`, `fly_region` the Machine's region
  (`flyctl status --app crawlmouse-worker-staging` lists it), `request_signing: unsigned`,
  `signature_verified: not_observable`, and `worker_release` the first 12 hex digits of the deployed
  commit (`git rev-parse --short=12 <sha>`);
- a fetched row: `timing.total_ms` at least `timing.ttfb_ms`, and `dns_ms` and `connect_ms` set on
  the first request to a host, null on a request that reused its connection;
- a host that sends `via`, `x-vercel-id` or `x-amz-cf-id`: the header is in `headers`;
- an access batch: each row's `identity_role` (`control`, `crawler`, `canary`); `tagged` false on the
  control's row and on a crawler row that shows the control's request (the control was blocked or
  unusable), true elsewhere; on each `blocked_by_ua_rule` row a `witness` naming a crawler or the
  canary served on that page; robots.txt evidence carries `identity_sent`;
- a crawl batch: `declarations` lists the seven paths once each, on the first URL's origin, each with
  a status, media type and byte count or a `not_requested` reason, and no body anywhere in the
  result; the batch's `requests` counts them, its `coverage` and `partial` do not; a second crawl
  batch on the same origin within ten minutes carries the answers it kept `from_cache: true`, and
  requests again any path that got no answer; a 408, 425, 429 or 5xx is kept for its Retry-After, at
  least a minute and at most ten.

Each row is parsed by its schema before it leaves the worker (`pageRow` in
`packages/worker/src/batch/crawl.ts`), so the checks above are about the values, not the shape.

### Send one signed batch (operators)

`scripts/worker-batch.ts` sends one crawl or access batch to the worker, polls it every 5 s until it
finishes or its time budget plus 60 s has passed, samples `GET /metrics` once, and writes
`{ "result": …, "metrics": … }` to the file `--out` names. It signs and mints with the functions the
pipeline uses (`apps/web/lib/worker-client/`). From the repository root:

```bash
pnpm --filter @crawlmouse/scripts exec tsx worker-batch.ts --kind crawl --url https://crawlmouse.com/ --url https://crawlmouse.com/pricing --out "$PWD/crawl-result.json"
```

- `--kind access` tests each URL with its own path as its template key.
- `--budget-seconds` is the batch's time budget: 120 by default, at most 1800, the worker's ceiling.
  Requests and bytes are capped at 1,000 and 64 MiB.
- It prints how many pages (or access tests) and requests the batch made, and its partial reasons. A
  failure prints the refusal's kind, HTTP status and the worker's code. The test that drives each
  failure with planted values fails if a value or the JWT appears in what the script prints or
  throws: `pnpm --filter @crawlmouse/scripts exec vitest run worker-batch.test.ts`.
- It exits 0 when the result is written, 1 when the batch did not finish or was refused, and 2 when
  an argument or a value cannot be used.

**Where the three values live.** `CRAWL_WORKER_URL` (the worker's base URL), `WORKER_SIGNING_SECRET`
(the secret the worker holds too) and `WORKER_JWT_PRIVATE_KEY_PKCS8_B64` (the private half of
`WORKER_JWT_PUBLIC_KEY`):

- for the pipeline, the app's secret store, read by `workerClientFromEnv`
  (`apps/web/lib/worker-client/client.ts`);
- for operators, `scripts/.env.local`, which git ignores, readable by its owner alone
  (`chmod 600 scripts/.env.local`).

The private key's value is base64 of its PKCS8 DER bytes, on one line: the body of the PEM that
"First deploy" prints, without its header, footer and line breaks.

**The JWT.** EdDSA over Ed25519, header `{"alg":"EdDSA","typ":"JWT"}`. Claims: `aud`
`crawlmouse-worker`, `role` `crawl_worker`, `check_id`, `site_id`, `site_host`, `batch`, `nonce`,
`iat`, and `exp` 15 minutes after `iat` (the worker refuses a token that lives longer than an hour).
`check_id`, `site_id`, `batch` and `nonce` are the body's; the script makes new ids and a new nonce
for each run, so a run can be repeated as it is.

**One host per JWT.** `site_host` is the first URL's host: lower case, no port. The worker refuses a
batch with a URL on another host (`jwt_scope`), counting `www.` and the bare host as one, and a URL
on a port that is not its scheme's default. The script refuses both before sending, and is stricter:
a URL whose host differs from the first's, `www.` against the bare host included. Smoke several
hosts with one run per host.

**A redirect to another site is recorded, not followed.** A redirect to another registrable domain
is recorded on the page's row (`redirect.hops`) and its target is not requested (SPEC 12,
"Politeness"); an access batch reports it as `redirected_away`. To check the target, send a batch to
its host.

## Roll back

List releases with their images, then deploy the previous image **with the fly.toml it shipped
with**. An image and its toml go together: the toml sets `BATCH_CONCURRENCY`, the heap and the VM, and
an image refuses to start when `BATCH_CONCURRENCY` is above its own `MAX_BATCH_CONCURRENCY` (its
`loadConfig` throws at boot, and `[[restart]] policy = "always"` restarts it in a loop). Today's toml
on an image from before 16 slots is exactly that.

```bash
flyctl releases --app crawlmouse-worker-staging --image
```

Take the commit from the image's label (the workflow labels each image with it), and write that
commit's toml to a file outside the checkout:

```bash
git show <commit of the previous release>:packages/worker/fly.toml > /tmp/fly.previous.toml
```

```bash
flyctl deploy --app crawlmouse-worker-staging --config /tmp/fly.previous.toml --image <image of the previous release> --ha=false
```

This also puts back that release's VM size and heap. Then revert the commit on `main`, or the next
push deploys it again.

## Logs and metrics

```bash
flyctl logs --app crawlmouse-worker-staging
```

The worker logs JSON lines: `reader_started` (the page reader thread is up; the worker does not
listen without it), `measure_reader_started` (the same, for the thread rendered pages are measured
on), `listening`, `batch_accepted`, `batch_done` (with requests and any partial
reasons), `batch_failed`, `request_failed`, `measure_threw` (a rendered page's read threw on the measure thread), `stopping`. It does not log URLs, headers,
secrets or JWTs. `GET /metrics` is signed with the signing secret, purpose `metrics`; it gives
memory (resident now, peak resident since the process started, heap used), event-loop lag p99 since
start, batches running and stored, requests started per site, and `reader_restarts`: page reader threads
started to replace one that died or passed a read's deadline. `measure_reader_restarts` counts the
same for the measure thread, which POST /render/measure reads on so that a slow rendered page never
holds up a crawl read. Each thread's old space is `READER_HEAP_MB` (192 MiB, `src/reader/thread-reader.ts`).
To read it without handling the secret, sign it inside the machine:

```bash
flyctl ssh console --app crawlmouse-worker-staging -C "node -e \"const c=require('node:crypto');const ts=String(Date.now());const sig=c.createHmac('sha256',process.env.WORKER_SIGNING_SECRET).update(ts+'.metrics').digest('hex');fetch('http://127.0.0.1:8080/metrics',{headers:{'x-crawlmouse-ts':ts,'x-crawlmouse-signature':sig}}).then(r=>r.text()).then(console.log)\""
```

## Crashed, crash-looping or unhealthy

fly.toml restarts the machine whenever its process exits (`[[restart]] policy = "always"`), with no
limit on retries. A failing `/healthz` check does not restart it: Fly only stops routing to it. A
restart loses the batches that were running, and `GET /batch/{id}` for one of them answers 404
`not_found`, so the caller has to send the batch again.

- **Killed for memory.** `flyctl logs` shows the kernel's `Out of memory: Killed process` line, then
  the machine starting again. The VM has 2 GB (fly.toml `[[vm]]`). `peak_rss_mb` in `GET /metrics`
  starts again with the process, so it cannot show the peak that killed it; read it while batches
  run to see how close the process gets.
- **Running but unhealthy.** Find the machine and restart it by hand:

  ```bash
  flyctl machine list --app crawlmouse-worker-staging
  ```

  ```bash
  flyctl machine restart <machine id> --app crawlmouse-worker-staging
  ```

- **The page reader thread died or passed a read's deadline (20 s).** The process stays up and so
  do the batches: only the page being read fails, as `reader_thread_crashed` or `reader_deadline`,
  and the reads queued behind it go to a new thread. `reader_restarts` in `GET /metrics` counts the
  replacements; each batch's result counts its pages not read by reason (`not_read` findings). A
  steady rise in `reader_restarts` with `reader_deadline` findings is most likely CPU throttling
  (below); with `reader_thread_crashed`, a page that runs the thread out of memory.
  All batches share the one thread, and reads queue in order, so a site whose pages are slow to read
  delays the reads of the batches running beside it. Those batches can then spend their time budget
  and come back partial with `budget_seconds`, which is the worker's limit, not those sites'.
- **Batches at once.** `BATCH_CONCURRENCY` in fly.toml (16), at most 16 (the worker refuses to start
  above it). What each level costs in CPU and memory, and where each machine size stops keeping up,
  is in "Capacity" below.
- **CPU throttled.** The VM is `shared-cpu-2x`: two shared vCPUs. A shared vCPU is guaranteed 6.25% of a core (5 ms per 80 ms). It runs
  at up to 100% while it has burst balance, which accrues from unused baseline time (starting at
  5 s, at most 500 s; about 533 s of full use from a full balance), then drops back to 6.25%. These
  are Fly's figures for one shared vCPU as of 2026-10-31 (how they scale to `shared-cpu-2x`'s two is not measured here), and Fly says they may change:
  <https://docs.fly.io/machines/cpu-performance>. Throttled, a page read that takes 0.6 s can take
  about 10 s, which is why a read's deadline is 20 s. Signs: `fly_instance_cpu_throttle` rising, and
  the "CPU Quota Balance and Throttling" panel of the Fly Instance dashboard (Managed Grafana) at
  zero balance; in the worker, `event_loop_lag_p99_ms` and `reader_restarts` rising and
  `reader_deadline` in batch findings. What to do: lower `BATCH_CONCURRENCY` (fewer batches spend
  the balance more slowly), or move the machine to a `performance` CPU, which is not throttled to a
  shared baseline (an owner decision: it costs more).
- **Crash loop.** If the machine dies again soon after each restart, a batch the caller sends again
  may be the cause. Set `CRAWL_PAUSED=1` (Stop all crawling, below) so `POST /batch` answers 503,
  then read the `batch_accepted` lines before each restart in `flyctl logs` to find it.

## Capacity

How many batches one machine runs at once, measured. Re-measure before changing `BATCH_CONCURRENCY`,
the VM or the heap: `src/load.test.ts` measures the levels listed at the end of this section, and the
worker refuses a `BATCH_CONCURRENCY` above `MAX_BATCH_CONCURRENCY`.

<!-- capacity: generated by `pnpm --filter @crawlmouse/worker spec` from src/spec/capacity-measured.json: do not edit by hand -->

**What ships:** `BATCH_CONCURRENCY` 16 (the worker allows at most 16), on shared-cpu-2x with 2048mb and a 512 MB heap, in both fly tomls. The result store keeps 500 batches and 272 MiB of results.

**Realistic pages, on Fly.** Measured 2026-11-18 on `crawlmouse-worker-staging`. One crawl batch in flight per site (cm42b-\*.fly.dev, each its own registrable domain), 50 URLs a batch at most, CRAWL_BATCH_BUDGET, for 240 s per level; heap 256 MB as shipped then. Levels ran one after another, each for 240 s, so a level drew on the CPU burst balance the levels before it left; "Balance min" is Fly's `fly_instance_cpu_balance` at its lowest in the level, as Fly reports it. Loop delay is `monitorEventLoopDelay` less its 20 ms sampling interval. A site's floor is 0.50 s a page.

| Machine             | Batches | vCPU mean / max | Throttle max | Balance min | Peak RSS MiB | Loop delay p50 / p99 / max ms | s a page p50 / p90 / max | Wire gap p1 ms | Wire gaps under 250 ms | Batches done | Partial, refused, timeouts |
| ------------------- | ------- | --------------- | ------------ | ----------- | ------------ | ----------------------------- | ------------------------ | -------------- | ---------------------- | ------------ | -------------------------- |
| shared-cpu-1x 1 GB  | 4       | 0.05 / 0.06     | 0            | 5667        | 144          | 0 / 1 / 14                    | 0.52 / 0.61 / 0.9        | 497            | 0 of 1864              | 108 of 108   | 0, 0, 0                    |
| shared-cpu-1x 1 GB  | 8       | 0.08 / 0.11     | 0            | 5509        | 162          | 0 / 1 / 21                    | 0.52 / 0.67 / 3.5        | 497            | 0 of 3758              | 179 of 179   | 0, 0, 2                    |
| shared-cpu-1x 1 GB  | 16      | 0.15 / 0.18     | 0            | 3203        | 186          | 0 / 2 / 23                    | 0.52 / 0.60 / 1.1        | 496            | 11 of 7536             | 364 of 364   | 0, 0, 0                    |
| shared-cpu-1x 1 GB  | 32      | 0.59 / 1.02     | 94           | 1           | 204          | 0 / 463 / 2142                | 0.53 / 1.65 / 5.6        | 486            | 48 of 10682            | 465 of 465   | 0, 0, 1                    |
| shared-cpu-1x 1 GB  | 64      | 0.86 / 1.02     | 94           | 1           | 218          | 0 / 2941 / 4782               | 4.90 / 18.76 / 22.0      | 288            | 27 of 3159             | 113 of 114   | 7, 1, 335                  |
| shared-cpu-2x 2 GB  | 4       | 0.06 / 0.09     | 0            | 10115       | 149          | 0 / 1 / 17                    | 0.53 / 0.67 / 1.0        | 498            | 0 of 1878              | 107 of 107   | 0, 0, 0                    |
| shared-cpu-2x 2 GB  | 8       | 0.09 / 0.11     | 0            | 12519       | 166          | 0 / 1 / 7                     | 0.52 / 0.58 / 0.9        | 497            | 0 of 3824              | 184 of 184   | 0, 0, 0                    |
| shared-cpu-2x 2 GB  | 16      | 0.17 / 0.21     | 0            | 12557       | 189          | 0 / 1 / 8                     | 0.52 / 0.60 / 1.1        | 497            | 15 of 7580             | 364 of 364   | 0, 0, 0                    |
| shared-cpu-2x 2 GB  | 32      | 0.31 / 0.40     | 0            | 7865        | 201          | 0 / 2 / 21                    | 0.52 / 0.61 / 1.1        | 496            | 30 of 15228            | 694 of 694   | 0, 0, 0                    |
| shared-cpu-2x 2 GB  | 64      | 0.93 / 1.96     | 178          | 1           | 226          | 0 / 219 / 1020                | 0.53 / 1.22 / 2.3        | 487            | 84 of 24868            | 1114 of 1114 | 0, 0, 0                    |
| performance-1x 2 GB | 4       | 0.06 / 0.07     | 0            | 81312       | 142          | 0 / 1 / 16                    | 0.52 / 0.60 / 1.1        | 497            | 0 of 1888              | 108 of 108   | 0, 0, 0                    |
| performance-1x 2 GB | 8       | 0.08 / 0.11     | 0            | 112662      | 157          | 0 / 1 / 15                    | 0.52 / 0.65 / 0.9        | 497            | 0 of 3754              | 181 of 181   | 0, 0, 0                    |
| performance-1x 2 GB | 16      | 0.15 / 0.18     | 0            | 143267      | 182          | 0 / 2 / 19                    | 0.52 / 0.59 / 1.1        | 497            | 8 of 7550              | 363 of 363   | 0, 0, 0                    |
| performance-1x 2 GB | 32      | 0.28 / 0.34     | 0            | 171877      | 197          | 0 / 3 / 26                    | 0.52 / 0.61 / 1.2        | 492            | 32 of 15238            | 693 of 693   | 0, 0, 0                    |
| performance-1x 2 GB | 64      | 0.25 / 0.63     | 0            | 196667      | 208          | 0 / 5 / 166                   | 0.52 / 0.64 / 1.3        | 486            | 10 of 30228            | 1372 of 1372 | 0, 0, 1                    |

Where each machine's CPU stopped keeping up (the first level Fly throttled it, within a 240 s level):

- **shared-cpu-1x 1 GB:** throttled at 32 (not at 16): loop delay p99 463 ms, p90 1.65 s a page.
- **shared-cpu-2x 2 GB:** throttled at 64 (not at 32): loop delay p99 219 ms, p90 1.22 s a page.
- **performance-1x 2 GB:** not throttled at any level, up to 64.

**Gaps under 250 ms on the wire.** The column above counts arrivals at the fixture, not starts in the worker. Re-measured 2026-11-18 on shared-cpu-2x 2 GB at 16 batches over 16 sites: 16 arrival gaps under 250 ms (14 to 126 ms), on 16 sites, and every one was `/robots.txt` then `/`. The worker started those requests at least 499 ms apart (`fetched_at` on the page rows).

The first request to a site opens the connection and the next reuses it. On `cm42b-s-20` alone, robots.txt arrived 61 ms after its start and the next request 5 ms after its start, 500 ms later, so the arrivals were 444 ms apart. In the 16-site run the robots.txt starts were not recorded, so a longer connection setup under load is the explanation the probe supports, not a figure measured for each of those gaps.

**Worst-case pages, in `src/load.test.ts`.** Measured 2026-11-18 at a 512 MB heap, on the test's 10 MB pages, with the result store full. Each peak is the highest of the runs on the date: one run of the file alone, one inside the full worker suite; the full-budget rows ran once. A level's bound is its highest peak × 1.35, rounded up to 10 MiB: 4: 911.4 → 1240 MiB (× 1.36); 8: 868.9 → 1180 MiB (× 1.36); 16: 1167.6 → 1580 MiB (× 1.35).

| Batches | Case                                                | Peak RSS MiB | Heap used MiB | Bound MiB |
| ------- | --------------------------------------------------- | ------------ | ------------- | --------- |
| 4       | 10 MB pages, 50 URLs                                | 782.5        | 125.8         | 1240      |
| 4       | access, 2 pages                                     | 527.6        | 45.4          | 1240      |
| 4       | brotli, 50 URLs                                     | 743.4        | 123.1         | 1240      |
| 4       | densest markup, 4 URLs                              | 911.4        | 64.0          | 1240      |
| 8       | brotli, 50 URLs, cut short at 60 s                  | 825.3        | 177.9         | 1180      |
| 8       | brotli, 50 URLs, full budget (once, not in CI)      | 868.9        | 224.7         | 1180      |
| 16      | 10 MB pages, 50 URLs, cut short at 60 s             | 915.1        | 260.5         | 1580      |
| 16      | 10 MB pages, 50 URLs, full budget (once, not in CI) | 1131.1       | 397.0         | 1580      |
| 16      | access, 2 pages                                     | 626.3        | 97.7          | 1580      |
| 16      | brotli, 50 URLs, cut short at 60 s                  | 928.6        | 244.6         | 1580      |
| 16      | brotli, 50 URLs, full budget (once, not in CI)      | 1167.6       | 401.9         | 1580      |
| 16      | densest markup, 4 URLs                              | 1108.0       | 165.6         | 1580      |

Levels run: 4, 8, 16. The largest result the load test measured is 8.36 MiB; 16 of them twice over is 267 MiB, which the store's 272 MiB holds.

<!-- end of capacity section -->

### The done signal (PR 5a)

The worker can tell the app when a batch ends, so a check reads it at once instead of at its next poll.
Set the app's route as a secret on each worker. The address differs per worker, so it cannot live in
`fly.toml`, which must match `fly.production.toml`:

```bash
flyctl secrets set APP_SIGNAL_URL=https://<the app's host>/api/webhooks/worker --app <the worker's app>
```

Until it is set the worker sends nothing and checks poll as before, so the app and the worker can deploy
in either order. To turn it off, unset the secret. Verify:
`pnpm --filter @crawlmouse/worker exec vitest run src/signal.test.ts src/signal-config.test.ts`.

**Staging only.** The staging app is behind Vercel Deployment Protection, which answers the worker's
POST with 401 before it reaches the route. Give the staging worker the automation bypass as its own
secret, from standard input so it stays out of the shell history. The worker sends it as the
`x-vercel-protection-bypass` header and never logs it. It ignores the value unless it is the staging
worker and the signal's address is on `*.vercel.app`. Never put it in `APP_SIGNAL_URL`, and do not set
it on production.

```bash
printf 'APP_SIGNAL_PROTECTION_BYPASS=%s\n' "$VERCEL_AUTOMATION_BYPASS_SECRET" | flyctl secrets import --app crawlmouse-worker-staging
```

### Lab hosts on staging (F-018)

The worker keys its limiter and its stop on the registrable domain, so every `*.lab.crawlmouse.com` host
shares one 2 requests a second. A load test of many lab hosts would measure that one limiter. To give each
lab host its own, set this once on the staging worker:

```bash
flyctl secrets set LAB_HOST_POLITENESS=1 --app crawlmouse-worker-staging
```

Only a host under `lab.crawlmouse.com` changes, and "off-site" does not. The production app ignores the
setting. Verify: `pnpm --filter @crawlmouse/worker exec vitest run src/config.test.ts src/politeness/site-key.test.ts src/batch/lab-host-key.test.ts`.

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

## Production

The production worker is the Fly app `crawlmouse-worker` (region `iad`, one machine), configured by
`packages/worker/fly.production.toml`: `fly.toml` with the app's name changed and nothing else
(`pnpm --filter @crawlmouse/worker exec vitest run src/fly-production.test.ts` fails on any other
difference). It is deployed by `.github/workflows/worker-production.yml`, which starts only when the
owner dispatches it from `main`: a push or a merge does not deploy it, and the workflow refuses a
run dispatched or re-run by anyone else, or from another ref
(`pnpm --filter @crawlmouse/scripts exec vitest run db/worker-production-workflow.test.ts`).

The staging sections above apply to production with `--app crawlmouse-worker` and
`--config packages/worker/fly.production.toml` in place of the staging app and `fly.toml`. The
differences are below.

### Before the first deploy (owner, once)

- **Fly token.** Create an organisation token, `flyctl tokens create org --org <slug>`, and add it as
  the secret `FLY_API_TOKEN` to a new GitHub environment named `worker-production` (Settings,
  Environments). Once the app exists, replace it with a deploy token for the app alone
  (`flyctl tokens create deploy --app crawlmouse-worker`) if that token can open the SSH console the
  egress check uses; if it cannot, keep the organisation token and record why here. An organisation
  token can also deploy or destroy every other app in the organisation, staging included.
- **Fly organisation.** Set the variable (not a secret) `FLY_ORG` on `worker-production` to the
  organisation's slug. The workflow refuses to create the app without it.
- **Branch restriction.** Restrict `worker-production`'s deployment branches to `main`. Once the
  repository is private, the environment has no required reviewer
  (`docs/specs/v2/repo-private.md`), so what holds the token back is that restriction, the owner
  check the workflow runs before anything else, and the rule that no other workflow names the
  environment (`confinedEnvironmentProblems` in `scripts/db/workflow-file.ts`).

### First deploy

1. Generate a signing secret and a JWT key pair for production, as in "First deploy" step 1 above.
   Do not reuse staging's: a value shared by the two would let a batch signed for one be accepted
   by the other.
2. Create the app, so its secrets can be set before the first deploy:

   ```bash
   flyctl apps create crawlmouse-worker --org <slug>
   ```

3. Set the two secrets, read from the terminal and passed on standard input, so neither lands in
   shell history or on a command line:

   ```bash
   read -rs SIGNING && read -rs PUBLIC && printf 'WORKER_SIGNING_SECRET=%s\nWORKER_JWT_PUBLIC_KEY=%s\n' "$SIGNING" "$PUBLIC" | flyctl secrets import --stage --app crawlmouse-worker; unset SIGNING PUBLIC
   ```

   Check the names, never the values: `flyctl secrets list --app crawlmouse-worker`.

4. Dispatch the workflow from `main`: Actions, `worker-production`, Run workflow, branch `main`; or
   `gh workflow run worker-production.yml --ref main` while logged in as the owner. `authorize`
   checks who dispatched it and from where; `build` runs the worker's tests, typecheck and bundle;
   `deploy` checks again, deploys that bundle with the image labelled with the commit
   (`--image-label`), checks `/healthz`, checks that the machine runs the size, memory and
   `BATCH_CONCURRENCY` `fly.production.toml` sets, allocates the egress pair if the region has no
   egress IPv4,
   and checks the egress address before and after a restart, masked. A deploy restarts the machine
   twice. If a step fails and you re-run the failed job, re-run it yourself: the owner check reads
   who re-ran it.
5. Record the egress address (below), then set the app's variables (below).

### Egress address (production)

Sites see production's requests from this pair. A site owner who allow-lists crawlers by address
needs it, so it is recorded here once the first deploy has allocated it. Take the readings as in
"Egress address" above, with `--app crawlmouse-worker`, before and after a
`flyctl machine restart <id> --app crawlmouse-worker`.

| Family | Address                         | Before restart | After restart | Recorded   |
| ------ | ------------------------------- | -------------- | ------------- | ---------- |
| IPv4   | `209.71.119.230`                | the same       | the same      | 2026-11-16 |
| IPv6   | `2a09:8280:e618:1:0:208:73b7:0` | not read       | not read      | 2026-11-16 |

The restart reading covers IPv4 only; the IPv6 row records the address alone.

Both addresses are the app's `egress_v4` and `egress_v6` in `iad`, read with the read-only token:
`flyctl ips list --app crawlmouse-worker --json`. The IPv4 columns come from worker-production run
43789159313, whose deploy job logged "egress: the app's own IPv4, the same before and after a
restart" with the readings masked. That check reads IPv4 only. The IPv6 readings need the SSH
console and a restart, which a read-only token cannot do, so they are not taken. The owner ruled
the address-only IPv6 row enough (2026-11-16).

### The app's variables

In Vercel, production environment, set:

- `CRAWL_WORKER_URL` to `https://crawlmouse-worker.fly.dev`;
- `WORKER_SIGNING_SECRET` to the value set on the worker;
- `WORKER_JWT_PRIVATE_KEY_PKCS8_B64` to the private half of the worker's `WORKER_JWT_PUBLIC_KEY`,
  as base64 of its PKCS8 DER bytes on one line ("Where the three values live", above).

A variable takes effect at the app's next deployment, not on the one already running.

### A read-only token for the go-live check

`pnpm golive:check` reads which image the production machine runs. Give it a token that can read
and not deploy:

```bash
flyctl tokens create readonly --org <slug>
```

Put it in `scripts/.env.local` as `FLY_READ_TOKEN` (the file git ignores; `chmod 600
scripts/.env.local`). Not the deploy token: the check needs to read and nothing more.

### Deploy

Only by dispatch, as in step 4. Merging to `main` changes nothing in the production worker, but Vercel
deploys the app on the same merge: after merging a change to a worker input (the paths
`worker-staging.yml` lists), dispatch `worker-production`, or make the change work with the running
worker first. `pnpm golive:check` reports the two apart. Every dispatch deploys `main`'s head.

### Roll back

List the releases with their images, then deploy the previous one **with the
fly.production.toml it shipped with** (why: "Roll back" above):

```bash
flyctl releases --app crawlmouse-worker --image
```

For a release the workflow deployed, the image reference ends with the commit it was built from,
the label it gave the image. Write that commit's toml to a file outside the checkout:

```bash
git show <commit of the previous release>:packages/worker/fly.production.toml > /tmp/fly.production.previous.toml
```

```bash
flyctl deploy --app crawlmouse-worker --config /tmp/fly.production.previous.toml --image <image of the previous release> --ha=false
```

This also puts back that release's VM size and heap. Then fix or revert the change on `main` before
the next dispatch, which deploys `main`'s head again.

What a rollback does to checks in flight: the deploy restarts the machine, so batches running at
that moment are lost (up to `BATCH_CONCURRENCY` of them), and the check sends each one again once.
A deploy restarts the machine twice (the rollout, then the egress check's restart). A batch lost at
both is given up and its check goes on without it, so it can end with fewer pages, or
`worker_unavailable` when it read no crawl batch at all (`runBatch` in `inngest/check.ts`). Deploy at
a quiet hour, or set `CRAWL_PAUSED=1` first ("Stop all crawling"), so fewer are running. A check that already took a batch
from the release before the rollback and then reads one from the rolled-back release stops there:
`take` in `inngest/check.ts` refuses a batch whose worker release differs from the first one the
check read. The same holds for any production deploy. Since F-260, the check is then queued again
and run once more from the start, as a new run of the same check (`redeployed` in
`inngest/check.ts`, the `requeue` step); its batch numbers continue past the first run's, because the
worker keeps a result for an hour under (check, batch number). A retry run that meets another
release in turn fails the check with `worker_redeployed`, and that check has to be run again. So
two deploys within one check's run still cost it; space them by the longest check's time.

## Browser Run: the render token, limits and cost

The render step (CC-14, `docs/specs/v2/14-render.md`) calls Cloudflare Browser Run's REST `/content`
endpoint. It is not part of the worker; it runs in whichever process the pipeline (CC-20) gives it,
and reads these from that process's environment:

- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account's id.
- `CLOUDFLARE_BROWSER_RENDERING_TOKEN`: an API token scoped to that account with the one permission
  `Browser Run - Edit`, as Cloudflare's Quick Actions page named it on 2026-11-05 (Cloudflare
  dashboard, My Profile, API Tokens, Create Custom Token). Nothing else.
- `RENDER_MAX_BROWSER_SECONDS_PER_CHECK` and `RENDER_MAX_BROWSER_SECONDS_PER_DAY`: whole seconds.
  Unset or invalid reads as zero, and zero renders nothing. A page reserves 90 s (two renders at the
  45 s request timeout) from its check's allowance before it starts, so a cap under 90 renders
  nothing, and a check has about `cap / 90` pages rendering at once, at most the in-flight limit.
- `RENDER_MAX_IN_FLIGHT`: requests one check keeps open at once, a whole number from 1 to 10. Unset
  or anything else reads as 2.

A check asks the day's budget once, before any page, for its allowance: the per-check cap, or 90 s
for each page it sampled, whichever is less. When the day has less than that left, the check renders
nothing and records `daily_cap` on each sampled page, even if a few pages would have fitted. After its
last page the check settles once, at the browser time it counted: that gives back what it did not use,
or adds what renders reported beyond their reservation. If that settle fails, the outcome carries
`settle_failed`, and the day may still count the whole allowance, depending on the store.

Without both credentials, or with a zero cap, a check records its sampled pages as not rendered and
goes on; it does not fail. To stop rendering, unset the token or set either cap to `0`.

Limits on Workers Paid, as Cloudflare's limits page stood on 2026-10-14 (read 2026-11-05): 30 Quick
Actions requests per second per account, after which Browser Run answers 429; a browser closes after
60 s without a command. The render step keeps at most 2 requests open per check unless set, up to 10
(checks running at once each have their own). It retries a 429 no sooner than its `Retry-After`
asks, in seconds or as a date, backs off from 2 s when it gives neither, and leaves the page
`rate_limited` after 5 tries, or at once when asked to wait longer than 60 s.

**Production rendering needs Workers Paid before CC-20 switches it on.** The account is on Workers
Free (the owner's billing page, 2026-11-05). On Free, the same limits page gives one Quick Actions
request every 10 s per account and 10 browser-minutes a day. Measured on 2026-11-05 with the live
tests: a request sent at once after another was answered 429; one sent 10 s after a 429 was answered
200; the 429s carried no `Retry-After` in seconds. Each page sends its two requests back to back, so
a check exceeds that rate at any in-flight setting, and on Free its pages wait on 429s and can end
`rate_limited`.

Cost: $0.09 per browser-hour after the 10 browser-hours a month Workers Paid includes. Each reply
reports its browser time in the `x-browser-ms-used` header. The step counts that against its caps and
totals it per check as `browser_ms`, using the 45 s request timeout where a reply reports none or no
reply came. Cloudflare's bill is on the dashboard's Browser Run page; this build has not compared it
with `browser_ms`. Beyond
the included hours, 200 counted browser-seconds is about $0.005. A check can end above its cap by
what renders in flight report beyond their reservation.

To rotate the token: create the new one, set it where the old one is set, redeploy that process, then
delete the old one in the dashboard.

### Running the render tests

Run one test file at a time, from `packages/engine`:
`timeout -s KILL 150 node node_modules/vitest/vitest.mjs run src/v2/render/<file>.test.ts --pool=threads`.
The live tests read the credentials from the environment, or, with `RENDER_LIVE=1`, from
`~/.config/crawlmouse/render.env` outside the repository. Their console lines print word counts and
probe output, not the credentials (`grep -n console.info src/v2/render/live.test.ts`):
`RENDER_LIVE=1 timeout -s KILL 600 node node_modules/vitest/vitest.mjs run src/v2/render/live.test.ts --pool=threads`.

Only ever kill processes started from your own worktree. Another session's tests may be running on
the same machine, and killing by process name stops them too.

## What each verdict means

Each tested crawler gets one verdict per sampled page, from the decision table in the spec.

<!-- generated by `pnpm --filter @crawlmouse/worker spec`: do not edit by hand -->

| Verdict                  | Means                                                                                                                                                                                                                                                                                                                                                                                           | Evidence on the row                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `allowed`                | The crawler's tagged request was served, with at least 80% of the browser control's words.                                                                                                                                                                                                                                                                                                      | The crawler's request and response: status, verdict headers, first 2000 bytes, word count.                         |
| `allowed_thin`           | Served, but with under 80% of the browser control's words.                                                                                                                                                                                                                                                                                                                                      | The crawler's response; a limitation gives both word counts.                                                       |
| `disallowed_by_robots`   | robots.txt tells the crawler not to fetch the path, so nothing was requested as it.                                                                                                                                                                                                                                                                                                             | The robots.txt request (evidence class declared).                                                                  |
| `blocked_by_ua_rule`     | The crawler was refused while another tested crawler, or the tagged Googlebot canary, was served on the same page from the same address: a refusal of the address would have refused that one too, so this refusal is aimed at the user agent.                                                                                                                                                  | The crawler's response; its `witness` names the identity served, and that identity's own row is on the same page.  |
| `challenged_ua`          | The crawler was given a challenge while the browser control was served. The real crawler, from its own IPs, may pass.                                                                                                                                                                                                                                                                           | The crawler's response; a limitation names the header, redirect target or body text that identified the challenge. |
| `refused_unverified`     | The crawler was refused and nothing else we sent that claims to be a crawler, the canary included, was served on the page, so a rule against the user agent cannot be told apart from IP verification. The real crawler may pass.                                                                                                                                                               | The crawler's response; a limitation says what the canary got.                                                     |
| `rate_limited`           | The crawler was answered with 429.                                                                                                                                                                                                                                                                                                                                                              | The crawler's response, with Retry-After when sent.                                                                |
| `payment_required`       | The crawler was answered with 402: the site charges crawlers.                                                                                                                                                                                                                                                                                                                                   | The crawler's response, with crawler-price when sent.                                                              |
| `edge_blocks_automation` | The untagged browser control was itself challenged or refused, so the site treats our requests this way whatever the user agent. The crawlers were not requested.                                                                                                                                                                                                                               | The control's request and response.                                                                                |
| `redirected_away`        | The crawler was redirected to another site; the target was not requested.                                                                                                                                                                                                                                                                                                                       | The redirect response, its Location, and the final URL it pointed to.                                              |
| `not_measured`           | No verdict could be measured: robots.txt unreachable or too large to evaluate, the site refused by the SSRF guard, a Crawl-delay over the worker's limit, robots.txt asking Crawlmouse not to fetch, the control not served, a word count that could not be taken, a control with no words against a crawler response of another type, a budget spent, the site stopped, or the request failed. | Whatever request was made, if any; the limitation says which reason applied.                                       |

<!-- end of generated section -->
