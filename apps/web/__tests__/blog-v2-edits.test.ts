import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allPostSlugs } from '../lib/blog/posts';
import { V2_EDITS, v2EditsMarkdown } from '../lib/blog/v2-edits';
import { renderPostPage } from './helpers/blog-render';

// D5: each listed edit stands where the list says, the old wording is gone from its file and from
// the rendered page, and no post or the layout around it still promises a v1-only result. The guard
// that no UNlisted edit happened is blog-existing-posts-unchanged.test.tsx.

const read = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8');
const occurrences = (hay: string, needle: string) => hay.split(needle).length - 1;

// What v1 promised and v2 does not ship, in the forms the posts and the layout used.
const V1_ONLY =
  /A–F (internal-linking )?grade|A&ndash;F|0–100|0&ndash;100|AI-readiness score|one complete fix|GitHub Action|webhooks|white-label reports/i;

describe.each(V2_EDITS.map((e) => [`${e.file}:${e.line}`, e] as const))('%s', (_, e) => {
  it('its after stands once in the file, starting on its line, and its before is gone', () => {
    const src = read(e.file);
    expect(occurrences(src, e.source.after)).toBe(1);
    expect(src).not.toContain(e.source.before);
    const firstLine = e.source.after.split('\n')[0]!;
    expect(src.split('\n')[e.line - 1]).toContain(firstLine);
  });

  it('its after is rendered and its before is not', async () => {
    for (const slug of e.slug ? [e.slug] : allPostSlugs()) {
      const { doc } = await renderPostPage(slug);
      const html = doc.querySelector('main')!.outerHTML;
      expect(occurrences(html, e.html.after), slug).toBe(1);
      expect(html, slug).not.toContain(e.html.before);
    }
  });

  it('its before is a v1-only promise and its after is not', () => {
    expect(e.html.before).toMatch(V1_ONLY);
    expect(e.html.after).not.toMatch(V1_ONLY);
  });
});

it('no post page still promises a v1-only result anywhere in its main content', async () => {
  const left: string[] = [];
  for (const slug of allPostSlugs()) {
    const { doc } = await renderPostPage(slug);
    const m = (doc.querySelector('main')!.textContent ?? '').match(V1_ONLY);
    if (m) left.push(`${slug}: ${m[0]}`);
  }
  expect(left).toEqual([]);
});

it('the Markdown table has one row per edit, each naming its file and line', () => {
  const md = v2EditsMarkdown();
  const rows = md.split('\n').filter((l) => l.startsWith('| `apps/web/'));
  expect(rows).toHaveLength(V2_EDITS.length);
  for (const e of V2_EDITS) expect(md).toContain(`\`apps/web/${e.file}:${e.line}\``);
  expect(md).toContain(`${V2_EDITS.length} sentences changed`);
});
