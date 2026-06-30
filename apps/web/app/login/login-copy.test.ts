import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

// The login surface is the signup value-moment (§6 onboarding): no signup is required to run an audit,
// so when we DO ask, the copy must name the payoff (save + track + monitor) and reassure new users
// that the same magic link creates the account and claims their anonymous audits (anon-claim-on-signup).
// A source guard (no render) pins that copy so it can't quietly regress to a bare "enter your email".
const src = readFileSync(resolve(__dirname, 'page.tsx'), 'utf8');

describe('login is a value-framed signup moment (U8)', () => {
  it('names the payoff for creating an account', () => {
    expect(/save every audit/i.test(src)).toBe(true);
    expect(/track your grade/i.test(src)).toBe(true);
    expect(/monitoring/i.test(src)).toBe(true);
  });

  it('communicates the no-upfront-signup anon-claim flow', () => {
    expect(/claims any audits/i.test(src)).toBe(true);
  });
});
