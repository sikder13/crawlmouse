import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// CC-40 D2: with the v2 flags off, everything D2 changes is byte-identical to what main served at
// `capturedFrom`. The fixture was captured on that commit, before any D2 change, by rendering each
// of these through the same calls as below; the root share card is compared as the sha256 of its PNG.
vi.mock('../fonts', () => ({
  fraunces: { variable: '' },
  geist: { variable: '' },
  geistMono: { variable: '' },
}));
vi.mock('../trpc/Provider', () => ({ TrpcProvider: () => null }));
vi.mock('../../components/consent/CookieConsent', () => ({ CookieConsent: () => null }));

const fixture = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'flags-off-v1.json'), 'utf8'),
);
const FLAGS = ['V2_ACCOUNT_DOOR', 'V2_PIPELINE', 'V2_CHECKS_PUBLIC', 'V2_BILLING'];

describe('flags off: what D2 changes is what main served', () => {
  beforeEach(() => {
    vi.resetModules();
    for (const f of FLAGS) vi.stubEnv(f, '');
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('the fixture is the capture from main 66c58828, with a deterministic image', () => {
    expect(fixture.capturedFrom).toBe('66c5882815652950f213bd2f5527fcb17eb46128');
    expect(fixture.ogImage.deterministic).toBe(true);
    expect(fixture.llmsTxt).toContain('honest A–F grade');
  });

  it('the root layout metadata', async () => {
    const { metadata } = await import('../../app/layout');
    expect(JSON.parse(JSON.stringify(metadata))).toEqual(fixture.layoutMetadata);
  });

  it('the root share card: alt, size, type and the PNG bytes', async () => {
    const og = await import('../../app/opengraph-image');
    expect({ alt: og.alt, size: og.size, contentType: og.contentType }).toEqual({
      alt: fixture.ogImage.alt,
      size: fixture.ogImage.size,
      contentType: fixture.ogImage.contentType,
    });
    const png = Buffer.from(await og.default().arrayBuffer());
    expect(createHash('sha256').update(png).digest('hex')).toBe(fixture.ogImage.pngSha256);
  });

  it('Organization, WebSite and SoftwareApplication structured data', async () => {
    const ld = await import('./jsonld');
    expect(ld.organizationLd()).toEqual(fixture.organizationLd);
    expect(ld.websiteLd()).toEqual(fixture.websiteLd);
    expect(ld.softwareApplicationLd()).toEqual(fixture.softwareApplicationLd);
  });

  it('/llms.txt, byte for byte', async () => {
    const { GET } = await import('../../app/llms.txt/route');
    expect(await GET().text()).toBe(fixture.llmsTxt);
  });
});
