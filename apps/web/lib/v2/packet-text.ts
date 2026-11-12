/**
 * Packet text as the web shows and copies it.
 *
 * The engine writes each packet string as one line with nothing invisible in it
 * (packages/engine/src/v2/packets/text.ts). A packet stored before it did, or written by hand, may
 * hold a line break or a control character, and a packet is copied into a coding tool as a prompt,
 * where a line break starts a line of its own. `oneLine` is applied to a fix's title and to each
 * packet string before it is put in a block or a prompt (view/segment/fixes.ts `cleanBody`).
 */

/** Format characters (bidirectional marks, zero-width characters): removed. */
const FORMAT = /\p{Cf}/gu;
/** Control characters, tabs among them, and line and paragraph separators: each run becomes one space. */
const BREAKS = /[\p{Cc}\p{Zl}\p{Zp}]+/gu;

/** What `oneLine` leaves none of; the tests search with it. */
export const NOT_ONE_LINE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** `text` on one line: no line break, no control character, no format character. */
export const oneLine = (text: string): string =>
  text.replace(FORMAT, '').replace(BREAKS, ' ').trim();
