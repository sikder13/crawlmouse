# Load-test harness (k6)

> ## ⚠️ STAGING ONLY — NEVER run against production
>
> These scripts generate synthetic, high-concurrency traffic. Pointing them at the live site would:
> - **Exhaust rate-limit and global-ceiling buckets** that protect real users, locking them out.
> - **Burn the Turnstile budget** and trip anti-abuse defenses.
> - **Cost real money** (compute, crawl jobs, bandwidth) and pollute analytics + billing data.
>
> `BASE_URL` has **no default** and **must** be supplied per run. If it is missing, every script
> throws at module load and refuses to start. There is intentionally **no production host string
> anywhere in this directory** — the only way to run is to pass an explicit `-e BASE_URL=...` that
> points at an **isolated staging target**.

This harness load-tests the audit **front gate** — request parsing, the per-domain / per-IP
rate-limit buckets, the global daily ceiling, and Turnstile verification — without standing up real
infrastructure or creating thousands of real crawl jobs. See [Expected results](#expected-results)
for exactly what it does and does not exercise.

---

## When the full run happens

The full `audit-submit.js` ramp peaks at **1000 virtual users (VUs)**. That run is **deferred** to
deploy time and is executed **once, against an isolated staging target** — it is **NOT** run in CI
and **NOT** run locally. CI only runs the vitest guard (`apps/web/__tests__/load-harness-guard.test.ts`),
which statically asserts these scripts stay safe and contract-correct; it never invokes k6.

Locally you may run `smoke.js` against your own `next dev` server (see below) — that is cheap and
safe. Do not run the 1000-VU ramp locally; a dev server is not representative and will simply fall
over.

---

## Installing k6

k6 is **not** bundled with this repo and is not installed in CI.

- **macOS:** `brew install k6`
- **Linux (Debian/Ubuntu, apt repo):**
  ```sh
  sudo gpg -k
  sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
    --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
  echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
    | sudo tee /etc/apt/sources.list.d/k6.list
  sudo apt-get update && sudo apt-get install k6
  ```
- **Any platform (binary fallback):** download a release archive from
  <https://github.com/grafana/k6/releases>, extract, and put the `k6` binary on your `PATH`.
- **Full install docs:** <https://grafana.com/docs/k6/latest/set-up/install-k6/>

Verify with `k6 version`.

---

## Building the staging target

Stand up an **isolated** target that mirrors prod's shape but shares **none** of its data, money, or
anti-abuse budget:

1. **Vercel preview deploy** of `apps/web` (a preview/branch deployment, not the production
   deployment). Its URL is your `BASE_URL`, e.g. `https://crawlmouse-git-<branch>-<scope>.vercel.app`.
2. **Supabase branch database** (a throwaway branch off the project), so synthetic audit rows never
   touch production data. Point the preview deploy's Supabase env vars at the branch.
3. **Stripe TEST keys** (never live keys) for the preview's billing env, so nothing bills a real
   card.
4. **Cloudflare Turnstile TESTING keys** that always pass, set on the preview deploy:
   - Site key (client): `1x00000000000000000000AA`
   - Secret key (server, `TURNSTILE_SECRET_KEY`): `1x0000000000000000000000000000000AA`

   These are Cloudflare's documented always-pass test keys
   (<https://developers.cloudflare.com/turnstile/troubleshooting/testing/>).

   **Important — the dummy token.** A Turnstile **test secret key only accepts the dummy token**
   `XXXX.DUMMY.TOKEN.XXXX` and rejects real tokens (and a production secret key rejects the dummy
   token). So when the testing secret key is set, pass exactly:

   ```
   -e TURNSTILE_TEST_TOKEN=XXXX.DUMMY.TOKEN.XXXX
   ```

   That is the value our server's `verifyTurnstileToken` will see succeed at siteverify. Do **not**
   assume an arbitrary non-empty string works against the real siteverify endpoint — it does not.

> Treat the staging Turnstile secret as test-only: never let the always-pass keys reach the
> production deployment.

---

## Running

Replace `<staging-preview-url>` with the Vercel **preview** URL from the step above.

### Smoke (run this first)

Low-VU sanity that `/` and `/status` return 200 within budget:

```sh
k6 run -e BASE_URL=https://<staging-preview-url> tests/load/smoke.js
```

Local variant against your own dev server (start it with
`pnpm --filter @crawlmouse/web dev`, which serves http://localhost:3000):

```sh
k6 run -e BASE_URL=http://localhost:3000 tests/load/smoke.js
```

### Ramp (the deferred 1000-VU run — staging only)

```sh
k6 run \
  -e BASE_URL=https://<staging-preview-url> \
  -e TURNSTILE_TEST_TOKEN=XXXX.DUMMY.TOKEN.XXXX \
  tests/load/audit-submit.js
```

---

## What the thresholds mean

`smoke.js`:
- `http_req_duration: ['p(95)<800']` — 95% of requests to the static pages must complete in under
  800 ms. A Vercel preview can cold-start, so this is looser than a warmed CDN baseline but still
  catches a genuinely broken/slow target.
- `checks: ['rate>0.99']` — effectively every request must be 200; any non-200 fails the run.

`audit-submit.js`:
- `http_req_duration: ['p(95)<2000']` — 95% of `POST /api/audits/start` calls must complete in
  under 2 s, even at the 1000-VU peak.
- `errors: ['rate<0.05']` — `errors` is a `Rate` that counts only **server errors (HTTP 5xx)**.
  Fewer than 5% of all requests may be 5xx, or the run fails. **Expected** outcomes (200 created,
  400 invalid-URL, 429 rate-limited / captcha-required, 503 global ceiling) are **not** errors — the
  in-script `check` passes for any status `< 500`.

---

## Expected results

The ramp posts synthetic bodies of the form
`{ "url": "https://example-<vu>-<iter>.test", "turnstileToken": "<TURNSTILE_TEST_TOKEN>" }`.

The `.test` TLD is **rejected by URL/SSRF validation** (`validateUrlOrThrow`) and the route returns
**400 before any rate-limit bucket or DB insert is touched** (URL validation runs first, then the
global ceiling, then the per-domain/per-IP buckets, and Turnstile is only checked once a caller's
per-IP daily limit is already exhausted). So under a synthetic `.test` run you should expect to see
**mostly 400, with 429 once the global daily ceiling and any IP/domain buckets engage** — and very
few or no 200s. **That is correct and intended:** this run stresses the *front gate* (parse →
ceiling → rate-limit → captcha), not the full crawl path. The README does not pretend otherwise.

### Optionally exercising real audit CREATION on staging

If the operator wants the ramp to actually create audits (and stress the crawl pipeline), point it
at a URL that **passes** validation (a real, routable `https://` host you control — not `.test`) and
rely on the always-pass Turnstile secret key on staging. Note this will create real crawl jobs on
the staging branch DB and consume the staging concurrency budget; size the run accordingly and only
do it against the isolated staging target.

---

## Saving run output (evidence)

At deploy time, capture the k6 summary and drop it in the repo's top-level `evidence/` directory so
the run is auditable, e.g.:

```sh
k6 run -e BASE_URL=https://<staging-preview-url> tests/load/smoke.js \
  | tee evidence/k6-smoke-$(date +%Y%m%d).txt

k6 run \
  -e BASE_URL=https://<staging-preview-url> \
  -e TURNSTILE_TEST_TOKEN=XXXX.DUMMY.TOKEN.XXXX \
  --summary-export evidence/k6-audit-submit-$(date +%Y%m%d).json \
  tests/load/audit-submit.js \
  | tee evidence/k6-audit-submit-$(date +%Y%m%d).txt
```

Reference the saved `evidence/` files from the deploy runbook when signing off on load readiness.
