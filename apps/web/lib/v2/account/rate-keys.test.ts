import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ipHash } from './rate-keys';

describe('ipHash', () => {
  it('is the sha256 of the address as written, lowercase hex', () => {
    // Computed outside the code under test: printf '%s' '<address>' | sha256sum
    expect(ipHash('203.0.113.9')).toBe(
      'd861b7e91033ebc1c1e8e7af3929010158b3241b54ca87ef73e79c32f26400ec',
    );
    expect(ipHash('2001:db8::1')).toBe(
      '5afd19e856d1c18d17d600dfd2b5f534992333985e126c2a951047102c1ed536',
    );
  });
});

describe('the account flows hash an address in one place', () => {
  it('no module in lib/v2/account but rate-keys.ts and tokens.ts (link tokens) calls createHash', () => {
    const dir = __dirname;
    const callers = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .filter((f) => /\bcreateHash\(/.test(readFileSync(join(dir, f), 'utf8')));
    expect(callers.sort()).toEqual(['rate-keys.ts', 'tokens.ts']);
  });
});
