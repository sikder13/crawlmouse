/**
 * How text reaches a fix packet.
 *
 * A packet is copied into a developer's coding assistant as a prompt, and emailed. Text a crawled site
 * chose (a URL, a path, a template key, anchor text, a heading) could carry an instruction for that
 * assistant, so it enters a packet through `code` and no other way:
 *
 *   - format and control characters are removed (`INVISIBLE`, `BREAKS`), so it cannot start a line,
 *     reorder what is shown, or hide text;
 *   - a backtick becomes an apostrophe, so it cannot end the code span it is shown in;
 *   - it is cut at a stated number of code points, and a cut says how long the text was;
 *   - it is wrapped in a code span.
 *
 * `line` is a tagged template whose interpolations are `Safe` values, which only this module makes
 * (`code`, `count`, `ours`, `list`). A value made anywhere else throws (`made`); a plain string does
 * not type-check. The parts of a line the template itself holds are this repository's own text, and
 * `line` refuses a line break in them.
 */

/**
 * Code points that draw nothing or change how text is shown: removed. The Unicode categories, and
 * the letters and marks that render blank though their category says otherwise (the Hangul fillers,
 * the braille blank, the combining grapheme joiner, two Khmer inherent vowels).
 */
const INVISIBLE =
  /[\p{Cf}\p{Co}\p{Cs}\p{Cn}\p{Variation_Selector}\u034F\u115F\u1160\u17B4\u17B5\u2800\u3164\uFFA0]/gu;
/** Control characters, line and paragraph separators, and every other space: each run becomes one space. */
const BREAKS = /[\p{Cc}\p{Zl}\p{Zp}\p{Zs}]+/gu;

/** The longest crawled text a packet shows, in code points, unless a caller asks for less. */
export const MAX_CRAWLED_CHARS = 200;

const made = new WeakSet<object>();
const lines = new WeakSet<object>();

/** Text that may be interpolated into a packet line. */
export interface Safe {
  readonly text: string;
}
/** One line of a packet: a single line of text, with every crawled part inside a code span. */
export interface Line {
  readonly line: string;
}

function safe(text: string): Safe {
  const value = Object.freeze({ text });
  made.add(value);
  return value;
}

/** Crawled text without the code points `INVISIBLE` lists, with no line break and no backtick. */
export function clean(crawled: string): string {
  return crawled.replace(INVISIBLE, '').replace(BREAKS, ' ').replaceAll('`', "'").trim();
}

/** Crawled text, cleaned, cut to `max` code points and shown in a code span. */
export function code(crawled: string, max: number = MAX_CRAWLED_CHARS): Safe {
  const points = [...clean(crawled)];
  if (points.length <= max) return safe(`\`${points.join('')}\``);
  return safe(`\`${points.slice(0, max).join('')}\` (cut from ${points.length} characters)`);
}

/** A whole number, as digits. */
export function count(n: number): Safe {
  if (!Number.isSafeInteger(n)) throw new Error(`packets: ${n} is not a whole number`);
  return safe(String(n));
}

/**
 * Text this repository wrote: a registry value, a label. It is checked, not cleaned: a line break or
 * an invisible character in it is a mistake here, and throws.
 */
export function ours(text: string): Safe {
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cs}\p{Cn}]/u.test(text)) {
    throw new Error('packets: text of ours holds a control or invisible character');
  }
  return safe(text);
}

/**
 * Up to `max` items, comma-separated; when there are more, the line says how many are not shown.
 * `noun` names what an item is, for that count ("page", "link").
 */
export function list(items: readonly Safe[], max: number, noun: string): Safe {
  for (const item of items) mustBeMade(item);
  const shown = items.slice(0, max).map((s) => s.text);
  const rest = items.length - shown.length;
  if (rest === 0) return safe(shown.join(', '));
  return safe(`${shown.join(', ')} and ${rest} more ${noun}${rest === 1 ? '' : 's'} not shown`);
}

function mustBeMade(value: unknown): asserts value is Safe {
  if (typeof value !== 'object' || value === null || !made.has(value)) {
    throw new Error('packets: a line takes only values made by code, count, ours or list');
  }
}

/** A packet line, from this repository's words and `Safe` values. */
export function line(parts: TemplateStringsArray, ...values: readonly Safe[]): Line {
  let text = '';
  parts.forEach((part, i) => {
    if (/[\r\n]/.test(part)) throw new Error('packets: a line is one line');
    text += part;
    if (i < values.length) {
      mustBeMade(values[i]);
      text += (values[i] as Safe).text;
    }
  });
  const value = Object.freeze({ line: text.trim() });
  lines.add(value);
  return value;
}

/** The text of a line `line` made; anything else throws. */
export function textOf(value: Line): string {
  if (!lines.has(value)) throw new Error('packets: not a line made by `line`');
  return value.line;
}
