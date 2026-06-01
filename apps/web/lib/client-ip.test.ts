import { describe, it, expect } from 'vitest';
import { getClientIp } from './client-ip';

function reqWith(headers: Record<string, string>): Request {
  return new Request('https://crawlmouse.com/api/x', { headers });
}

describe('getClientIp', () => {
  it('takes the left-most x-forwarded-for entry (the client peer on Vercel)', () => {
    expect(getClientIp(reqWith({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }))).toBe('1.2.3.4');
  });

  it('trims whitespace', () => {
    expect(getClientIp(reqWith({ 'x-forwarded-for': '  1.2.3.4 ' }))).toBe('1.2.3.4');
  });

  it('falls back to x-real-ip', () => {
    expect(getClientIp(reqWith({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9');
  });

  it('returns "unknown" when no IP header is present', () => {
    expect(getClientIp(reqWith({}))).toBe('unknown');
  });
});
