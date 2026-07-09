import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActivityFeed } from './ActivityFeed';
import type { CrawlActivityEvent } from '@crawlmouse/types';

// SPEC 04 §2 — V2 (SECURITY): every feed line is attacker-controlled crawled content (URL paths,
// titles). It must render as inert text — never as markup — and the feed must be an honest,
// bounded projection of the REAL events it is given (no synthetic lines).

const ev = (seq: number, extra: Partial<CrawlActivityEvent> = {}): CrawlActivityEvent => ({
  kind: 'fetch_ok',
  label: `/page-${seq}`,
  at: '2026-07-07T00:00:00.000Z',
  seq,
  ...extra,
});

// SPEC 04.2 FIX 3a — fetch_* labels are percent-encoded crawled paths (activityPath, worker-side). The
// feed must DECODE them for display (never mutating the stored/emitted label). A Bengali path is the
// canonical fixture: it stays percent-encoded end-to-end unless we decode, so a raw render leaks "%e0…".
const BENGALI_ENC = '/%e0%a6%ac%e0%a7%8d%e0%a6%b2%e0%a6%97'; // "/ব্লগ" (blog) percent-encoded
const BENGALI_DEC = decodeURIComponent(BENGALI_ENC);

describe('ActivityFeed', () => {
  it('renders a hostile crawled label as ESCAPED TEXT, never live markup (V2 — XSS)', () => {
    const hostile = '<img src=x onerror="pwn()"><script>pwn()</script>';
    const html = renderToStaticMarkup(<ActivityFeed events={[ev(1, { label: hostile })]} />);
    // React text nodes escape the payload…
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;script&gt;');
    // …and no raw tag from the payload survives into the markup.
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    // Defense-in-depth: the component never uses raw-HTML injection at all.
    expect(html).not.toContain('dangerouslySetInnerHTML');
  });

  it('shows the honest waiting line when there are no events yet — never fake activity', () => {
    const html = renderToStaticMarkup(<ActivityFeed events={[]} />);
    expect(html).toMatch(/waiting for the first pages/i);
  });

  it('renders the events it is given inside a polite live region, marking blocked fetches', () => {
    const html = renderToStaticMarkup(
      <ActivityFeed events={[ev(1), ev(2, { kind: 'fetch_blocked', label: '/rate-limited' })]} />,
    );
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('/page-1');
    expect(html).toContain('/rate-limited');
  });

  it('shows only the most recent events beyond its display cap (oldest trimmed)', () => {
    const events = Array.from({ length: 40 }, (_, i) => ev(i + 1));
    const html = renderToStaticMarkup(<ActivityFeed events={events} />);
    expect(html).not.toContain('/page-1<'); // oldest trimmed (exact text-node match)
    expect(html).toContain('/page-40'); // newest visible
  });

  it('decodes a percent-encoded crawled path for DISPLAY — no raw %XX leaks (FIX 3a)', () => {
    const html = renderToStaticMarkup(<ActivityFeed events={[ev(1, { label: BENGALI_ENC })]} />);
    expect(html).toContain(BENGALI_DEC); // human sees the real path…
    expect(html).not.toMatch(/%e0%a6/i); // …not the raw percent-encoding
  });

  it('leaves a prose label with a bare % unchanged — never corrupts non-URL prose (FIX 3a)', () => {
    const html = renderToStaticMarkup(
      <ActivityFeed events={[ev(2, { kind: 'cms_detected', label: 'Platform detected: 50% WordPress' })]} />,
    );
    expect(html).toContain('Platform detected: 50% WordPress');
  });
});
