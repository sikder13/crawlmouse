import { DESCRIPTION_BYTES, TITLE_BYTES } from '@crawlmouse/types/v2';
import { bounded, type TextCap } from './bounded.js';

/**
 * A page's title and meta description as a row stores them (PageResult's `title` and
 * `meta_description`): ASCII whitespace collapsed to one space and trimmed, as document.title is; the
 * length in code points of that text, before any cut; and the text cut to its budget like every
 * crawled string.
 */

export { DESCRIPTION_BYTES, TITLE_BYTES };

export interface HeadText {
  text: string | null;
  chars: number;
  cut: boolean;
}

/** HTML's ASCII whitespace: tab, line feed, form feed, carriage return, space. */
const ASCII_WHITESPACE = /[\t\n\f\r ]+/g;

/**
 * `raw` null: the page declares none, which is recorded, unless the page was read only in part, when
 * one may lie past where reading stopped and nothing is recorded (null).
 */
export function headText(raw: string | null, cap: TextCap, inPart: boolean): HeadText | null {
  if (raw === null) return inPart ? null : { text: null, chars: 0, cut: false };
  const collapsed = raw.replace(ASCII_WHITESPACE, ' ').trim();
  const text = bounded(collapsed, cap);
  // Cut when the stored text is not the whole text as it would be stored with no budget.
  const whole = bounded(collapsed, { kind: 'text', bytes: Buffer.byteLength(collapsed) });
  let chars = 0;
  for (const _ of collapsed) chars++;
  return { text, chars, cut: text !== whole };
}
