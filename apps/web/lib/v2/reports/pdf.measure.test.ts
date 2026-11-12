import { buildCheck } from '@crawlmouse/engine/v2/pipeline';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { recordedBuild } from '../../../../../packages/engine/fixtures/v2/build/recorded';
import { datasetOfBuilds } from '../view/test-support/built-dataset';
import { inputOf, TESTED_UAS, type SiteShape } from '../view/test-support/generated-check';
import { checkJson, edgeListCsv, pagesCsv } from './csv';
import { auditDoc, type CheckRecords } from './generate-doc';
import { renderPdf } from './pdf';

/**
 * How long a report takes to make and how large it is, printed for docs/specs/v2/31-agency.md §9:
 * the engine's recorded site (the largest recorded check in the repo) and a generated check of 500
 * pages, each made three times, the median. The numbers are a machine's; what is asserted is that
 * each file is what it should be.
 */

const HOME = 'https://crawlmouse.com/';
const RUNS = 3;

function median(values: number[]): number {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
}

async function timed<T>(make: () => T | Promise<T>): Promise<{ ms: number; made: T }> {
  const times: number[] = [];
  let made: T | undefined;
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    made = await make();
    times.push(performance.now() - start);
  }
  return { ms: Math.round(median(times)), made: made as T };
}

/** A site of 500 URLs: a homepage, 40 hubs it links, their pages, and 20 pages nothing links to. */
function fiveHundredPages(): SiteShape {
  const pages = Array.from({ length: 499 }, (_, i) => ({
    family: i % 4,
    answer:
      i % 47 === 46 ? ('gone' as const) : i % 53 === 52 ? ('redirect' as const) : ('ok' as const),
    features: i % 3 === 0 ? ('client' as const) : ('server' as const),
  }));
  const links: [number, number][] = [];
  for (let hub = 1; hub <= 40; hub++) {
    links.push([0, hub], [hub, 0]);
    for (let k = 0; k < 11; k++) {
      const page = 41 + (hub - 1) * 11 + k;
      if (page <= 479) links.push([hub, page], [page, hub], [page, 0]);
    }
  }
  return {
    home: 'ok',
    pages,
    links,
    capped: false,
    access: TESTED_UAS.map((_, i) =>
      i === 0 ? 'challenged_ua' : i === 1 ? 'rate_limited' : 'allowed',
    ),
  };
}

async function measure(name: string, records: CheckRecords) {
  const { dataset: d, checkId } = records;
  const pdf = await timed(async () => renderPdf(auditDoc(records, { home: HOME })));
  const doc = await timed(() => auditDoc(records, { home: HOME }));
  const csv = await timed(() => pagesCsv(d, checkId));
  const edges = await timed(() => edgeListCsv(d, checkId));
  const json = await timed(() => checkJson(d, checkId));
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  console.log(
    [
      `[report measure] ${name}:`,
      `${d.page_results.length} pages, ${d.link_edges.length} links, ${d.access_tests.length} crawler tests, ${d.fixes.length} fixes;`,
      `auditDoc + renderPdf ${pdf.ms} ms (auditDoc alone ${doc.ms} ms), ${pdf.made.length} bytes, ${(await PDFDocument.load(pdf.made)).getPageCount()} pages;`,
      `CSV ${csv.ms} ms, ${bytes(csv.made)} bytes;`,
      `edge list ${edges.ms} ms, ${bytes(edges.made)} bytes;`,
      `JSON ${json.ms} ms, ${bytes(json.made)} bytes`,
    ].join(' '),
  );
  return { pdf: pdf.made, csv: csv.made, d };
}

describe('how long a report takes, and how large it is', () => {
  it('the engine’s recorded site', async () => {
    const input = recordedBuild();
    const built = buildCheck(input);
    const made = await measure('recorded site', {
      dataset: datasetOfBuilds(input.site, [built]),
      checkId: built.check.id,
    });
    expect((await PDFDocument.load(made.pdf)).getPageCount()).toBeGreaterThan(0);
    expect(made.csv.split('\r\n')).toHaveLength(made.d.page_results.length + 2);
  }, 120_000);

  it('a generated check of 500 pages', async () => {
    const input = inputOf(fiveHundredPages());
    const built = buildCheck(input);
    const made = await measure('500 pages', {
      dataset: datasetOfBuilds(input.site, [built]),
      checkId: built.check.id,
    });
    expect(made.d.page_results).toHaveLength(500);
    expect((await PDFDocument.load(made.pdf)).getPageCount()).toBeGreaterThan(0);
    expect(made.csv.split('\r\n')).toHaveLength(502);
  }, 240_000);
});
