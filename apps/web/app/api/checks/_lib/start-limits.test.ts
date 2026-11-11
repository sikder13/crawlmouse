import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The same source pin v1's start route has (__tests__/spec04-v17-stress.test.ts): the day's ceiling
// is counted under v1's key with `failClosed` on that call. start.test.ts runs the limiter against a
// database; this reads the call itself, which a test that fakes the limiter does not run.
const read = (file: string) => readFileSync(join(__dirname, file), 'utf8');

describe('the public start’s day ceiling', () => {
  it('is v1’s bucket, and closed when it cannot be counted', () => {
    const pin = /checkRateLimit\(\s*['"]global:audits:day['"][^)]*\{\s*failClosed:\s*true,?\s*\}/;
    expect(read('start-limits.ts')).toMatch(pin);
    expect(read('../../audits/start/route.ts')).toMatch(pin);
  });

  it('is the limiter production runs the start on', () => {
    expect(read('start-deps.ts')).toMatch(/limits:\s*startLimits\b/);
  });
});
