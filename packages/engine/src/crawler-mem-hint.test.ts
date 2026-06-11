import { describe, it, expect, afterEach } from 'vitest';
import { ensureCrawleeMemoryHint } from './crawler.js';

// Regression lock for the Crawlee `spawn ps ENOENT` fix (proven live: audits failed in the Vercel
// serverless runtime until this ran). Crawlee's autoscaler spawns `ps` to read memory UNLESS it
// detects AWS Lambda via AWS_LAMBDA_FUNCTION_MEMORY_SIZE; `ps` is absent on Vercel. runCrawl() calls
// ensureCrawleeMemoryHint() in-stack before the crawl so Crawlee takes its ps-free memory path.
//
// NOTE: in a plain Node runtime `process.env` IS `globalThis.process.env` (same object), so a unit
// test cannot distinguish the two writes — the load-bearing `globalThis.process.env` write only
// diverges inside the Next webpack bundle (a bundle-local `process.env` shim), which vitest can't
// reproduce. The true regression guard for that is the live Vercel crawl smoke. These tests lock
// the observable contract: the var is set on Linux, skipped off Linux, and never overrides a host.
describe('ensureCrawleeMemoryHint (Crawlee ps-ENOENT workaround)', () => {
  const original = process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE;
  afterEach(() => {
    if (original === undefined) delete process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE;
    else process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE = original;
  });

  it('sets AWS_LAMBDA_FUNCTION_MEMORY_SIZE on Linux when unset (so Crawlee skips the `ps` spawn)', () => {
    delete process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE;
    ensureCrawleeMemoryHint('linux');
    expect(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE).toBe('3008');
  });

  it('does NOTHING off Linux (macOS/Windows keep Crawlee’s own working `ps`/detection path)', () => {
    delete process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE;
    ensureCrawleeMemoryHint('darwin');
    expect(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE).toBeUndefined();
    ensureCrawleeMemoryHint('win32');
    expect(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE).toBeUndefined();
  });

  it('never overrides a value the host already set (e.g. real AWS Lambda)', () => {
    process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE = '1769';
    ensureCrawleeMemoryHint('linux');
    expect(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE).toBe('1769');
  });
});
