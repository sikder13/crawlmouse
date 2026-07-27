import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { runAudit } from './audit.js';

// SPEC 05 — the AI_READINESS_EXTRACTION kill-switch must be COMPLETE.
//
// It was originally only gating the per-page extraction, while the two AI-readiness INPUT-GATHERING
// paths (the WAF header read and the ONE new llms.txt fetch) were gated on ENGINE_V2 alone. That made
// the switch a half-measure in exactly the situation it exists for: with the switch off, the score was
// silenced but the extra per-audit network request still fired in production, leaving `ENGINE_V2=0`
// — which moves every user's A–F grade — as the only lever if that egress ever destabilised a crawl.
//
// These tests pin the whole contract by observing the fixture server's REQUEST LOG, so they assert the
// absence of network traffic rather than the absence of a field.

let server: http.Server;
let baseUrl: string;
let requested: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = req.url ?? '/';
    requested.push(path);
    if (path === '/robots.txt') { res.statusCode = 404; res.end(''); return; }
    if (path === '/sitemap.xml') { res.statusCode = 404; res.end(''); return; }
    if (path === '/llms.txt') {
      res.setHeader('content-type', 'text/plain');
      res.end('# Example\n\n- [Docs](/docs)\n');
      return;
    }
    // A WAF-ish header so `detectWaf` has something to find when it is allowed to run.
    res.setHeader('server', 'cloudflare');
    res.setHeader('content-type', 'text/html');
    res.end('<html><head><title>Home</title></head><body><main><p>' + 'word '.repeat(120) + '</p><a href="/a">A</a></main></body></html>');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

const original = process.env.AI_READINESS_EXTRACTION;
beforeEach(() => { requested = []; });
afterEach(() => {
  if (original === undefined) delete process.env.AI_READINESS_EXTRACTION;
  else process.env.AI_READINESS_EXTRACTION = original;
});

const run = () =>
  runAudit({ url: baseUrl, pageCap: 10, perHostConcurrency: 1 }, { allowPrivateIpsForTesting: true, engineV2: true });

describe('AI_READINESS_EXTRACTION kill-switch completeness', () => {
  it('ON (default): fetches llms.txt and produces an AI-readiness score', async () => {
    delete process.env.AI_READINESS_EXTRACTION;
    const res = await run();
    expect(requested).toContain('/llms.txt');
    expect(res.aiReadiness).not.toBeNull();
    expect(res.aiReadiness).not.toBeUndefined();
  });

  it('OFF: makes NO llms.txt request at all — the switch stops the new network egress, not just the score', async () => {
    process.env.AI_READINESS_EXTRACTION = '0';
    const res = await run();
    expect(requested).not.toContain('/llms.txt');
    expect(res.aiReadiness ?? null).toBeNull();
  });

  it('OFF: still completes the crawl and grades the site (the abort path is safe)', async () => {
    process.env.AI_READINESS_EXTRACTION = '0';
    const res = await run();
    expect(res.grade).toBeTruthy();
    expect(res.pages.length).toBeGreaterThan(0);
  });

  it('OFF then ON yields the SAME A–F grade — the switch never moves the linking grade', async () => {
    process.env.AI_READINESS_EXTRACTION = '0';
    const off = await run();
    delete process.env.AI_READINESS_EXTRACTION;
    const on = await run();
    expect(off.grade).toBe(on.grade);
    expect(off.score).toBe(on.score);
  });
});
