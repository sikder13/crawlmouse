import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COPY_EDITS, copyEditsMarkdown, type CopyEdit } from '../lib/blog/copy-edits';
import { bannedMatches } from '../lib/seo/banned-phrases';
import { renderPostPage } from './helpers/blog-render';

// Each edit in lib/blog/copy-edits.ts stands where the list says, its old wording is gone from the
// file and the page, and its before is what its reason says and its after is not. The guard that no
// UNlisted edit happened is blog-existing-posts-unchanged.test.tsx, which reverses these.

const read = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8');
const occurrences = (hay: string, needle: string) => hay.split(needle).length - 1;

const NUMBER = 'one|two|three|four|five|six|seven|eight|nine|ten';
// A figure: a digit, "N in M", a fraction word or a percentage word.
const FIGURE = new RegExp(
  `\\d|\\b(?:${NUMBER}) in (?:${NUMBER})\\b|\\b(?:half|third|quarter|percent)\\b`,
  'i',
);

const HOLDS: Record<CopyEdit['reason'], (text: string) => boolean> = {
  'banned-phrase': (t) => bannedMatches(t).length > 0,
  'unsourced-figure': (t) => FIGURE.test(t),
};

describe.each(COPY_EDITS.map((e) => [`${e.file}:${e.line}`, e] as const))('%s', (_, e) => {
  it('its after stands once in the file, starting on its line, and its before is gone', () => {
    const src = read(e.file);
    expect(occurrences(src, e.source.after)).toBe(1);
    expect(src).not.toContain(e.source.before);
    expect(src.split('\n')[e.line - 1]).toContain(e.source.after.split('\n')[0]!);
  });

  it('its after is rendered and its before is not', async () => {
    const { doc } = await renderPostPage(e.slug);
    const html = doc.querySelector('main')!.outerHTML;
    expect(occurrences(html, e.html.after)).toBe(1);
    expect(html).not.toContain(e.html.before);
  });

  it(`its before is a case of its reason (${e.reason}) and its after is not, nor any banned phrase`, () => {
    expect(HOLDS[e.reason](e.html.before)).toBe(true);
    expect(HOLDS[e.reason](e.html.after)).toBe(false);
    expect(bannedMatches(e.html.after)).toEqual([]);
  });
});

it('the Markdown table has one row per edit, and the spec carries it between its markers', () => {
  const md = copyEditsMarkdown();
  const rows = md.split('\n').filter((l) => l.startsWith('| `apps/web/'));
  expect(rows).toHaveLength(COPY_EDITS.length);
  for (const e of COPY_EDITS) expect(md).toContain(`\`apps/web/${e.file}:${e.line}\``);
  const spec = read('../../docs/specs/v2/40-seo-launch.md');
  const table = spec.split('<!-- d8-table:start -->\n')[1]?.split('\n<!-- d8-table:end -->')[0];
  expect(table).toBe(md);
});
