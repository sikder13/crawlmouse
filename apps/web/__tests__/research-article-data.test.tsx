import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getPost } from '../lib/blog/registry';
import { SOURCES } from '../lib/blog/cite';
import { parse } from './helpers/blog-render';

// The research article (C-01) states numbers measured by someone else's script on someone else's
// day. OPERATING-RULES §10 says a sentence that names measured data is either produced from the data
// or carries the command that proves it. This file is that command. It makes four things executable:
//
//   1. Every number in the article body is tagged with its source file (lib/blog/cite.tsx `N`), and
//      the tag resolves: an exact quote that occurs in that file and contains the number, a row
//      pointer into the round-three JSON whose rows all hold the number, or a count this file
//      recomputes from the source files. A digit or number word left untagged fails.
//   2. Every sentence or table that carries a number also carries a footnote to the same file.
//   3. The wording rules: no "can"/"cannot"-family word (the article reports what our requests
//      received, never what a crawler is able to read), no forecast word, no competitor name.
//   4. The title's site count is recomputed from the files, not typed.
//
// What it does NOT check: whether a quote, read in context, supports the sentence around it. That is
// the editorial reviewer's job; this file guarantees there is a quote to read.

const SLUG = 'ai-crawler-access-test-2026';
const DIR = resolve(__dirname, '../../../docs/research/2026-10-crawler-access');
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');

const README = 'README.md';
const R1 = '01-homepage-probe-96-sites.md';
const R2 = '02-sample-probe.md';
const R3 = 'fly-run-2/discriminators-2026-10-27T21-02-49-840Z.json';

interface FlyRow {
  kind: string;
  site?: string;
  token?: string;
  verdict?: string;
  count?: number;
  of?: number;
  pass?: boolean;
}
const fly = JSON.parse(read(R3)) as { rows: FlyRow[] };
const verdictRows = fly.rows.filter((r) => r.kind === 'verdict');

// ── Counts recomputed from the source files ─────────────────────────────────────────────────
const HOST = /^([a-z0-9][a-z0-9.-]*\.[a-z]{2,})\s\|/gm;
function roundOneHosts(): { setA: string[]; setB: string[] } {
  const main = read(R1).split('## Addendum')[0]!;
  const a = main.split('### Set A')[1]!.split('### Set B')[0]!;
  const b = main.split('### Set B')[1]!;
  return {
    setA: [...a.matchAll(HOST)].map((m) => m[1]!),
    setB: [...b.matchAll(HOST)].map((m) => m[1]!),
  };
}
function roundTwoHosts(): string[] {
  return [...read(R2).matchAll(/^\| ([a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\.[a-z]{2})?) \|/gm)].map(
    (m) => m[1]!,
  );
}
function roundThreeHosts(): string[] {
  const out: string[] = [];
  for (const f of [
    'discriminators-2026-10-27T21-02-49-840Z.json',
    'throughput-2026-10-27T21-10-05-378Z.json',
    'slow-host-2026-10-27T21-12-08-064Z.json',
  ]) {
    for (const r of (JSON.parse(read(`fly-run-2/${f}`)) as { rows: FlyRow[] }).rows)
      if (r.site) out.push(r.site);
  }
  return out;
}
const egressNetworks = (): Set<string> =>
  new Set(
    read(README)
      .split('\n')
      .filter((l) => l.startsWith('| `'))
      .map((l) => l.split('|').map((c) => c.trim())[4]!),
  );
const roundThreeTokens = (): Set<string> => new Set(verdictRows.map((r) => r.token!));

const DERIVED: Record<string, number> = {
  'distinct-sites': new Set([
    ...roundOneHosts().setA,
    ...roundOneHosts().setB,
    ...roundTwoHosts(),
    ...roundThreeHosts(),
  ]).size,
  'egress-networks': egressNetworks().size,
  'round3-crawler-names': roundThreeTokens().size,
};

describe('the recomputed counts are right (pinned against what the files say in words)', () => {
  it('round one has two sets of 48 distinct hosts, as its method says ("Two sets of 48 sites")', () => {
    const { setA, setB } = roundOneHosts();
    expect(read(R1)).toContain('Two sets of 48 sites');
    expect(new Set(setA).size).toBe(48);
    expect(new Set(setB).size).toBe(48);
    expect(setA.filter((h) => setB.includes(h))).toEqual([]);
  });

  it('rounds two and three re-test sites from round one, so the distinct total is round one’s 96', () => {
    const one = new Set([...roundOneHosts().setA, ...roundOneHosts().setB]);
    expect(roundTwoHosts().filter((h) => !one.has(h))).toEqual([]);
    expect(roundThreeHosts().filter((h) => !one.has(h))).toEqual([]);
    expect(new Set(roundTwoHosts()).size).toBe(15);
    expect(DERIVED['distinct-sites']).toBe(96);
  });

  it('the README lists two egress networks, and round three records six crawler names', () => {
    expect([...egressNetworks()].sort()).toEqual([
      'Fly.io worker (dedicated cloud IP)',
      'Supabase Edge Function (cloud IP)',
    ]);
    expect([...roundThreeTokens()].sort()).toEqual([
      'ChatGPT-User',
      'Claude-SearchBot',
      'ClaudeBot',
      'GPTBot',
      'OAI-SearchBot',
      'PerplexityBot',
    ]);
  });
});

// ── Number tokens ───────────────────────────────────────────────────────────────────────────
const WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  thousand: 1000,
  dozen: 12,
  half: 0.5,
  twice: 2,
};
const DIGITS = /\d+(?:[.,]\d+)*%?/g;
const WORD = new RegExp(`\\b(${Object.keys(WORDS).join('|')})\\b`, 'gi');
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const numberTokens = (text: string): string[] => [
  ...(text.match(DIGITS) ?? []),
  ...[...text.matchAll(WORD)].map((m) => m[1]!.toLowerCase()),
];
const valueOf = (t: string): number => (t in WORDS ? WORDS[t]! : Number(t.replace(/[,%]/g, '')));
const hasDigit = (hay: string, t: string) => new RegExp(`(?<![\\d.,])${esc(t)}(?![\\d])`).test(hay);
const hasWord = (hay: string, w: string) => new RegExp(`\\b${esc(w)}\\b`, 'i').test(hay);
/** The quote states this number: as written, or as the other spelling (5 ↔ five). */
function quoteStates(q: string, t: string): boolean {
  if (t in WORDS) return hasWord(q, t) || hasDigit(q, String(WORDS[t]));
  if (hasDigit(q, t)) return true;
  const word = Object.keys(WORDS).find((w) => WORDS[w] === valueOf(t));
  return word !== undefined && !t.endsWith('%') && hasWord(q, word);
}

// ── The rendered article ────────────────────────────────────────────────────────────────────
const post = getPost(SLUG);
const html = post ? renderToStaticMarkup(<post.Body />) : '';
const doc = parse(`<body>${html}</body>`);
const body = doc.body;
const tagged = [...body.querySelectorAll<HTMLElement>('[data-n]')];
const FILES = Object.values(SOURCES).map((s) => s.file);

describe('the article exists and cites real files', () => {
  it('is registered with a body', () => {
    expect(post).not.toBeNull();
    expect(body.textContent!.length).toBeGreaterThan(5000);
  });

  it('every source it can cite exists under docs/research/2026-10-crawler-access', () => {
    expect(FILES).toEqual([README, R1, R2, R3]);
    for (const f of FILES) expect(existsSync(join(DIR, f)), f).toBe(true);
  });

  it('tags enough numbers for this check to mean something', () => {
    expect(tagged.length).toBeGreaterThan(60);
  });
});

describe('every tagged number resolves against its source file', () => {
  it.each(tagged.map((el, i) => [i, el.textContent!, el] as const))('#%i "%s"', (_i, text, el) => {
    const file = el.dataset.src!;
    expect(FILES, `unknown source ${file}`).toContain(file);
    const toks = numberTokens(text);
    expect(toks.length, `"${text}" is tagged but holds no number`).toBeGreaterThan(0);
    const modes = ['q', 'row', 'derived'].filter((k) => el.dataset[k] !== undefined);
    expect(modes.length, `"${text}" names no quote, row or derivation`).toBeGreaterThan(0);

    if (el.dataset.q !== undefined) {
      const q = el.dataset.q;
      expect(read(file), `quote not found verbatim in ${file}: ${q}`).toContain(q);
      for (const t of toks)
        expect(quoteStates(q, t), `"${t}" is not stated by the quote "${q}"`).toBe(true);
    }
    if (el.dataset.row !== undefined) {
      expect(file).toBe(R3);
      expect(toks).toHaveLength(1);
      const spec = JSON.parse(el.dataset.row) as {
        site: string;
        verdict: string;
        tokens?: string[];
      };
      const field = el.dataset.field as 'count' | 'of';
      expect(['count', 'of']).toContain(field);
      const rows = verdictRows.filter((r) => r.site === spec.site && r.verdict === spec.verdict);
      const want = spec.tokens ?? [
        ...new Set(verdictRows.filter((r) => r.site === spec.site).map((r) => r.token!)),
      ];
      // "Each crawler" holds only when the matched rows cover exactly the crawlers claimed.
      expect(rows.map((r) => r.token).sort(), `${spec.site} ${spec.verdict}: crawlers`).toEqual(
        [...want].sort(),
      );
      for (const r of rows)
        expect(r[field], `${spec.site} ${spec.verdict} ${r.token} ${field}`).toBe(
          valueOf(toks[0]!),
        );
    }
    if (el.dataset.derived !== undefined) {
      const key = el.dataset.derived;
      expect(Object.keys(DERIVED)).toContain(key);
      expect(toks).toHaveLength(1);
      expect(valueOf(toks[0]!)).toBe(DERIVED[key]);
    }
  });
});

describe('no number is left untagged', () => {
  it('the body holds no digit or number word outside a tag, footnote, round label or file name', () => {
    const copy = body.cloneNode(true) as HTMLElement;
    for (const el of [...copy.querySelectorAll('[data-n], [data-ref], [data-label], [data-file]')])
      el.remove();
    const text = copy.textContent!;
    const loose = numberTokens(text);
    const where = loose.map((t) => {
      const i = text.search(new RegExp(t in WORDS ? `\\b${t}\\b` : esc(t), 'i'));
      return `${t} … ${text.substring(Math.max(0, i - 40), i + 40).replace(/\s+/g, ' ')}`;
    });
    expect(where).toEqual([]);
  });

  it('round labels name a round that exists', () => {
    expect(read(README)).toContain('Three rounds');
    for (const el of body.querySelectorAll<HTMLElement>('[data-label="round"]')) {
      expect([1, 2, 3]).toContain(Number(el.dataset.round));
    }
  });

  it('file names in the body are real files', () => {
    const named = [...body.querySelectorAll<HTMLElement>('[data-file]')].map(
      (e) => e.dataset.file!,
    );
    expect(named.length).toBeGreaterThan(0);
    for (const f of named)
      expect(existsSync(join(DIR, f)) || existsSync(resolve(DIR, '../../..', f)), f).toBe(true);
  });
});

describe('every quantified sentence carries its source reference', () => {
  const BLOCKS = 'p, li, dd, figcaption, blockquote, td, th, h2, h3';
  it.each(tagged.map((el, i) => [i, el.textContent!, el] as const))('#%i "%s"', (_i, _t, el) => {
    const block = el.closest(BLOCKS);
    expect(block, 'a number sits outside any sentence, list item or table cell').not.toBeNull();
    const file = el.dataset.src!;
    if (/^H[23]$/.test(block!.tagName)) return; // headings carry no footnote; the number is still checked above
    const scope = /^T[DH]$/.test(block!.tagName)
      ? block!.closest('table')!.querySelector('caption')
      : block;
    expect(scope, 'a table with numbers has a caption carrying its references').not.toBeNull();
    const refs = [...scope!.querySelectorAll<HTMLElement>('[data-ref]')].map((r) => r.dataset.ref);
    expect(
      refs,
      `no footnote to ${file} in: ${scope!.textContent!.trim().substring(0, 80)}`,
    ).toContain(file);
  });

  it('every footnote points at a Data entry that names its file', () => {
    const refs = [...body.querySelectorAll<HTMLElement>('[data-ref]')];
    expect(refs.length).toBeGreaterThan(20);
    for (const r of refs) {
      const href = r.querySelector('a')?.getAttribute('href') ?? '';
      const target = body.querySelector(href);
      expect(target, `footnote ${href} has no target`).not.toBeNull();
      expect(target!.querySelector<HTMLElement>('[data-file]')?.dataset.file).toBe(r.dataset.ref);
    }
  });

  it('the Data section is the last section and lists every source file once', () => {
    const sections = body.querySelectorAll('h2');
    expect(sections[sections.length - 1]!.textContent).toBe('Data');
    const listed = [...body.querySelectorAll<HTMLElement>('#data [data-file]')].map(
      (e) => e.dataset.file,
    );
    expect(listed).toEqual(FILES);
  });
});

describe('what the article shows from round three', () => {
  it('shows all five sites, one table row each, as recorded', () => {
    const sites = [...new Set(verdictRows.map((r) => r.site!))];
    expect(sites).toHaveLength(5);
    const rows = [...body.querySelectorAll('table[data-table="networks"] tbody tr')];
    expect(rows.map((tr) => tr.querySelector('th, td')!.textContent!.trim())).toEqual(sites);
  });

  it('quotes the two undefined labels verbatim; they are values in round three and absent from the other files', () => {
    for (const label of ['refused_unverified', 'redirected_away']) {
      expect(body.textContent).toContain(label);
      expect(verdictRows.some((r) => r.verdict === label)).toBe(true);
      for (const f of [README, R1, R2]) expect(read(f), `${label} in ${f}`).not.toContain(label);
    }
  });

  it('the round-three file records counts, not page addresses or request headers', () => {
    const keys = new Set(fly.rows.flatMap((r) => Object.keys(r)));
    expect([...keys].sort()).toEqual(['count', 'kind', 'of', 'pass', 'site', 'token', 'verdict']);
  });
});

describe('wording rules', () => {
  const meta = post!.meta;
  const prose = [
    body.textContent!,
    meta.title,
    meta.description,
    meta.excerpt,
    ...meta.keywords,
  ].join('\n');

  it('never says a crawler can or cannot do anything, and makes no forecast', () => {
    const banned =
      /\b(can|cannot|can't|can’t|could|couldn't|couldn’t|able|unable|will|won't|won’t|expect|expects|expected)\b/gi;
    expect(prose.match(banned) ?? []).toEqual([]);
  });

  it('names no competitor', () => {
    const competitors =
      /\b(screaming ?frog|screamingfrog|sitebulb|lumar|deepcrawl|jetoctopus|oncrawl|ahrefs|semrush|moz|ubersuggest|backlinko|yoast|botify|conductor|seoclarity|similarweb|spyfu)\b/gi;
    expect(prose.match(competitors) ?? []).toEqual([]);
  });

  it('the title states the recomputed site count', () => {
    const n = meta.title.match(/\d+/)?.[0];
    expect(Number(n)).toBe(DERIVED['distinct-sites']);
    expect(meta.title).toBe(
      `We fetched ${n} websites as AI crawlers. The answer depended on who was asking.`,
    );
  });

  it('numbers in the title, description, excerpt and keywords come from the README or a recomputed count', () => {
    const readme = read(README);
    for (const s of [meta.title, meta.description, meta.excerpt, ...meta.keywords]) {
      for (const t of numberTokens(s)) {
        const ok = Object.values(DERIVED).includes(valueOf(t)) || quoteStates(readme, t);
        expect(ok, `"${t}" in "${s}"`).toBe(true);
      }
    }
  });

  it('is authored by Udaay Sikder and tagged research', () => {
    expect(meta.author).toBe('udaay-sikder');
    expect(meta.tags).toEqual(['research']);
  });
});
