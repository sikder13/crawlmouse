import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guard for the k6 load-test harness under <repo>/tests/load/. This test is the deterministic
// substitute for actually executing k6 (k6 is not installed in CI, and the full ~1000-VU ramp is
// staging-deferred). It enforces the non-negotiable safety + contract invariants of the harness so
// that a regression — hardcoding a prod host, dropping the BASE_URL fail-fast guard, deleting or
// neutering a threshold, neutering the 5xx failure feed, or removing the staging-only warning —
// fails LOUDLY here instead of slipping through.
//
// __dirname is apps/web/__tests__. The harness lives at the repo root:
//   apps/web/__tests__  -> ..(apps/web) -> ..(apps) -> ..(repo root) -> tests/load/<file>
// readFileSync (not existsSync) closes the TOCTOU window and throws ENOENT on a missing/renamed
// file, so an accidental delete fails the test rather than silently skipping it.
const LOAD_DIR = resolve(__dirname, '../../..', 'tests/load');

function readLoadFile(name: string): string {
  const source = readFileSync(resolve(LOAD_DIR, name), 'utf8');
  expect(source.trim().length, `${name} is empty or whitespace-only`).toBeGreaterThan(0);
  return source;
}

// Strip JS comments (line `//...` and block `/* ... */`) so that assertions about EXECUTABLE
// behavior (the actual check predicate, the errors.add feed, the throw) cannot be satisfied by a
// matching string that lives only in a comment. A regression that weakens the real expression while
// leaving a reassuring comment behind must still fail the guard.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // line comments (avoid eating `://` in URLs)
}

// A literal production host must never appear in any harness file. The harness load-tests staging
// only; "crawlmouse.com" leaking into a script or default would be a production-fire hazard.
const PROD_HOST = 'crawlmouse.com';

// Reject any hardcoded http(s):// host that is a real, routable base host. Two narrowly-scoped forms
// are allowed:
//   1. the EXACT synthetic per-iteration target template `https://example-${__VU}-${__ITER}.test`
//      (a non-routable RFC-6761 `.test` URL templated per VU/iteration — not a base host). We
//      require the `https://example-` prefix, both `${__VU}` and `${__ITER}`, AND a `.test` TLD on
//      the HOST segment so that (a) a routable host smuggled in via a lone `${__VU}` (e.g.
//      `https://evil.example.org/${__VU}`) and (b) a routable host that merely begins with
//      `example-` (e.g. `https://example-evil.attacker.com/${__VU}/${__ITER}`) are BOTH rejected —
//      only a genuinely non-routable `.test` host is exempted.
//   2. an angle-bracket documentation placeholder like `https://<staging-preview-url>` that appears
//      in usage hints / guard error messages. We require the ENTIRE host segment (everything up to
//      the first / ? # after the scheme) to be a single fully-bracketed `<...>` token with NOTHING
//      after the closing `>`, so a real label outside the brackets (e.g. `https://<evil>.example.org`
//      or `https://staging<x>.example.org`) is NOT exempted.
// Anything else hardcoded — a concrete routable host used as a base/default — is forbidden; BASE
// must derive from __ENV. A real host such as `https://staging.example.app` would still fail here.
function assertNoHardcodedBaseHost(name: string, source: string): void {
  const urlMatches = source.match(/https?:\/\/[^\s'"`)]+/g) ?? [];
  for (const url of urlMatches) {
    // Host segment = scheme-less remainder up to the first path/query/fragment delimiter.
    const hostSegment = url.replace(/^https?:\/\//, '').split(/[/?#]/, 1)[0] ?? '';
    // Synthetic target: `example-` prefix + both interpolation tokens + a non-routable `.test` host.
    // The `.test` check is on the HOST segment, so `https://example-evil.attacker.com/...` (host
    // ends in `.com`) is NOT a synthetic target even though it begins with `example-`.
    const isSyntheticTarget =
      url.startsWith('https://example-') &&
      url.includes('${__VU}') &&
      url.includes('${__ITER}') &&
      /\.test$/.test(hostSegment);
    // Fully-bracketed placeholder only: `<...>` and nothing else in the host (no real label).
    const isAngleBracketPlaceholder = /^<[^<>]*>$/.test(hostSegment);
    expect(
      isSyntheticTarget || isAngleBracketPlaceholder,
      `${name} contains a hardcoded host "${url}"; BASE must derive from __ENV.BASE_URL`,
    ).toBe(true);
  }
}

describe('load-test harness: BASE_URL is __ENV-driven, fail-fast, and never production', () => {
  for (const name of ['smoke.js', 'audit-submit.js']) {
    it(`${name} reads __ENV.BASE_URL, refuses to run when empty, has no prod/hardcoded host`, () => {
      const source = readLoadFile(name);
      expect(source, `${name} must read __ENV.BASE_URL`).toContain('__ENV.BASE_URL');
      expect(
        source.includes(PROD_HOST),
        `${name} must NOT reference the production host "${PROD_HOST}"`,
      ).toBe(false);
      assertNoHardcodedBaseHost(name, source);

      const code = stripComments(source);

      // BASE must derive PURELY from __ENV.BASE_URL with no fallback default. A fallback like
      //   const BASE = __ENV.BASE_URL || 'evil.example.org';   (schemeless — slips past the
      //   http(s):// host scan above) or `__ENV.BASE_URL ?? '...'` would reintroduce a non-staging
      // target. Reject any `||` / `??` immediately following the __ENV.BASE_URL read. (The synthetic
      // per-iteration URL and the TURNSTILE token may legitimately use `||`, so scope this to the
      // BASE read specifically.)
      expect(
        code,
        `${name} must NOT give __ENV.BASE_URL a fallback default (no \`|| ...\` / \`?? ...\`); ` +
          'BASE must be exactly __ENV.BASE_URL so an unset value fails fast',
      ).not.toMatch(/__ENV\.BASE_URL\s*(\|\||\?\?)/);

      // Fail-fast invariant: the script must REFUSE to run with an empty BASE. Dropping this throw
      // would let k6 issue requests against `undefined/...`, defeating the stated safety contract.
      // Assert against comment-stripped source so a `// if (!BASE) throw` comment can't satisfy it.
      expect(code, `${name} must guard on a missing BASE (if (!BASE) { ... })`).toMatch(
        /if\s*\(\s*!BASE\s*\)/,
      );
      expect(code, `${name} must throw when BASE is missing`).toContain('throw new Error');
    });
  }
});

describe('load-test harness: audit-submit.js ramp contract', () => {
  it('pins thresholds, the 5xx-fed errors Rate, the <500 check, think-time, and the endpoint', () => {
    const source = readLoadFile('audit-submit.js');
    const code = stripComments(source);

    // --- thresholds: the keys must exist AND their BOUNDS must be meaningful (never-trip = fail) ---
    expect(source, 'missing thresholds block').toContain('thresholds');
    // p95 latency budget — pin the FULL array element including the closing quote, NOT a bare
    // `p(95)<2000` substring. A 10x silent relaxation to `p(95)<20000` CONTAINS `p(95)<2000`, so a
    // bare .toContain would let it slip through; anchoring on `['p(95)<2000']` catches it (and any
    // never-trip value like p(95)<999999).
    expect(source, 'audit-submit must pin the http_req_duration p(95)<2000 budget').toContain(
      "http_req_duration: ['p(95)<2000']",
    );
    // Error-rate budget literal. rate<1 / rate<1.0 can never trip, so pin the exact 5% bound.
    expect(source, "audit-submit must pin the errors: ['rate<0.05'] budget").toContain(
      "errors: ['rate<0.05']",
    );

    // --- ramp shape: the peak must stay at 1000 VUs (no silent cap) ---
    // The README documents a ~1000-VU run; pinning the peak means a silent reduction (e.g.
    // target: 100) FAILS the guard instead of quietly under-testing while the docs still say 1000.
    expect(source, 'audit-submit ramp must peak at target: 1000 VUs (no silent cap)').toContain(
      'target: 1000',
    );

    // --- errors Rate: must EXIST and be FED the 5xx predicate (not a constant / not >=600) ---
    expect(source, "missing errors Rate metric (new Rate('errors'))").toContain("new Rate('errors')");
    // Lock the wiring: errors.add(res.status >= 500). Neutering it to errors.add(false),
    // errors.add(true), errors.add(res.status >= 600), or deleting it must fail the guard.
    expect(code, 'errors Rate must be fed by the 5xx predicate: errors.add(res.status >= 500)').toMatch(
      /errors\.add\(\s*res\.status\s*>=\s*500\s*\)/,
    );

    // --- the <500 check: bind to the EXECUTABLE predicate INSIDE the check() call ---
    expect(code, 'missing a check(...) call').toContain('check(');
    // The check must treat 5xx as the only failure (200/400/429/503 are expected under load). We
    // bind `r.status < 500` to the check() call itself — not just "somewhere in the file" — so a
    // mutation that neuters the live predicate to a tautology while parking the real one in dead
    // code (e.g. `check(res, { ok: (r) => true }); const _ = (r) => r.status < 500;`) FAILS here.
    // `[\s\S]*?` spans the (single, formatted-on-its-own-lines) check() argument list lazily up to
    // the predicate; the predicate must live inside the check(...) invocation.
    expect(code, 'the r.status < 500 pass condition must live INSIDE the check(...) call').toMatch(
      /check\([\s\S]*?r\.status\s*<\s*500/,
    );
    // And no tautological predicate (`=> true` / `=> 1`) may be passed to check(): such a value
    // would make the check always pass regardless of status, defeating the 5xx gate.
    expect(code, 'check() must not be handed a tautological `=> true` / `=> 1` predicate').not.toMatch(
      /check\([\s\S]*?=>\s*(true|1)\b/,
    );

    expect(code, 'missing a sleep() think-time').toMatch(/sleep\(/);

    // --- real route contract: POST /api/audits/start with a JSON body incl. turnstileToken ---
    // Bind the endpoint to the EXECUTABLE http.post call in comment-stripped code, not the raw
    // source: `/api/audits/start` also appears in a header comment, so asserting against `source`
    // would let a mutation point the live call at the wrong path (e.g. `/api/other`) while leaving
    // the comment intact. A wrong endpoint would silently load-test the wrong route (404 < 500, so
    // the errors Rate would not trip) — a false-green at deploy. `[^)]*` keeps the match within the
    // http.post(...) URL argument.
    expect(code, 'the EXECUTABLE call must POST to /api/audits/start (http.post)').toMatch(
      /http\.post\([^)]*\/api\/audits\/start/,
    );
    expect(code, 'must send a turnstileToken field').toContain('turnstileToken');
    // The ramp must read the always-pass Turnstile token from the environment, never hardcode it.
    expect(source, 'must read TURNSTILE_TEST_TOKEN from __ENV').toContain('__ENV.TURNSTILE_TEST_TOKEN');
  });
});

describe('load-test harness: smoke.js sanity contract', () => {
  it('hits / and /status, asserts 200 on BOTH, and pins p(95)<800 + checks rate>0.99', () => {
    const source = readLoadFile('smoke.js');
    const code = stripComments(source);

    // Hits the home page and the static status page. Bind both to the EXECUTABLE http.get calls in
    // comment-stripped code (not raw source) so a mutation that points a live GET at the wrong path
    // while leaving a reassuring comment behind still fails the guard.
    expect(code, 'smoke must GET the static /status page (http.get)').toMatch(
      /http\.get\([^)]*\/status/,
    );
    expect(code, 'smoke must GET the home page `${BASE}/` (http.get)').toMatch(
      /http\.get\([^)]*\$\{BASE\}\/`/,
    );

    // Both GETs must assert a 200 success. Requiring two occurrences means neutering EITHER check
    // (e.g. the GET / check to `(r) => true`) fails the guard — one surviving `=== 200` is not
    // enough. Match against comment-stripped code so a `// === 200` comment can't pad the count.
    const twoHundredChecks = code.match(/===\s*200/g) ?? [];
    expect(
      twoHundredChecks.length,
      'smoke must assert status === 200 on BOTH / and /status (two executable checks)',
    ).toBeGreaterThanOrEqual(2);

    // p95 latency budget for static pages — pin the FULL array element including the closing quote,
    // NOT a bare `p(95)<800`. A 10x relaxation to `p(95)<8000` CONTAINS `p(95)<800` and would slip
    // through a bare .toContain; anchoring on `['p(95)<800']` catches it (and any never-trip value).
    expect(source, 'smoke must pin the http_req_duration p(95)<800 budget').toContain(
      "http_req_duration: ['p(95)<800']",
    );
    // Check-pass-rate budget: any non-200 on these public pages fails the run. rate>0.99 must be
    // pinned so loosening it to e.g. rate>0 (never trips) fails the guard.
    expect(source, "smoke must pin the checks: ['rate>0.99'] budget").toContain("checks: ['rate>0.99']");

    // A think-time keeps the 2 VUs from hammering the target in a tight loop; assert it is present
    // (bind to comment-stripped code so a `// sleep(...)` comment can't satisfy it).
    expect(code, 'smoke must include a sleep() think-time').toMatch(/sleep\(/);
  });
});

describe('load-test harness: README documents the staging-only, deferred ~1000-VU run', () => {
  it('contains a never-prod staging warning, the 1000-VU figure, a deferral, and an evidence/ pointer', () => {
    const source = readLoadFile('README.md');
    const lower = source.toLowerCase();
    expect(lower, 'README must mention staging').toContain('staging');
    // Loud never-production warning. Either phrasing satisfies the guard.
    expect(
      lower.includes('never run against production') || lower.includes('never run against prod'),
      'README must LOUDLY warn never to run against production',
    ).toBe(true);
    // The full ramp peaks at 1000 VUs and is explicitly deferred to deploy-time staging.
    expect(source, 'README must state the 1000-VU peak').toContain('1000');
    expect(lower, 'README must state the ~1000-VU run is deferred').toContain('deferred');
    // Run output lands in evidence/ at deploy.
    expect(source, 'README must point run output at evidence/').toContain('evidence/');
  });
});
