import { describe, it, expect, afterEach } from 'vitest';
import { whiteLabelBrandName, logoPublicUrl, LOGO_BUCKET } from './report-brand';

// SPEC 04 §5 — the pure branding decision shared by the report page, print/PDF, and OG card: a claimed
// Pro report shows the owner's brand; everything else shows Crawlmouse (null = Crawlmouse-branded).

describe('whiteLabelBrandName', () => {
  it('returns the brand name when white-label is set', () => {
    expect(whiteLabelBrandName({ brandName: 'Acme Agency', logoPath: null })).toBe('Acme Agency');
  });
  it('returns null when white-label is null/undefined (the Crawlmouse-branded default)', () => {
    expect(whiteLabelBrandName(null)).toBeNull();
    expect(whiteLabelBrandName(undefined)).toBeNull();
  });
  it('trims, and treats a blank brand name as no brand', () => {
    expect(whiteLabelBrandName({ brandName: '  Acme  ', logoPath: null })).toBe('Acme');
    expect(whiteLabelBrandName({ brandName: '   ', logoPath: null })).toBeNull();
  });
});

describe('logoPublicUrl', () => {
  const OLD = process.env.NEXT_PUBLIC_SUPABASE_URL;
  afterEach(() => { process.env.NEXT_PUBLIC_SUPABASE_URL = OLD; });

  it('builds the public CDN URL for a stored logo path', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
    expect(logoPublicUrl('slug/abc.png')).toBe(`https://proj.supabase.co/storage/v1/object/public/${LOGO_BUCKET}/slug/abc.png`);
  });
  it('tolerates a trailing slash on the base URL', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co/';
    expect(logoPublicUrl('slug/abc.png')).toBe(`https://proj.supabase.co/storage/v1/object/public/${LOGO_BUCKET}/slug/abc.png`);
  });
  it('returns null for no path, and when the base URL is unset', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
    expect(logoPublicUrl(null)).toBeNull();
    expect(logoPublicUrl(undefined)).toBeNull();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(logoPublicUrl('slug/abc.png')).toBeNull();
  });
});
