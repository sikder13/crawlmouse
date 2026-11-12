/**
 * A `ReportDoc` as a PDF file (CC-31 D6), with pdf-lib and no browser.
 *
 * The page is `drawDoc`'s (pdf-layout.ts); this file gives it the fonts' measure and a sink that
 * draws on pdf-lib's pages. The text a sink call draws is the text `drawDoc` gave it:
 * `pdf.test.ts` reads pdf-lib's own `drawText` calls during a render and compares them with what a
 * recording sink was given for the same document.
 *
 * The fonts are Geist Regular and SemiBold and Geist Mono Regular, read from `fonts/` beside this
 * file through `process.cwd()` (the app's directory) and embedded as subsets. A character the fonts
 * have no glyph for is drawn as the font's missing-glyph box.
 *
 * The file's bytes depend on the document alone. The document is created without pdf-lib's own
 * metadata (its producer and the creation and modification times, which are the clock's); the
 * title is the document's.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFName, PDFString, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { ReportDoc } from './generate';
import { drawDoc, PAGE, type Face, type Measure, type PdfSink, type Tone } from './pdf-layout';

/** The font file of each face, in `lib/v2/reports/fonts/`. */
export const FONT_FILES: Record<Face, string> = {
  regular: 'Geist-Regular.ttf',
  semibold: 'Geist-SemiBold.ttf',
  mono: 'GeistMono-Regular.ttf',
};

const FACES = Object.keys(FONT_FILES) as Face[];

/** Where the font files are, from the app's directory. */
export const FONT_DIR = path.join('lib', 'v2', 'reports', 'fonts');

let fontFiles: Promise<Record<Face, Uint8Array>> | null = null;

/** The three font files, read once for the process. */
function readFonts(): Promise<Record<Face, Uint8Array>> {
  fontFiles ??= Promise.all(
    FACES.map(async (face) => {
      const bytes = await readFile(path.join(process.cwd(), FONT_DIR, FONT_FILES[face]));
      return [face, new Uint8Array(bytes)] as const;
    }),
  ).then((entries) => Object.fromEntries(entries) as Record<Face, Uint8Array>);
  return fontFiles;
}

export type Fonts = Record<Face, PDFFont>;

/** A new document with the three fonts embedded as subsets. */
export async function openPdf(): Promise<{ pdf: PDFDocument; fonts: Fonts }> {
  const files = await readFonts();
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.registerFontkit(fontkit);
  const embedded = await Promise.all(
    FACES.map(async (face) => {
      const name = path.basename(FONT_FILES[face], '.ttf');
      return [face, await pdf.embedFont(files[face], { subset: true, customName: name })] as const;
    }),
  );
  return { pdf, fonts: Object.fromEntries(embedded) as Fonts };
}

/** Text widths from the embedded fonts, each remembered. */
export function measureWith(fonts: Fonts): Measure {
  const known = new Map<string, number>();
  return (text, { face, size }) => {
    const key = `${face} ${size} ${text}`;
    let width = known.get(key);
    if (width === undefined) {
      width = fonts[face].widthOfTextAtSize(text, size);
      known.set(key, width);
    }
    return width;
  };
}

const COLOR: Record<Tone, ReturnType<typeof rgb>> = {
  ink: rgb(0.09, 0.09, 0.09),
  muted: rgb(0.4, 0.4, 0.4),
};
const RULE_COLOR = rgb(0.82, 0.82, 0.82);

/** `href` as a PDF link may open it: an http or https address, as its URL is written; else null. */
function linkTarget(href: string): string | null {
  try {
    const url = new URL(href);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/** A sink that draws on pages added to `pdf`. Distances from the top become PDF's from the bottom. */
function pdfSink(pdf: PDFDocument, fonts: Fonts): PdfSink {
  let page: PDFPage | null = null;
  const current = (): PDFPage => {
    if (page === null) throw new Error('pdf: drawn before a page was started');
    return page;
  };
  return {
    page() {
      page = pdf.addPage([PAGE.width, PAGE.height]);
    },
    text(t) {
      current().drawText(t.text, {
        x: t.x,
        y: PAGE.height - t.y,
        size: t.style.size,
        font: fonts[t.style.face],
        color: COLOR[t.style.tone],
      });
    },
    rule(r) {
      const y = PAGE.height - r.y;
      current().drawLine({
        start: { x: r.x, y },
        end: { x: r.x + r.width, y },
        thickness: 0.5,
        color: RULE_COLOR,
      });
    },
    mark(m) {
      current().drawRectangle({
        x: m.x,
        y: PAGE.height - m.y - m.size,
        width: m.size,
        height: m.size,
        color: COLOR.muted,
      });
    },
    link(l) {
      const target = linkTarget(l.href);
      if (target === null) return;
      const top = PAGE.height - l.y;
      const annotation = pdf.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [l.x, top - l.height, l.x + l.width, top],
        Border: [0, 0, 0],
        A: {
          Type: 'Action',
          S: 'URI',
          // A literal string: its backslashes and parentheses are escaped.
          URI: PDFString.of(target.replace(/[\\()]/g, '\\$&')),
        },
      });
      current().node.addAnnot(pdf.context.register(annotation));
    },
  };
}

/** `doc` as the bytes of a PDF file, on A4 pages. */
export async function renderPdf(doc: ReportDoc): Promise<Uint8Array> {
  const { pdf, fonts } = await openPdf();
  pdf.setTitle(doc.title);
  pdf.catalog.set(PDFName.of('Lang'), PDFString.of('en'));
  drawDoc(doc, measureWith(fonts), pdfSink(pdf, fonts));
  return pdf.save();
}
