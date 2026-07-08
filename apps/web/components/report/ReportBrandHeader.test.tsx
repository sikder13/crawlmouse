import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportBrandHeader } from './ReportBrandHeader';

// SPEC 04 §5 (V9) — the brand letterhead swaps Crawlmouse → the owner's brand on a claimed Pro report;
// everything else stays Crawlmouse-branded (the viral vector). Rendered inside `.report-print`, so it
// carries onto the printed PDF. brandName is owner-supplied → must render as inert (escaped) text.

describe('ReportBrandHeader', () => {
  const OLD = process.env.NEXT_PUBLIC_SUPABASE_URL;
  beforeEach(() => { process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'; });
  afterEach(() => { process.env.NEXT_PUBLIC_SUPABASE_URL = OLD; });

  it('shows the Crawlmouse wordmark by default (no white-label / free / unclaimed)', () => {
    expect(renderToStaticMarkup(<ReportBrandHeader whiteLabel={null} />)).toContain('Crawlmouse');
    expect(renderToStaticMarkup(<ReportBrandHeader />)).toContain('Crawlmouse');
  });

  it('swaps to the owner brand and DROPS the Crawlmouse wordmark when white-labeled (text-only)', () => {
    const html = renderToStaticMarkup(<ReportBrandHeader whiteLabel={{ brandName: 'Acme Agency', logoPath: null }} />);
    expect(html).toContain('Acme Agency');
    expect(html).not.toContain('Crawlmouse');
    expect(html).not.toContain('<img'); // no logo → no image element
  });

  it('renders the logo <img> (public CDN url + alt=brand) when a logoPath is set', () => {
    const html = renderToStaticMarkup(<ReportBrandHeader whiteLabel={{ brandName: 'Acme', logoPath: 'slug/abc.png' }} />);
    expect(html).toContain('<img');
    expect(html).toContain('src="https://proj.supabase.co/storage/v1/object/public/report-logos/slug/abc.png"');
    expect(html).toContain('alt="Acme"');
    expect(html).not.toContain('Crawlmouse');
  });

  it('escapes an attacker-supplied brand name as inert text (no markup injection)', () => {
    const html = renderToStaticMarkup(<ReportBrandHeader whiteLabel={{ brandName: '<img src=x onerror=pwn()>', logoPath: null }} />);
    expect(html).toContain('&lt;img'); // escaped, not a live element
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('dangerouslySetInnerHTML');
  });
});
