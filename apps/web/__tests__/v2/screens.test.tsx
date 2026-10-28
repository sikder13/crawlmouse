import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { HomeScreen } from '../../components/v2/screens/home/HomeScreen';
import { ResultScreen } from '../../components/v2/screens/result/ResultScreen';
import { KeepBar } from '../../components/v2/screens/result/KeepBar';
import { HOME_FIXTURE } from '../../app/(v2-preview)/v2-preview/_fixtures/home';
import { RESULT_FIXTURE } from '../../app/(v2-preview)/v2-preview/_fixtures/result';
import { WEB_ROOT } from './_lib/tokens-css';

const locked = (screen: string) =>
  readFileSync(join(WEB_ROOT, '..', '..', 'docs', 'design', 'v2', 'screens', screen), 'utf8');

const decode = (s: string) =>
  s
    .replace(/&#x27;|&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

/**
 * The characters a sighted reader sees, in order, with whitespace removed: element boundaries and
 * line breaks in the source differ between the locked HTML and JSX. Spacing is checked separately,
 * on the rendered pages, by tests/visual/copy.spec.ts. Typed status glyphs are dropped from the locked side because
 * the build draws them (decision i); screen-reader-only text is dropped from both sides.
 */
function lockedText(html: string): string {
  const body = html.slice(html.indexOf('</helmet>'), html.indexOf('</x-dc>'));
  return decode(
    body
      .replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<svg[\s\S]*?<\/svg>/g, '')
      .replace(/<label [^>]*left:-9999px[^>]*>[^<]*<\/label>/g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[●▲■○]/g, '')
    .replace(/\s+/g, '');
}

function renderedText(markup: string): string {
  return decode(
    markup
      .replace(/<svg[\s\S]*?<\/svg>/g, '')
      .replace(/<(span|label) [^>]*data-v2-sr-only=""[^>]*>[\s\S]*?<\/\1>/g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ''),
  ).replace(/\s+/g, '');
}

/** The first point where two texts part, with context, for a readable failure. */
function firstDifference(a: string, b: string): string | null {
  if (a === b) return null;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `at ${i}:\n  locked:   …${a.slice(Math.max(0, i - 40), i + 60)}\n  rendered: …${b.slice(Math.max(0, i - 40), i + 60)}`;
}

const STATE_OF_CLASS = { ok: 'ok', warn: 'warn', bad: 'bad', neu: 'neutral' } as const;

/** Each status pill in a locked screen: its state (from the class), glyph and label, in order. */
function lockedPills(html: string) {
  return [...html.matchAll(/<span class="st (ok|warn|bad|neu)">([^<]*)<\/span>/g)].map((m) => {
    const text = (m[2] ?? '').trim();
    const glyph = /^[●▲■○]/.test(text) ? text.charAt(0) : null;
    return {
      state: STATE_OF_CLASS[m[1] as keyof typeof STATE_OF_CLASS],
      glyph,
      label: glyph ? text.slice(1).trim() : text,
    };
  });
}

/** Each status pill we render: its state, the glyph it draws, and its visible label, in order. */
function renderedPills(markup: string) {
  return [
    ...markup.matchAll(
      /data-v2-pill="(\w+)">(?:<svg[^>]*data-v2-glyph-char="(.)"[\s\S]*?<\/svg>)?(?:<span [^>]*data-v2-sr-only=""[^>]*>[^<]*<\/span>)?([^<]*)<\/span>/g,
    ),
  ].map((m) => ({ state: m[1], glyph: m[2] ?? null, label: decode(m[3] ?? '').trim() }));
}

const splitAtKeep = (s: string, marker: string) => {
  const at = s.indexOf(marker);
  if (at < 0) throw new Error(`no ${marker}`);
  return [s.slice(0, at), s.slice(at)] as const;
};

describe('Final-Home', () => {
  const html = renderToStaticMarkup(<HomeScreen data={HOME_FIXTURE} />);

  it('has exactly one orange element: the hero "Start the audit" (rule 3, decision 2)', () => {
    const primaries = html.match(/<[^>]*data-v2-primary=""[^>]*>[^<]*/g) ?? [];
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toMatch(/>Start the audit$/);
  });

  it('shows the locked copy: the same characters in the same order (spacing: copy.spec.ts)', () => {
    expect(
      firstDifference(lockedText(locked('Final-Home.dc.html')), renderedText(html)),
    ).toBeNull();
  });

  it('shows each status pill with the locked state, glyph and label, in order', () => {
    const want = lockedPills(locked('Final-Home.dc.html'));
    expect(want.length).toBeGreaterThan(5);
    expect(renderedPills(html)).toEqual(want);
  });

  it('computes the share of words a bot sees from the counts', () => {
    const half = renderToStaticMarkup(
      <HomeScreen
        data={{ ...HOME_FIXTURE, withoutJs: { ...HOME_FIXTURE.withoutJs, botWords: 560 } }}
      />,
    );
    expect(renderedText(half)).toContain('words·50%');
  });
});

describe('Final-Result', () => {
  const html = renderToStaticMarkup(<ResultScreen data={RESULT_FIXTURE} />);
  const lockedHtml = locked('Final-Result.dc.html');

  it('has exactly one orange element: "Open the fix" (rule 3)', () => {
    const primaries = html.match(/<[^>]*data-v2-primary=""[^>]*>[^<]*/g) ?? [];
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toMatch(/>Open the fix$/);
  });

  it('shows the locked copy above the keep bar: same characters, same order', () => {
    const [lockedMain] = splitAtKeep(lockedHtml, '<div id="keep"');
    const [ourMain] = splitAtKeep(html, '<div id="keep"');
    expect(firstDifference(lockedText(lockedMain + '</x-dc>'), renderedText(ourMain))).toBeNull();
  });

  it('shows the locked keep bar copy, open and dismissed: same characters, same order', () => {
    const [, lockedBar] = splitAtKeep(lockedHtml, '<div id="keep"');
    const ifs = [...lockedBar.matchAll(/<sc-if [^>]*>([\s\S]*?)<\/sc-if>/g)].map((m) => m[1] ?? '');
    expect(ifs).toHaveLength(2);
    const bar = (state: 'open' | 'dismissed') =>
      renderedText(
        renderToStaticMarkup(
          <KeepBar
            domain={RESULT_FIXTURE.domain}
            expires={RESULT_FIXTURE.crawl.keptUntil}
            initial={state}
          />,
        ),
      );
    expect(firstDifference(lockedText(`</helmet>${ifs[0]}</x-dc>`), bar('open'))).toBeNull();
    expect(firstDifference(lockedText(`</helmet>${ifs[1]}</x-dc>`), bar('dismissed'))).toBeNull();
  });

  it('shows each status pill with the locked state, glyph and label, in order', () => {
    const want = lockedPills(lockedHtml);
    expect(want.length).toBeGreaterThan(5);
    expect(renderedPills(html)).toEqual(want);
  });

  it('renders the keep bar hidden until the reader scrolls (scroll-gated)', () => {
    const initial = renderToStaticMarkup(<KeepBar domain="x.com" expires="26 Oct, 02:34 UTC" />);
    expect(initial).toContain('data-v2-keep="waiting"');
    expect(renderedText(initial)).toBe('');
  });

  it('reconciles the fix counts: rows add up to the total and the open and Pro pills', () => {
    expect(renderedText(html)).toContain('Fourteenfixes,inorderofimpact●3opennow'.replace('●', ''));
    expect(renderedText(html)).toContain('11onPro');
    const broken = {
      ...RESULT_FIXTURE,
      fixes: { ...RESULT_FIXTURE.fixes, total: 15 },
    };
    expect(() => renderToStaticMarkup(<ResultScreen data={broken} />)).toThrow(/fixes/);
  });

  it('builds the crawl line and the map summary from the numbers', () => {
    const other = renderToStaticMarkup(
      <ResultScreen
        data={{
          ...RESULT_FIXTURE,
          crawl: { ...RESULT_FIXTURE.crawl, pagesCrawled: 200 },
          map: { ...RESULT_FIXTURE.map, pages: 200, links: 51, orphans: 1 },
        }}
      />,
    );
    expect(renderedText(other)).toContain('200of214pagescrawled');
    expect(renderedText(other)).toContain('200pages,51links,1orphan.');
  });
});
