import {
  CheckSchema,
  PageResultSchema,
  AccessTestSchema,
  LinkEdgeSchema,
} from '@crawlmouse/types/v2';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures';
import {
  checkJson,
  csvCell,
  edgeListCsv,
  EDGE_COLUMNS,
  FORMULA_STARTS,
  PAGE_COLUMNS,
  pagesCsv,
} from './csv';

/**
 * An RFC 4180 reader written for this test, apart from the writer: records end at CRLF, a field in
 * double quotes holds commas, CRs, LFs and doubled quotes. It refuses what the RFC does not allow
 * (a quote inside a bare field, text after a closing quote, a file that ends inside quotes).
 */
function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let i = 0;
  const end = () => {
    records.push(record);
    record = [];
  };
  while (i < text.length) {
    let field = '';
    if (text[i] === '"') {
      i++;
      for (;;) {
        if (i >= text.length) throw new Error('the file ends inside a quoted field');
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        field += text[i++];
      }
    } else {
      while (i < text.length && text[i] !== ',' && text[i] !== '\r' && text[i] !== '\n') {
        if (text[i] === '"') throw new Error('a quote inside a bare field');
        field += text[i++];
      }
    }
    record.push(field);
    if (text[i] === ',') {
      i++;
      if (i === text.length) throw new Error('the file ends after a comma');
      continue;
    }
    if (text[i] === '\r' && text[i + 1] === '\n') {
      i += 2;
      end();
      continue;
    }
    if (i < text.length) throw new Error(`unexpected ${JSON.stringify(text[i])} after a field`);
    end();
  }
  return records;
}

const STARTS = ['=', '+', '-', '@', '\t', '\r'];

/** What a cell must read back as: the input, behind an apostrophe when it starts as a formula. */
const expected = (input: string) => (STARTS.includes(input.charAt(0)) ? `'${input}` : input);

/** Strings weighted towards the characters the rule and the format turn on. */
const hostile: fc.Arbitrary<string> = fc.oneof(
  fc.string(),
  fc.string({ unit: 'binary' }),
  fc
    .array(
      fc.constantFrom(...STARTS, '\n', '"', ',', "'", ';', ' ', 'a', '1', 'HYPERLINK(', '|', ' '),
      { maxLength: 12 },
    )
    .map((parts) => parts.join('')),
  fc.tuple(fc.constantFrom(...STARTS), fc.string()).map(([a, b]) => a + b),
);

const BAD = fixture('bad-site');
const CHECK = BAD.checks.find((c) => c.status === 'finished')!;
const PAGE = BAD.page_results.find((p) => p.check_id === CHECK.id)!;
const EDGE = BAD.link_edges.find((e) => e.check_id === CHECK.id)!;

describe('the rule', () => {
  it('names the six characters a spreadsheet reads as the start of a formula', () => {
    expect([...FORMULA_STARTS]).toEqual(STARTS);
  });

  it.each(STARTS)('puts an apostrophe before a value that starts with %j', (start) => {
    expect(parseCsv(csvCell(`${start}1+1`))).toEqual([[`'${start}1+1`]]);
    expect(parseCsv(csvCell(start))).toEqual([[`'${start}`]]);
  });

  it('leaves a value that starts with anything else as it is, the empty value included', () => {
    for (const v of ['', 'a=1', ' =1', "'=1", '1-2', 'https://example.com/?a=-1', '\n=1']) {
      expect(parseCsv(`${csvCell(v)}\r\n`)).toEqual([[v]]);
    }
  });

  it('property: a cell never reads back starting as a formula, and reads back as its input', () => {
    fc.assert(
      fc.property(hostile, (input) => {
        const [[cell]] = parseCsv(`${csvCell(input)}\r\n`) as [[string]];
        expect(STARTS.includes(cell.charAt(0))).toBe(false);
        expect(cell).toBe(expected(input));
      }),
      { numRuns: 2000 },
    );
  });
});

describe('the pages file', () => {
  /** A page whose every string column holds `s[i]`, whatever the contract would say of it. */
  const pageWith = (s: readonly string[]) =>
    ({
      ...PAGE,
      url: s[0]!,
      final_url: s[1]!,
      kind: s[2]!,
      template_key: s[3]!,
      title: { text: s[4]!, chars: 1, cut: false },
      meta_description: { text: s[5]!, chars: 1, cut: false },
      found_via: s[6]!,
      sitemap_lastmod: s[7]!,
      suggested_parent_url: s[8]!,
      without_js: { raw_words: 1, rendered_words: 2, text_share: 0.5, state: s[9]! },
      content_failures: [s[10]!],
    }) as unknown as typeof PAGE;
  const STRING_COLUMNS = 11;

  it('has the documented columns, in order, as its first record', () => {
    expect(parseCsv(pagesCsv({ page_results: [] }, CHECK.id))).toEqual([[...PAGE_COLUMNS]]);
    expect(PAGE_COLUMNS).toEqual([
      'url',
      'final_url',
      'status_code',
      'kind',
      'template_key',
      'title',
      'meta_description',
      'depth',
      'links_in',
      'links_out',
      'pagerank_share',
      'is_orphan',
      'js_only',
      'found_via',
      'sitemap_lastmod',
      'suggested_parent_url',
      'sampled',
      'raw_words',
      'rendered_words',
      'text_share',
      'text_state',
      'crawlers_reached',
      'crawlers_reading_text',
      'content_failures',
      'is_html',
      'links_read',
    ]);
  });

  it('writes one record per page of the check, with what the record holds', () => {
    const pages = BAD.page_results.filter((p) => p.check_id === CHECK.id);
    const other = { ...PAGE, check_id: '00000000-0000-4000-8000-000000000000' };
    const [header, ...rows] = parseCsv(pagesCsv({ page_results: [...pages, other] }, CHECK.id));
    expect(rows).toHaveLength(pages.length);
    const at = (row: string[], column: (typeof PAGE_COLUMNS)[number]) =>
      row[header!.indexOf(column)];
    for (const [i, p] of pages.entries()) {
      expect(rows[i]).toHaveLength(PAGE_COLUMNS.length);
      expect(at(rows[i]!, 'url')).toBe(p.url);
      expect(at(rows[i]!, 'status_code')).toBe(String(p.status_code));
      expect(at(rows[i]!, 'depth')).toBe(p.depth === null ? '' : String(p.depth));
      expect(at(rows[i]!, 'title')).toBe(p.title?.text ?? '');
      expect(at(rows[i]!, 'is_orphan')).toBe(String(p.is_orphan));
      expect(at(rows[i]!, 'raw_words')).toBe(p.without_js ? String(p.without_js.raw_words) : '');
      expect(at(rows[i]!, 'content_failures')).toBe((p.content_failures ?? []).join(' '));
    }
  });

  it('writes an empty cell for what was not read', () => {
    const unread = {
      ...PAGE,
      depth: null,
      pagerank_share: null,
      sitemap_lastmod: null,
      suggested_parent_url: null,
      without_js: null,
      crawlers_reached: null,
      crawlers_reading_text: null,
      content_failures: null,
      final_url: null,
      title: null,
      meta_description: { text: null, chars: 0, cut: false },
    };
    const [header, row] = parseCsv(pagesCsv({ page_results: [unread] }, CHECK.id));
    const empty = header!.filter((_, i) => row![i] === '');
    expect(empty).toEqual([
      'final_url',
      'title',
      'meta_description',
      'depth',
      'pagerank_share',
      'sitemap_lastmod',
      'suggested_parent_url',
      'raw_words',
      'rendered_words',
      'text_share',
      'text_state',
      'crawlers_reached',
      'crawlers_reading_text',
      'content_failures',
    ]);
  });

  it('property: no cell of a page built from arbitrary strings reads back starting as a formula', () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(hostile, { minLength: STRING_COLUMNS, maxLength: STRING_COLUMNS }), {
          minLength: 1,
          maxLength: 4,
        }),
        (pages) => {
          const text = pagesCsv({ page_results: pages.map(pageWith) }, CHECK.id);
          const [header, ...rows] = parseCsv(text);
          expect(rows).toHaveLength(pages.length);
          for (const [n, row] of rows.entries()) {
            expect(row).toHaveLength(PAGE_COLUMNS.length);
            for (const cell of row) expect(STARTS.includes(cell.charAt(0))).toBe(false);
            const s = pages[n]!;
            const at = (column: (typeof PAGE_COLUMNS)[number]) => row[header!.indexOf(column)];
            expect(at('url')).toBe(expected(s[0]!));
            expect(at('final_url')).toBe(expected(s[1]!));
            expect(at('kind')).toBe(expected(s[2]!));
            expect(at('template_key')).toBe(expected(s[3]!));
            expect(at('title')).toBe(expected(s[4]!));
            expect(at('meta_description')).toBe(expected(s[5]!));
            expect(at('found_via')).toBe(expected(s[6]!));
            expect(at('sitemap_lastmod')).toBe(expected(s[7]!));
            expect(at('suggested_parent_url')).toBe(expected(s[8]!));
            expect(at('text_state')).toBe(expected(s[9]!));
            expect(at('content_failures')).toBe(expected(s[10]!));
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it('a negative number is a cell like any other: it reads back behind the apostrophe', () => {
    const [, row] = parseCsv(
      pagesCsv({ page_results: [{ ...PAGE, links_in: -1 } as typeof PAGE] }, CHECK.id),
    );
    expect(row![PAGE_COLUMNS.indexOf('links_in')]).toBe("'-1");
  });
});

describe('the edge list', () => {
  it('has from, to and anchor as its first record, then one record per link of the check', () => {
    const edges = BAD.link_edges.filter((e) => e.check_id === CHECK.id);
    const other = { ...EDGE, check_id: '00000000-0000-4000-8000-000000000000' };
    const [header, ...rows] = parseCsv(edgeListCsv({ link_edges: [...edges, other] }, CHECK.id));
    expect(header).toEqual(['from', 'to', 'anchor']);
    expect([...EDGE_COLUMNS]).toEqual(['from', 'to', 'anchor']);
    expect(rows).toEqual(edges.map((e) => [e.from_url, e.to_url, e.anchor_text]));
  });

  it('a row with a quote, a comma, a CR and an LF reads back as it was written', () => {
    const anchor = 'He said "buy, now"\r\nthen left,\rdid he not?\n';
    const rows = parseCsv(
      edgeListCsv(
        {
          link_edges: [
            { ...EDGE, anchor_text: anchor },
            { ...EDGE, from_url: 'https://a.test/"x",y', anchor_text: '""' },
          ],
        },
        CHECK.id,
      ),
    );
    expect(rows).toEqual([
      ['from', 'to', 'anchor'],
      [EDGE.from_url, EDGE.to_url, anchor],
      ['https://a.test/"x",y', EDGE.to_url, '""'],
    ]);
  });

  it('property: no cell of a link built from arbitrary strings reads back starting as a formula', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(hostile, hostile, hostile), { maxLength: 6 }), (links) => {
        const text = edgeListCsv(
          {
            link_edges: links.map(([from_url, to_url, anchor_text]) => ({
              ...EDGE,
              from_url,
              to_url,
              anchor_text,
            })),
          },
          CHECK.id,
        );
        const [, ...rows] = parseCsv(text);
        expect(rows).toEqual(links.map((l) => l.map(expected)));
        for (const cell of rows.flat()) expect(STARTS.includes(cell.charAt(0))).toBe(false);
      }),
      { numRuns: 1000 },
    );
  });
});

describe('the JSON file', () => {
  const d = {
    checks: BAD.checks,
    page_results: BAD.page_results,
    link_edges: BAD.link_edges,
    access_tests: BAD.access_tests,
  };

  it('holds the check and its pages, links and crawler tests as the contract’s records', () => {
    const file = JSON.parse(checkJson(d, CHECK.id)) as Record<string, unknown[]>;
    expect(Object.keys(file)).toEqual(['check', 'page_results', 'link_edges', 'access_tests']);
    expect(CheckSchema.parse(file.check)).toEqual(CHECK);
    expect((file.page_results as unknown[]).map((p) => PageResultSchema.parse(p))).toEqual(
      BAD.page_results.filter((p) => p.check_id === CHECK.id),
    );
    expect((file.link_edges as unknown[]).map((e) => LinkEdgeSchema.parse(e))).toEqual(
      BAD.link_edges.filter((e) => e.check_id === CHECK.id),
    );
    expect((file.access_tests as unknown[]).map((t) => AccessTestSchema.parse(t))).toEqual(
      BAD.access_tests.filter((t) => t.check_id === CHECK.id),
    );
  });

  it('holds no record of another check', () => {
    const other = BAD.checks.find((c) => c.id !== CHECK.id && c.status === 'finished')!;
    const file = JSON.parse(checkJson(d, other.id)) as {
      check: { id: string };
      page_results: { check_id: string }[];
      link_edges: { check_id: string }[];
      access_tests: { check_id: string }[];
    };
    expect(file.check.id).toBe(other.id);
    for (const r of [...file.page_results, ...file.link_edges, ...file.access_tests]) {
      expect(r.check_id).toBe(other.id);
    }
  });

  it('throws for a check the records do not hold', () => {
    expect(() => checkJson(d, '00000000-0000-4000-8000-000000000000')).toThrow(/no check/i);
  });
});
