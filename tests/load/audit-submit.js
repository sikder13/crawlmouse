import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// Ramp load test for the audit FRONT GATE: POST /api/audits/start.
//
// What this exercises: request parsing (Zod body schema), the global daily ceiling, the per-domain
// and per-IP rate-limit buckets, and Turnstile verification. It does NOT, by default, exercise the
// full crawl path: the synthetic `.test` URLs below are rejected by SSRF/URL validation (=> 400)
// before any DB insert, so a fake-URL run mostly produces 400/429, not 200. That is intentional and
// the right thing to load-test here — it stresses the gate without creating thousands of real crawl
// jobs. See README.md for how to optionally exercise audit CREATION on staging.
//
// BASE_URL is required and has NO production default — the harness must never target a real host.
const errors = new Rate('errors');
const BASE = __ENV.BASE_URL; // staging Vercel preview URL — NEVER prod
const TURNSTILE = __ENV.TURNSTILE_TEST_TOKEN || ''; // Cloudflare test token for staging

// Guard at module load: refuse to run without an explicit staging BASE_URL.
if (!BASE) {
  throw new Error(
    'BASE_URL is required (staging target only). Run: k6 run -e BASE_URL=https://<staging-preview-url> -e TURNSTILE_TEST_TOKEN=<dummy-token> tests/load/audit-submit.js',
  );
}

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 200 },
        { duration: '3m', target: 1000 },
        { duration: '3m', target: 1000 },
        { duration: '2m', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    errors: ['rate<0.05'],
  },
};

export default function () {
  const res = http.post(`${BASE}/api/audits/start`,
    JSON.stringify({ url: `https://example-${__VU}-${__ITER}.test`, turnstileToken: TURNSTILE }),
    { headers: { 'Content-Type': 'application/json' } });
  // Accept <500 as expected (200 created, 400 invalid-url, 429 rate-limited/captcha, 503 ceiling); 5xx = failure.
  check(res, { 'not a server error': (r) => r.status < 500 });
  errors.add(res.status >= 500);
  sleep(Math.random() * 3 + 1); // realistic think-time 1–4s
}
