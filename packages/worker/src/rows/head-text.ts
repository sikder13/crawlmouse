import { DESCRIPTION_BYTES, TITLE_BYTES } from '@crawlmouse/types/v2';
import { bounded, type TextCap } from './bounded.js';

/**
 * A page's title and meta description as a row stores them (PageResult's `title` and
 * `meta_description`): ASCII whitespace collapsed to one space and trimmed, as document.title is, and
 * the characters every stored string drops (C0 controls and DEL) left out; the length in code points
 * of that text, before any cut; and the text cut to its budget like every crawled string.
 *
 * One pass over what the page wrote, building no more of that text than the budget can hold: a page
 * can write a 2 MiB title, and the row keeps at most its first bytes. head-text.test.ts holds the
 * result equal to collapsing the whole text first, on generated strings.
 */

export { DESCRIPTION_BYTES, TITLE_BYTES };

export interface HeadText {
  text: string | null;
  chars: number;
  /** The stored text is not the whole text: the budget cut it. */
  cut: boolean;
}

/** HTML's ASCII whitespace: tab, line feed, form feed, carriage return, space. */
const isAsciiSpace = (c: number): boolean =>
  c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d || c === 0x20;
/** What every stored string drops (toPersistableText), among the characters that are not spaces. */
const isDropped = (c: number): boolean => c < 0x20 || c === 0x7f;
const isHigh = (c: number): boolean => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff;

/**
 * `raw` null: the page declares none, which is recorded, unless the page was read only in part, when
 * one may lie past where reading stopped and nothing is recorded (null).
 */
export function headText(raw: string | null, cap: TextCap, inPart: boolean): HeadText | null {
  if (raw === null) return inPart ? null : { text: null, chars: 0, cut: false };
  // Every UTF-16 unit kept is at least one UTF-8 byte, so this many units hold the budget's bytes.
  const room = cap.bytes + 1;
  const parts: string[] = [];
  let kept = 0;
  let more = false; // some of the text was not kept
  let chars = 0;
  let space = false; // a space is owed before the next character
  let from = -1; // start of the run being copied as written
  // The last character kept was a high surrogate: a low one next pairs with it, whatever was dropped
  // between them, as it does once the dropped characters are gone.
  let high = false;
  const keep = (piece: string) => {
    const take = Math.min(piece.length, room - kept);
    if (take < piece.length) more = true;
    if (take > 0) parts.push(take === piece.length ? piece : piece.slice(0, take));
    kept += Math.max(0, take);
  };
  const flush = (to: number) => {
    if (from >= 0) keep(raw.slice(from, to));
    from = -1;
  };
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (isAsciiSpace(c) || isDropped(c)) {
      flush(i);
      if (isAsciiSpace(c) && chars > 0) {
        space = true;
        high = false;
      }
      continue;
    }
    if (space) {
      keep(' ');
      chars++;
      space = false;
    }
    if (from < 0) from = i;
    const pairs = isLow(c) && high;
    if (!pairs) chars++;
    high = !pairs && isHigh(c);
  }
  flush(raw.length);
  const prefix = parts.join('');
  const text = bounded(prefix, cap);
  return { text, chars, cut: more || text !== bounded(prefix, { kind: 'text', bytes: kept * 3 }) };
}
