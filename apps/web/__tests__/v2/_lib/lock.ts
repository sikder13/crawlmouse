/**
 * The lock comparison's readers, shared by the screen tests: the locked HTML and a rendered screen
 * read the same way, so the two can be compared character for character (see each function).
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyChanges, withoutAddedText, type LockedScreen } from '../../../lib/v2/copy-registry';
import { WEB_ROOT } from './tokens-css';

export const locked = (screen: string) =>
  readFileSync(join(WEB_ROOT, '..', '..', 'docs', 'design', 'v2', 'screens', screen), 'utf8');

export const decode = (s: string) =>
  s
    .replace(/&#x27;|&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

export const squash = (s: string) => s.replace(/[●▲■○]/g, '').replace(/\s+/g, '');

/**
 * The characters a sighted reader sees, in order, with whitespace removed: element boundaries and
 * line breaks in the source differ between the locked HTML and JSX. Spacing is checked separately,
 * on the rendered pages, by tests/visual/copy.spec.ts. Typed status glyphs are dropped from the
 * locked side because the build draws them (decision i); screen-reader-only text is dropped from
 * both sides; the locked canvas's second state of a toggled block (`sc-if + sc-if`) is dropped,
 * since the page opens with the first.
 */
export function lockedText(html: string): string {
  const body = html.slice(html.indexOf('</helmet>'), html.indexOf('</x-dc>'));
  return squash(
    decode(
      body
        .replace(/<script[\s\S]*?<\/script>/g, '')
        .replace(/<svg[\s\S]*?<\/svg>/g, '')
        .replace(/(<\/sc-if>\s*)<sc-if [^>]*>[\s\S]*?<\/sc-if>/g, '$1')
        .replace(/<label [^>]*left:-9999px[^>]*>[^<]*<\/label>/g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<[^>]+>/g, ''),
    ),
  );
}

/**
 * What we render, read the same way, leaving out what the brief adds (`data-v2-addition`, and the
 * evidence class beside a verdict, `data-v2-evidence`): those are listed in ADDITIONS instead. A
 * label laid out invisibly only to hold a button's width (`data-v2-width-only`) is not read either.
 */
export function renderedText(markup: string, screen?: LockedScreen): string {
  const doc = new JSDOM(`<body>${markup}</body>`).window.document;
  doc
    .querySelectorAll(
      'svg, [data-v2-sr-only], [data-v2-addition], [data-v2-evidence], [data-v2-width-only]',
    )
    .forEach((el) => el.remove());
  const text = doc.body.textContent ?? '';
  return squash(screen ? withoutAddedText(text, screen) : text);
}

/** The locked text with the registry's changes for `screen` applied, read as lockedText reads. */
export const expected = (html: string, screen: LockedScreen) =>
  applyChanges(lockedText(html), screen, squash);

/** The first point where two texts part, with context, for a readable failure. */
export function firstDifference(a: string, b: string): string | null {
  if (a === b) return null;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `at ${i}:\n  locked:   …${a.slice(Math.max(0, i - 40), i + 60)}\n  rendered: …${b.slice(Math.max(0, i - 40), i + 60)}`;
}

const STATE_OF_CLASS = { ok: 'ok', warn: 'warn', bad: 'bad', neu: 'neutral' } as const;

/** Each status pill in a locked screen: its state (from the class), glyph and label, in order. */
export function lockedPills(html: string) {
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
export function renderedPills(markup: string) {
  return [
    ...markup.matchAll(
      /data-v2-pill="(\w+)">(?:<svg[^>]*data-v2-glyph-char="(.)"[\s\S]*?<\/svg>)?(?:<span [^>]*data-v2-sr-only=""[^>]*>[^<]*<\/span>)?([^<]*)<\/span>/g,
    ),
  ].map((m) => ({ state: m[1], glyph: m[2] ?? null, label: decode(m[3] ?? '').trim() }));
}

/**
 * The site header's primary navigation and the footer. CC-21b changed both from the lock on
 * purpose (the Learn menu, the full footer), so the lock comparison leaves them out on both sides
 * and the test below checks them against components/v2/footer-links.ts instead. Keyed on the
 * `aria-label="Primary"` both the lock and the build give that nav, so the footer's own nav,
 * labelled "Footer", is cut with the footer and not on its own.
 */
export const SHELL = [
  /<nav\b[^>]*aria-label="Primary"[^>]*>[\s\S]*?<\/nav>/g,
  /<footer\b[\s\S]*?<\/footer>/g,
];

export function withoutShell(markup: string): { rest: string; cut: string[] } {
  const cut: string[] = [];
  let rest = markup;
  for (const re of SHELL) {
    rest = rest.replace(re, (m) => {
      cut.push(m);
      return '';
    });
  }
  return { rest, cut };
}

export const splitAtKeep = (s: string, marker: string) => {
  const at = s.indexOf(marker);
  if (at < 0) throw new Error(`no ${marker}`);
  return [s.slice(0, at), s.slice(at)] as const;
};
