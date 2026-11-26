import { PDFPage } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '../fixtures';
import { linksView } from '../view/segment/links';
import { REPORT_DOC_COPY } from '../copy/report-doc';
import type { DocBlock } from './generate';
import { auditDoc } from './generate-doc';
import { measureWith, openPdf, renderPdf } from './pdf';
import { drawDoc } from './pdf-layout';
import { expectDrawsTheDocument, recorder } from './pdf-test-support';

// Row 5 of the Goal 1 scoreboard: the Pro audit PDF shows each redirect chain hop by hop, as the
// Links and pages tab does. The three chains are client-3's on the lab (QA's production check
// `8cc1e709`), with a loop and a chain not followed to the end beside them; the cells expected below
// are written out by hand from those chains, not taken from the code under test.

afterEach(() => vi.restoreAllMocks());

const D = structuredClone(fixture('built-site'));
const ID = D.checks[0]!.id;
const ORIGIN = 'https://built-site.test';
const at = (p: string) => `${ORIGIN}${p}`;
const template = D.page_results.find((p) => p.check_id === ID && p.status_code === 200)!;

/** A page of the check requested at `path`, whose chain is `hops`, ending at `end`. */
function chain(
  path: string,
  hops: [from: string, status: number, location: string][],
  end: { url: string; status: number },
  loop = false,
) {
  D.page_results.push({
    ...structuredClone(template),
    url: at(path),
    final_url: at(end.url),
    status_code: end.status,
    redirect: {
      hops: hops.map(([from, status, location]) => ({
        from: at(from),
        status,
        location: at(location),
      })),
      loop,
    },
  });
}

chain('/check-ups', [['/check-ups', 301, '/treatments/check-ups/']], {
  url: '/treatments/check-ups/',
  status: 200,
});
chain(
  '/hygiene',
  [
    ['/hygiene', 301, '/hygienist/'],
    ['/hygienist/', 301, '/treatments/hygienist-visits/'],
  ],
  { url: '/treatments/hygienist-visits/', status: 200 },
);
chain(
  '/offers',
  [
    ['/offers', 301, '/offers/winter/'],
    ['/offers/winter/', 301, '/offers/winter-2025/'],
  ],
  { url: '/offers/winter-2025/', status: 404 },
);
chain(
  '/loop-a',
  [
    ['/loop-a', 302, '/loop-b'],
    ['/loop-b', 302, '/loop-a'],
  ],
  { url: '/loop-a', status: 302 },
  true,
);
// The last response is a redirect: the worker stopped (off the site, too many hops, robots.txt).
chain('/away', [['/away', 308, '/elsewhere']], { url: '/elsewhere', status: 308 });

/** Requested as, Hops, Ends at: each chain's row, written out from the chains above. */
const EXPECTED = [
  ['/check-ups', '301 → /treatments/check-ups/', '/treatments/check-ups/ (200)'],
  [
    '/hygiene',
    '301 → /hygienist/ → 301 → /treatments/hygienist-visits/',
    '/treatments/hygienist-visits/ (200)',
  ],
  ['/offers', '301 → /offers/winter/ → 301 → /offers/winter-2025/', '/offers/winter-2025/ (404)'],
  ['/loop-a', '302 → /loop-b → 302 → /loop-a', 'LOOP'],
  ['/away', '308 → /elsewhere', 'not followed to the end'],
];
const OURS = new Set(EXPECTED.map((r) => r[0]));

const DOC = auditDoc({ dataset: D, checkId: ID }, { home: 'https://crawlmouse.com/' });
const redirectTable = () => {
  const section = DOC.sections.find((s) => s.heading === REPORT_DOC_COPY.links)!;
  return section.blocks.find(
    (b) => b.type === 'table' && b.caption === REPORT_DOC_COPY.redirects,
  ) as Extract<DocBlock, { type: 'table' }>;
};

describe('the Pro audit PDF’s redirects (scoreboard row 5)', () => {
  it('has a row per chain: where it was requested, each hop with its status, and where it ended', () => {
    const t = redirectTable();
    expect(t.columns).toEqual(['Requested as', 'Hops', 'Ends at']);
    expect(t.rows.filter((r) => OURS.has(r[0]!))).toEqual(EXPECTED);
    // The fixture's own redirect stays, so the table is every chain of the check, not only ours.
    expect(t.rows.map((r) => r[0])).toContain('/products/old-dome-tent');
  });

  it('prints the cells the Links and pages tab shows, for every chain', () => {
    const tab = linksView(D, ID, { plan: 'pro' }).redirects.rows.map((r) => [
      r.path,
      r.hops,
      r.endsText,
    ]);
    expect(redirectTable().rows).toEqual(tab);
  });

  it('draws each cell whole into the file: every hop reaches pdf-lib', async () => {
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
    await renderPdf(DOC);
    vi.restoreAllMocks();

    const { fonts } = await openPdf();
    const { sink, drawn } = recorder();
    drawDoc(DOC, measureWith(fonts), sink);
    expect(texts).toEqual(drawn.texts.map((t) => t.text));
    // Each instance reads back as its string, whole: a long Hops cell is wrapped, never cut.
    const instances = expectDrawsTheDocument(DOC, drawn);
    const read = new Set(instances.map((i) => i.text));
    for (const cell of EXPECTED.flat()) expect(read, cell).toContain(cell);
  });
});
