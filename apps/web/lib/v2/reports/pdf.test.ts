import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFPage, PDFString } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '../fixtures';
import type { ReportDoc } from './generate';
import { auditDoc, compareDoc } from './generate-doc';
import { FONT_DIR, FONT_FILES, measureWith, openPdf, renderPdf } from './pdf';
import { drawDoc } from './pdf-layout';
import { anyDoc, expectDrawsTheDocument, recorder } from './pdf-test-support';

const HOME = 'https://crawlmouse.com/';
const BAD = fixture('bad-site');
const AUDIT = auditDoc(
  { dataset: BAD, checkId: 'c0000000-0000-4000-8000-000000000001' },
  { home: HOME },
);

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** What pdf-lib's own `drawText` is given while `doc` is rendered: the text that reaches the file. */
async function textsReachingTheFile(
  doc: ReportDoc,
): Promise<{ texts: string[]; bytes: Uint8Array }> {
  const texts: string[] = [];
  const real = PDFPage.prototype.drawText;
  vi.spyOn(PDFPage.prototype, 'drawText').mockImplementation(function (
    this: PDFPage,
    text,
    options,
  ) {
    texts.push(text);
    return real.call(this, text, options);
  });
  const bytes = await renderPdf(doc);
  vi.restoreAllMocks();
  return { texts, bytes };
}

/** What `drawDoc` gives a sink for `doc`, measured with the fonts a render embeds. */
async function recorded(doc: ReportDoc) {
  const { fonts } = await openPdf();
  const { sink, drawn } = recorder();
  drawDoc(doc, measureWith(fonts), sink);
  return drawn;
}

/** The address of each link annotation of a file, by page. */
async function linksOf(bytes: Uint8Array): Promise<string[][]> {
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPages().map((page) => {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) return [];
    return annots.asArray().map((ref) => {
      const action = pdf.context.lookup(ref, PDFDict).lookup(PDFName.of('A'), PDFDict);
      return action.lookup(PDFName.of('URI'), PDFString).decodeText();
    });
  });
}

describe('the font files', () => {
  it('are the three copied from geist@1.9.2, with its licence', () => {
    const sha = (file: string) =>
      createHash('sha256')
        .update(readFileSync(path.join(process.cwd(), FONT_DIR, file)))
        .digest('hex');
    expect({
      [FONT_FILES.regular]: sha(FONT_FILES.regular),
      [FONT_FILES.semibold]: sha(FONT_FILES.semibold),
      [FONT_FILES.mono]: sha(FONT_FILES.mono),
      'OFL.txt': sha('OFL.txt'),
    }).toEqual({
      'Geist-Regular.ttf': '2c460a7a71063e53491f343d44b382267bc0cf496e31db64865f962af3152e68',
      'Geist-SemiBold.ttf': '01923aa148e5202ae70a2e11b2ab4dc41b80bcc374aedccc913d47bb2f591c06',
      'GeistMono-Regular.ttf': '686914333e77a620c85b35481064788deb33fc25f69901bdbf296c1bbc26a7fe',
      'OFL.txt': '930853ee1daa68554d9e35c8a9175affb74f699fad9a5da6ee5ebe76379d9137',
    });
  });
});

describe('renderPdf', () => {
  it('makes a PDF of A4 pages titled as the document, with its fonts embedded as subsets', async () => {
    const bytes = await renderPdf(AUDIT);
    expect(Buffer.from(bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getTitle()).toBe('Audit report');
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    for (const page of pdf.getPages()) {
      expect(page.getSize()).toEqual({ width: 595.28, height: 841.89 });
    }
    // The three font files are 402,436 bytes together; a file that held them whole would be larger.
    const whole = Object.values(FONT_FILES).reduce(
      (n, f) => n + readFileSync(path.join(process.cwd(), FONT_DIR, f)).length,
      0,
    );
    expect(whole).toBe(402_436);
    expect(bytes.length).toBeLessThan(whole / 4);
  });

  it('gives pdf-lib the texts drawDoc draws, in order, and no other', async () => {
    const { texts } = await textsReachingTheFile(AUDIT);
    const drawn = await recorded(AUDIT);
    expect(texts).toEqual(drawn.texts.map((t) => t.text));
    expectDrawsTheDocument(AUDIT, drawn);
    expect(texts).toContain('example-outfitter.com');
    expect(texts).toContain('Cloudflare firewall rule (error 1020)');
  });

  it('links the footer line of each page to the home page', async () => {
    const bytes = await renderPdf(AUDIT);
    const links = await linksOf(bytes);
    expect(links.length).toBeGreaterThan(1);
    expect(links).toEqual(links.map(() => [HOME]));
  });

  it('writes a link only for an http or https address', async () => {
    const withHref = (href: string) => renderPdf({ ...AUDIT, footer: { ...AUDIT.footer, href } });
    for (const href of ['javascript:alert(1)', 'file:///etc/passwd', 'not an address', '']) {
      expect((await linksOf(await withHref(href))).flat(), href).toEqual([]);
    }
    expect((await linksOf(await withHref('http://example.com/a (b)\\c')))[0]).toEqual([
      'http://example.com/a%20(b)/c',
    ]);
  });

  it('gives the same bytes for the same document, whatever the clock says', async () => {
    const first = await renderPdf(AUDIT);
    vi.useFakeTimers({ now: new Date('2031-05-06T07:08:09Z'), toFake: ['Date'] });
    const later = await renderPdf(AUDIT);
    vi.useRealTimers();
    expect(Buffer.from(later).equals(Buffer.from(first))).toBe(true);
    const pdf = await PDFDocument.load(first, { updateMetadata: false });
    expect([pdf.getCreationDate(), pdf.getModificationDate(), pdf.getProducer()]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    const other = await renderPdf(
      compareDoc(
        { dataset: BAD, checkId: 'c0000000-0000-4000-8000-000000000005' },
        { dataset: BAD, checkId: 'c0000000-0000-4000-8000-000000000006' },
        { home: HOME },
      ),
    );
    expect(Buffer.from(other).equals(Buffer.from(first))).toBe(false);
  });

  it('property: the text that reaches the file is the document’s strings, each whole, and the pages’ numbers', async () => {
    await fc.assert(
      fc.asyncProperty(anyDoc, async (doc) => {
        const { texts, bytes } = await textsReachingTheFile(doc);
        const drawn = await recorded(doc);
        expect(texts).toEqual(drawn.texts.map((t) => t.text));
        expectDrawsTheDocument(doc, drawn);
        expect((await PDFDocument.load(bytes)).getPageCount()).toBe(drawn.pages);
      }),
      { numRuns: 40 },
    );
  }, 240_000);
});
