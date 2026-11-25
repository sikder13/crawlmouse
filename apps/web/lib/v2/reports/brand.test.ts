import { createHash } from 'node:crypto';
import { PDFDict, PDFDocument, PDFName, PDFPage } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { MAX_LOGO_BYTES } from '../../logo-validation';
import { fixture } from '../fixtures';
import { checkedLogo, ownLogoFormat, type BrandLogo } from './brand-doc';
import { logoSrcOf, supabaseBrandReader } from './brand';
import { docStrings, type ReportDoc } from './generate';
import { auditDoc, compareDoc } from './generate-doc';
import { measureWith, openPdf, renderPdf } from './pdf';
import { drawDoc, LOGO_BOX, logoSize } from './pdf-layout';
import { expectDrawsTheDocument, recorder } from './pdf-test-support';

// Goal 1 row 24, white-label's readers: the brand's rules, its service-role reader, and the PDF.

const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const B = 'bbbbbbbb-2222-4222-8222-222222222222';
const PATH = `agency/${A}/0123456789abcdef.png`;
const HOME = 'https://crawlmouse.com/';
const BAD = fixture('bad-site');
const AUDIT = auditDoc(
  { dataset: BAD, checkId: 'c0000000-0000-4000-8000-000000000001' },
  { home: HOME },
);
const COMPARE = compareDoc(
  { dataset: BAD, checkId: 'c0000000-0000-4000-8000-000000000005' },
  { dataset: BAD, checkId: 'c0000000-0000-4000-8000-000000000006' },
  { home: HOME },
);
/** A real 1×1 PNG, which pdf-lib embeds and `validateLogo` accepts. */
const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ),
);
const LOGO: BrandLogo = { bytes: PNG, format: 'png' };
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('a stored logo path is read only when it is the account’s own', () => {
  it('names the format of a path in the upload route’s shape under the account’s folder', () => {
    expect(ownLogoFormat(A, PATH)).toBe('png');
    expect(ownLogoFormat(A, `agency/${A}/0123456789abcdef.jpg`)).toBe('jpeg');
    expect(ownLogoFormat(A, `agency/${A}/0123456789abcdef.webp`)).toBe('webp');
  });

  it('refuses another account’s folder, and every other shape', () => {
    for (const p of [
      `agency/${B}/0123456789abcdef.png`,
      `agency/${A}/../${B}/0123456789abcdef.png`,
      `agency/${A}/0123456789ABCDEF.png`,
      `agency/${A}/0123456789abcdef.svg`,
      `agency/${A}/0123456789abcdef.png.png`,
      `agency/${A}/sub/0123456789abcdef.png`,
      `/agency/${A}/0123456789abcdef.png`,
      `https://evil.example/agency/${A}/0123456789abcdef.png`,
      `${A}/0123456789abcdef.png`,
      '',
    ]) {
      expect(ownLogoFormat(A, p), p).toBeNull();
    }
    expect(ownLogoFormat('not-an-id', PATH)).toBeNull();
  });

  it('checks the bytes again: within the bound, a logo, and the format the path names', () => {
    expect(checkedLogo(PNG, 'png')).toEqual({ bytes: PNG, format: 'png' });
    expect(checkedLogo(PNG, 'jpeg')).toBeNull();
    expect(checkedLogo(new Uint8Array(0), 'png')).toBeNull();
    expect(checkedLogo(new TextEncoder().encode('<svg onload="x()"/>'), 'png')).toBeNull();
    const big = new Uint8Array(MAX_LOGO_BYTES + 1);
    big.set(PNG);
    expect(checkedLogo(big, 'png')).toBeNull();
  });
});

/** A service-role client in memory: one brand row, one account row, a bucket, and a download log. */
function fakeAdmin(opts: {
  brand?: { agency_name: string; logo_path: string | null } | null;
  tier?: 'free' | 'pro' | 'agency';
  objects?: Record<string, Uint8Array>;
}) {
  const downloads: string[] = [];
  const answer = (data: unknown) => ({
    eq: () => ({ maybeSingle: async () => ({ data, error: null }) }),
  });
  const admin = {
    from: (table: string) => ({
      select: () =>
        table === 'agency_brands'
          ? answer(opts.brand ?? null)
          : answer({ state: 'active', tier: opts.tier ?? 'agency' }),
    }),
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          downloads.push(`${bucket}/${path}`);
          const bytes = opts.objects?.[path];
          return bytes === undefined
            ? { data: null, error: { message: 'not found' } }
            : { data: new Blob([new Uint8Array(bytes)]), error: null };
        },
      }),
    },
  };
  return { admin: admin as never, downloads };
}

describe('supabaseBrandReader', () => {
  it('answers the brand of an Agency account with a brand row', async () => {
    const { admin } = fakeAdmin({ brand: { agency_name: 'Northwind', logo_path: PATH } });
    expect(await supabaseBrandReader(admin, undefined, {}).brandFor(A)).toEqual({
      name: 'Northwind',
      logoPath: PATH,
    });
  });

  it('answers none with agency_white_label hidden, off Agency, or with no brand row', async () => {
    const brand = { agency_name: 'Northwind', logo_path: PATH };
    expect(
      await supabaseBrandReader(fakeAdmin({ brand }).admin, undefined, {
        V2_HIDE_FEATURES: 'agency_white_label',
      }).brandFor(A),
    ).toBeNull();
    for (const tier of ['free', 'pro'] as const) {
      expect(
        await supabaseBrandReader(fakeAdmin({ brand, tier }).admin, undefined, {}).brandFor(A),
      ).toBeNull();
    }
    expect(
      await supabaseBrandReader(fakeAdmin({ brand: null }).admin, undefined, {}).brandFor(A),
    ).toBeNull();
  });

  it('drops a stored logo path that is not the account’s own, keeping the name', async () => {
    const { admin } = fakeAdmin({
      brand: { agency_name: 'Northwind', logo_path: `agency/${B}/0123456789abcdef.png` },
    });
    expect(await supabaseBrandReader(admin, undefined, {}).brandFor(A)).toEqual({
      name: 'Northwind',
      logoPath: null,
    });
  });

  it('reads the logo from report-logos by its path, and never another account’s', async () => {
    const other = `agency/${B}/0123456789abcdef.png`;
    const { admin, downloads } = fakeAdmin({ objects: { [PATH]: PNG, [other]: PNG } });
    const reader = supabaseBrandReader(admin, undefined, {});
    expect(await reader.logo(A, PATH)).toEqual(LOGO);
    expect(await reader.logo(A, other)).toBeNull();
    expect(downloads).toEqual([`report-logos/${PATH}`]);
  });

  it('answers no logo for a missing object, bytes that are not a logo, or a format the path does not name', async () => {
    const jpg = `agency/${A}/0123456789abcdef.jpg`;
    const svg = `agency/${A}/fedcba9876543210.png`;
    const { admin } = fakeAdmin({
      objects: { [jpg]: PNG, [svg]: new TextEncoder().encode('<svg/>') },
    });
    const reader = supabaseBrandReader(admin, undefined, {});
    expect(await reader.logo(A, `agency/${A}/1111111111111111.png`)).toBeNull();
    expect(await reader.logo(A, jpg)).toBeNull();
    expect(await reader.logo(A, svg)).toBeNull();
  });

  it('makes a data: address for the shared page from checked bytes only', async () => {
    const { admin } = fakeAdmin({ objects: { [PATH]: PNG } });
    const reader = supabaseBrandReader(admin, undefined, {});
    expect(await logoSrcOf(reader, A, PATH)).toBe(
      `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`,
    );
    expect(await logoSrcOf(reader, B, PATH)).toBeNull();
    expect(await logoSrcOf(reader, A, null)).toBeNull();
  });
});

describe('the PDF with no brand is what it was before white-label', () => {
  // The hashes of these two files as `main` 27af20878 renders them, before white-label had readers
  // (measured by swapping pdf.ts, pdf-layout.ts and generate.ts back to that commit's).
  it('is byte for byte main’s, with or without a logo passed', async () => {
    expect(sha(await renderPdf(AUDIT))).toBe(
      'aa34c860587e9b8f7e79955c5c029780d9d2cfdd3f9e08b6773d328d8bb5ee9d',
    );
    expect(sha(await renderPdf(COMPARE))).toBe(
      '2ac9785a99902d81aeabbde45844bf56b9900a0dac710e270fe9d5e8f5c4d838',
    );
    expect(sha(await renderPdf(AUDIT, LOGO))).toBe(sha(await renderPdf(AUDIT)));
  });
});

/** The text pdf-lib draws, and the images on the first page, for `doc` with `logo`. */
async function rendered(doc: ReportDoc, logo: BrandLogo | null) {
  const texts: string[] = [];
  const real = PDFPage.prototype.drawText;
  vi.spyOn(PDFPage.prototype, 'drawText').mockImplementation(function (this: PDFPage, t, o) {
    texts.push(t);
    return real.call(this, t, o);
  });
  const bytes = await renderPdf(doc, logo);
  vi.restoreAllMocks();
  const pdf = await PDFDocument.load(bytes);
  const xobjects = pdf.getPage(0).node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
  return { texts, bytes, images: xobjects ? xobjects.keys().length : 0 };
}

describe('the PDF of a branded report', () => {
  const branded: ReportDoc = { brand: { name: 'Northwind Digital', logoPath: PATH }, ...AUDIT };

  it('draws the agency’s name above the title, and its logo above that', async () => {
    const { texts, images } = await rendered(branded, LOGO);
    expect(texts.indexOf('Northwind Digital')).toBeGreaterThanOrEqual(0);
    expect(texts.indexOf('Northwind Digital')).toBeLessThan(texts.indexOf(AUDIT.title));
    expect(images).toBe(1);
  });

  it('draws the name alone with no logo, and with a WebP logo (PDF embeds PNG and JPEG)', async () => {
    for (const logo of [null, { bytes: PNG, format: 'webp' } as BrandLogo]) {
      const { texts, images } = await rendered(branded, logo);
      expect(texts).toContain('Northwind Digital');
      expect(images).toBe(0);
    }
  });

  it('draws every string of the document once, the brand first, as docStrings lists them', async () => {
    expect(docStrings(branded)[0]).toBe('Northwind Digital');
    expect(docStrings(AUDIT)[0]).toBe(AUDIT.title);
    const { fonts } = await openPdf();
    for (const logo of [undefined, logoSize({ width: 400, height: 100 })]) {
      const { sink, drawn } = recorder();
      drawDoc(branded, measureWith(fonts), sink, logo);
      expectDrawsTheDocument(branded, drawn);
    }
  });

  it('scales a logo down to fit its box, never up, its aspect kept', () => {
    expect(logoSize({ width: 400, height: 100 })).toEqual({ width: 128, height: 32 });
    expect(logoSize({ width: 800, height: 20 })).toEqual({ width: 160, height: 4 });
    expect(logoSize({ width: 10, height: 10 })).toEqual({ width: 10, height: 10 });
    expect(LOGO_BOX).toEqual({ width: 160, height: 32 });
  });
});
