import http from 'k6/http';
import { check, sleep } from 'k6';

// Low-VU sanity check. Run BEFORE the full ramp to confirm the staging target is up and the two
// public, statically-rendered pages respond 200 within budget. This is cheap and safe; it does NOT
// create audits or hit any rate-limited endpoint.
//
// BASE_URL is required and has NO production default — the harness must never be able to fall back
// to a real host. Guard at module load so the script fails fast if BASE_URL is absent.
const BASE = __ENV.BASE_URL;
if (!BASE) {
  throw new Error(
    'BASE_URL is required (staging target only). Run: k6 run -e BASE_URL=https://<staging-preview-url> tests/load/smoke.js',
  );
}

export const options = {
  vus: 2,
  duration: '30s',
  thresholds: {
    // Static-page latency budget. Looser than a CDN-cached prod baseline because a Vercel preview
    // deploy can cold-start; still tight enough to catch a genuinely slow/broken target.
    http_req_duration: ['p(95)<800'],
    // Any non-200 on these public pages fails the run — no silent degradation.
    checks: ['rate>0.99'],
  },
};

export default function () {
  const home = http.get(`${BASE}/`);
  check(home, { 'GET / is 200': (r) => r.status === 200 });

  const status = http.get(`${BASE}/status`);
  check(status, { 'GET /status is 200': (r) => r.status === 200 });

  // Light think-time so 2 VUs don't hammer the target in a tight loop.
  sleep(1);
}
