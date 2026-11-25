import { describe, expect, it } from 'vitest';
import {
  deployHookPath,
  deployHookSecret,
  deployHookSignature,
  parseDeployHook,
  verifyDeployHook,
} from './deploy-hook';

const SECRET = 'a-test-secret-that-is-at-least-32-characters';
const SITE = '11111111-1111-4111-8111-111111111111';
const AT = '2026-11-24T01:02:03.456Z';

describe('a staging site’s deploy hook', () => {
  it('is an address of the site and a 32-character signature, which it verifies', () => {
    const path = deployHookPath(SITE, AT, SECRET);
    expect(path).toMatch(new RegExp(`^/api/hooks/deploy/${SITE}\\.[A-Za-z0-9_-]{32}$`));
    const parsed = parseDeployHook(path.split('/').at(-1)!)!;
    expect(parsed.siteId).toBe(SITE);
    expect(verifyDeployHook(parsed.signature, SITE, AT, SECRET)).toBe(true);
  });

  it('reads the same instant however the database spells it', () => {
    const sig = deployHookSignature(SITE, AT, SECRET);
    expect(deployHookSignature(SITE, '2026-11-24 01:02:03.456+00', SECRET)).toBe(sig);
    expect(deployHookSignature(SITE, '2026-11-23T20:02:03.456-05:00', SECRET)).toBe(sig);
  });

  it.each([
    ['another site', '22222222-2222-4222-8222-222222222222', AT, SECRET],
    ['the site added again', SITE, '2026-11-25T00:00:00.000Z', SECRET],
    ['another secret', SITE, AT, `${SECRET}-rotated`],
  ])('refuses the signature for %s', (_name, site, at, secret) => {
    const sig = deployHookSignature(SITE, AT, SECRET);
    expect(verifyDeployHook(sig, site, at, secret)).toBe(false);
  });

  it('refuses a signature of another length, without throwing', () => {
    const sig = deployHookSignature(SITE, AT, SECRET);
    expect(verifyDeployHook(sig.slice(0, 31), SITE, AT, SECRET)).toBe(false);
    expect(verifyDeployHook(`${sig}a`, SITE, AT, SECRET)).toBe(false);
  });

  it.each([
    'not-a-hook',
    `${SITE}`,
    `${SITE}.short`,
    // An id is lower-case hex: upper-case letters are not one.
    `ABCDEF00-1111-4111-8111-111111111111.${'a'.repeat(32)}`,
    `${SITE}.${'a'.repeat(32)}/more`,
    `../${SITE}.${'a'.repeat(32)}`,
  ])('reads %j as no hook', (param) => {
    expect(parseDeployHook(param)).toBeNull();
  });

  it('has no secret when it is unset, blank or short', () => {
    expect(deployHookSecret({})).toBeNull();
    expect(deployHookSecret({ DEPLOY_HOOK_SECRET: '   ' })).toBeNull();
    expect(deployHookSecret({ DEPLOY_HOOK_SECRET: 'short' })).toBeNull();
    expect(deployHookSecret({ DEPLOY_HOOK_SECRET: ` ${SECRET} ` })).toBe(SECRET);
  });
});
