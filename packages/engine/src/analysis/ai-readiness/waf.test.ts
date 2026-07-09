import { describe, it, expect } from 'vitest';
import { detectWaf } from './waf.js';

describe('detectWaf (§3 — disclosure only, exact header names)', () => {
  it('detects Cloudflare by exact `server: cloudflare` (case-insensitive value)', () => {
    const w = detectWaf({ server: 'cloudflare' });
    expect(w.wafDetected).toBe(true);
    expect(w.wafNote).toMatch(/Cloudflare/);
    expect(w.wafNote).toMatch(/edge/i); // the honest override caveat
  });

  it('detects Cloudflare by the presence of cf-ray', () => {
    expect(detectWaf({ 'cf-ray': 'abc123-DFW' }).wafDetected).toBe(true);
  });

  it('detects Sucuri / Incapsula / Akamai by exact header names', () => {
    expect(detectWaf({ 'x-sucuri-id': '123' }).wafDetected).toBe(true);
    expect(detectWaf({ 'x-iinfo': '9-1-2' }).wafDetected).toBe(true);
    expect(detectWaf({ 'x-akamai-transformed': '9 0 0' }).wafDetected).toBe(true);
  });

  it('does NOT false-positive on a plain nginx/apache site', () => {
    const w = detectWaf({ server: 'nginx', 'content-type': 'text/html' });
    expect(w.wafDetected).toBe(false);
    expect(w.wafNote).toBeNull();
  });

  it('does NOT match on a substring (exact value for server; e.g. "cloudflare-nginx" is not "cloudflare")', () => {
    expect(detectWaf({ server: 'cloudflare-nginx' }).wafDetected).toBe(false);
  });

  it('is case-insensitive on header names', () => {
    expect(detectWaf({ 'CF-RAY': 'x' }).wafDetected).toBe(true);
    expect(detectWaf({ Server: 'Cloudflare' }).wafDetected).toBe(true);
  });
});
