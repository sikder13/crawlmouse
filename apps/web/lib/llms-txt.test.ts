import { describe, it, expect } from 'vitest';
import { buildLlmsTxt, LLMS_TXT_HONEST_NOTE, type LlmsTxtPage } from './llms-txt';

const p = (url: string, title: string | null, pagerank: number | null): LlmsTxtPage => ({ url, title, pagerank });

describe('buildLlmsTxt', () => {
  const pages: LlmsTxtPage[] = [
    p('https://ex.com/about', 'About Us', 0.2),
    p('https://ex.com/', 'Home', 0.9),
    p('https://ex.com/b', 'B page', 0.5),
    p('https://ex.com/a', 'A page', 0.5), // same pagerank as /b -> url-asc tiebreak puts /a before /b
  ];

  it('orders pages by PageRank desc, then URL asc, as a markdown link list', () => {
    const out = buildLlmsTxt('https://ex.com/', pages);
    const links = out.split('\n').filter((l) => l.startsWith('- ['));
    expect(links).toEqual([
      '- [Home](https://ex.com/)',
      '- [A page](https://ex.com/a)', // equal PageRank with /b -> URL-asc puts /a first
      '- [B page](https://ex.com/b)',
      '- [About Us](https://ex.com/about)',
    ]);
  });

  it('carries the H1 host heading and the honest, non-ranking header note (A16/A18)', () => {
    const out = buildLlmsTxt('https://ex.com/', pages);
    expect(out.startsWith('# ex.com')).toBe(true);
    expect(out).toContain(LLMS_TXT_HONEST_NOTE);
    // no ranking/citation PROMISE anywhere in the artifact (A16 banned claims)
    expect(out.toLowerCase()).not.toMatch(/ai ranking|guaranteed|will be cited|improves? .{0,16}ranking/);
  });

  it('is byte-deterministic across two calls (A18/R1)', () => {
    expect(buildLlmsTxt('https://ex.com/', pages)).toBe(buildLlmsTxt('https://ex.com/', pages));
  });

  it('falls back to the URL as the label when a page has no title, and sorts null pagerank last', () => {
    const out = buildLlmsTxt('https://ex.com/', [p('https://ex.com/x', null, null), p('https://ex.com/', 'Home', 0.9)]);
    const links = out.split('\n').filter((l) => l.startsWith('- ['));
    expect(links[0]).toBe('- [Home](https://ex.com/)');
    expect(links[1]).toBe('- [https://ex.com/x](https://ex.com/x)'); // null title -> url label; null rank -> last
  });

  it('SECURITY (A14): a crawled title cannot break the markdown link syntax (brackets/newlines/backticks neutralized)', () => {
    const out = buildLlmsTxt('https://ex.com/', [p('https://ex.com/evil', 'Pwn](http://evil) ```\n## Injected', 0.9)]);
    const link = out.split('\n').find((l) => l.startsWith('- ['))!;
    expect(link).not.toContain(']('.repeat(2)); // no second link-target opener smuggled in
    expect(link).not.toContain('`'); // backticks neutralized
    expect(out.split('\n').filter((l) => l.startsWith('## '))).toHaveLength(1); // the injected "## Injected" cannot forge a heading
  });

  it('SECURITY: a URL containing parens cannot break the link target', () => {
    const out = buildLlmsTxt('https://ex.com/', [p('https://ex.com/a_(b)', 'Paren', 0.9)]);
    const link = out.split('\n').find((l) => l.startsWith('- ['))!;
    expect(link).not.toMatch(/\)[^)]*\)\s*$/); // the raw ")" cannot prematurely close the (…) target
    expect(link).toContain('%28');
    expect(link).toContain('%29');
  });

  it('SECURITY (A14): the URL-FALLBACK label (no title) is also bracket-neutralized — no link-label breakout', () => {
    // A null-title page falls back to the url AS the [label]; a "]" in that url must not close the label.
    const out = buildLlmsTxt('https://ex.com/', [p('https://ex.com/a]evil](http://bad)', null, 0.9)]);
    const link = out.split('\n').find((l) => l.startsWith('- ['))!;
    const labelPart = link.slice(3, link.lastIndexOf(']('));
    expect(labelPart).not.toContain(']'); // the label cannot contain a closing bracket
    expect(labelPart).not.toContain('['); // ...nor an opening bracket for a smuggled second link
  });
});
