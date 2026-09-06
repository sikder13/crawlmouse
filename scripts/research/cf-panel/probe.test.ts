import { describe, it, expect } from 'vitest';
import { evidenceChanged, groupFor, isCloudflare, isPlausibleAdsTxt } from './probe.js';

describe('Cloudflare signal', () => {
  it('accepts either public signal, and is case-insensitive on the server value', () => {
    expect(isCloudflare(null, true)).toBe(true);
    expect(isCloudflare('cloudflare', false)).toBe(true);
    expect(isCloudflare('Cloudflare', false)).toBe(true);
    expect(isCloudflare('nginx', false)).toBe(false);
    expect(isCloudflare(null, false)).toBe(false);
  });

  // High precision matters: a false positive puts a non-Cloudflare site in a Cloudflare stratum.
  it('does not match a server header that merely contains the word', () => {
    expect(isCloudflare('cloudflare-nginx', false)).toBe(false);
  });
});

describe('ads.txt plausibility', () => {
  it('accepts a real IAB record line', () => {
    expect(isPlausibleAdsTxt('google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0\n')).toBe(true);
  });

  it('accepts a file whose first lines are comments', () => {
    expect(isPlausibleAdsTxt('# our sellers\n\nrubiconproject.com, 12345, RESELLER\n')).toBe(true);
  });

  // The soft-404 guard. A great many sites answer /ads.txt with 200 and an HTML error page.
  it('rejects an HTML soft 404', () => {
    expect(isPlausibleAdsTxt('<!DOCTYPE html><html><body>Not found</body></html>')).toBe(false);
    expect(isPlausibleAdsTxt('\n\n  <html>...')).toBe(false);
  });

  /**
   * The case that makes the markup check load-bearing rather than decorative. Plain HTML is already
   * rejected by the record-shape check, because no line has three comma-separated fields — so the two
   * assertions above pass with the markup check DELETED, which is a test agreeing with the code for
   * the wrong reason. This page carries a line that would parse as a record, and only the leading `<`
   * rejects it.
   */
  it('rejects an HTML page whose body happens to contain a record-shaped line', () => {
    const page = '<!DOCTYPE html>\n<html><body><p>Try:</p>\ngoogle.com, pub-0000000000000000, DIRECT\n</body></html>';
    expect(isPlausibleAdsTxt(page)).toBe(false);
  });

  it('rejects prose, an empty file, and a line too short to be a record', () => {
    expect(isPlausibleAdsTxt('')).toBe(false);
    expect(isPlausibleAdsTxt('this page has moved\n')).toBe(false);
    expect(isPlausibleAdsTxt('google.com, pub-123\n')).toBe(false);
  });

  it('rejects a record whose first field is not a domain', () => {
    expect(isPlausibleAdsTxt('CONTACT, someone@example.com, DIRECT\n')).toBe(false);
  });
});

describe('stratum assignment', () => {
  it('maps the four signal combinations, leaving the neither-case unassigned', () => {
    expect(groupFor(true, true)).toBe('cf_ads');
    expect(groupFor(true, false)).toBe('cf_no_ads');
    expect(groupFor(false, true)).toBe('ads_no_cf');
    expect(groupFor(false, false)).toBeNull();
  });
});

describe('group re-verification compares like with like', () => {
  const built = { server: 'cloudflare', cfRay: true, adsTxtStatus: 200 };

  it('is quiet when nothing moved', () => {
    expect(evidenceChanged(built, { server: 'cloudflare', cfRay: true, adsTxtStatus: 200 })).toBe(false);
  });

  it('fires when the site stops being Cloudflare-fronted', () => {
    expect(evidenceChanged(built, { server: 'nginx', cfRay: false, adsTxtStatus: 200 })).toBe(true);
  });

  it('fires when /ads.txt stops answering 200', () => {
    expect(evidenceChanged(built, { server: 'cloudflare', cfRay: true, adsTxtStatus: 404 })).toBe(true);
  });

  /**
   * THE BUG THIS REPLACED, pinned so it cannot come back. The panel stores `adsTxtValid` — 200 AND a
   * body that parses. A snapshot never re-reads the body, so it only knows the status. Comparing the
   * snapshot's "200?" against the build's "200 and parses?" flags every site that answers /ads.txt
   * with an HTML error page, on every run. Here the build saw 200-but-invalid and the snapshot sees
   * 200: the status did not move, so nothing is reported.
   */
  it('does not fire for a site whose ads.txt was a 200 soft-404 at build time', () => {
    const softFourOhFour = { server: 'cloudflare', cfRay: true, adsTxtStatus: 200 };
    expect(evidenceChanged(softFourOhFour, { server: 'cloudflare', cfRay: true, adsTxtStatus: 200 })).toBe(false);
  });

  it('treats an unreachable ads.txt at snapshot time as a change from a 200', () => {
    expect(evidenceChanged(built, { server: 'cloudflare', cfRay: true, adsTxtStatus: null })).toBe(true);
  });
});
