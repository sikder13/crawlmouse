import { describe, it, expect } from 'vitest';
import { turnstileEnabled } from './turnstile-client';

describe('turnstileEnabled', () => {
  it('is disabled when the site key is undefined', () => {
    expect(turnstileEnabled(undefined)).toBe(false);
  });

  it('is disabled when the site key is an empty string', () => {
    expect(turnstileEnabled('')).toBe(false);
  });

  it('is enabled when a real site key is present', () => {
    expect(turnstileEnabled('0x4AAAAAAABkMYinukE8nzYS')).toBe(true);
  });
});
