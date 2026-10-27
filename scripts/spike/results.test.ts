import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allowList, buildResults, writeResults, isAllowedField } from './results.js';

describe('results allow-list', () => {
  it('keeps allow-listed scalars and drops everything else', () => {
    const out = allowList({
      host: 'example.com',
      ms: 12,
      verdict: 'allowed',
      authorization: 'Bearer nope',
      headers: { 'set-cookie': 'x' },
      body: '<html>',
      env: 'x',
      url: 'https://example.com/path?q=1',
      'u:GPTBot': 'served',
      'x:GPTBot': 'nope',
    });
    expect(out).toEqual({ host: 'example.com', ms: 12, verdict: 'allowed', 'u:GPTBot': 'served' });
  });

  it('drops a URL even under an allowed field name, and long or multi-line strings', () => {
    const out = allowList({ host: 'https://example.com/a?b=c', reason: 'x'.repeat(121), error: 'a\nb', outcome: 'ok' });
    expect(out).toEqual({ outcome: 'ok' });
  });

  it('drops objects and arrays under allowed names; non-finite numbers become null', () => {
    const out = allowList({ ms: [1], host: { a: 1 }, bytes: Number.NaN, count: Infinity, pass: true });
    expect(out).toEqual({ bytes: null, count: null, pass: true });
  });

  it('only accepts per-identity columns with the documented prefixes', () => {
    expect(isAllowedField('v:Claude-SearchBot')).toBe(true);
    expect(isAllowedField('token:GPTBot')).toBe(false);
    expect(isAllowedField('u:../../etc')).toBe(false);
  });

  it('writes one file per run, never overwriting, containing only allow-listed rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spike-results-'));
    const file = buildResults('throughput', new Date('2026-10-27T10:00:00Z'), new Date('2026-10-27T10:02:00Z'), [
      { host: 'example.com', reqPerSec: 2.01, secretish: 'not-an-allowed-field-value' },
    ]);
    const path = writeResults(dir, file);
    expect(readdirSync(dir)).toHaveLength(1);
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    expect(parsed.rows).toEqual([{ host: 'example.com', reqPerSec: 2.01 }]);
    expect(JSON.stringify(parsed)).not.toContain('secretish');
    expect(() => writeResults(dir, file)).toThrow(/EEXIST/);
  });
});
