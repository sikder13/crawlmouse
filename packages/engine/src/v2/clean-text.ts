/**
 * Crawled text made safe to show on one line. Its own module because the fix titles (grade/outcomes.ts)
 * and the fix packets (packets/text.ts) both use it, and the grade-change guard digests what the
 * grade code imports: a change to the packet text rules then leaves that digest alone.
 */

/**
 * Code points that draw nothing or change how text is shown: removed. The Unicode categories, and
 * the letters and marks that render blank though their category says otherwise (the Hangul fillers,
 * the braille blank, the combining grapheme joiner, two Khmer inherent vowels, the Old Chinese hook
 * mark and a musical null notehead). The list holds the ones found so far, not a proof there are no more.
 */
const INVISIBLE =
  /[\p{Cf}\p{Co}\p{Cs}\p{Cn}\p{Variation_Selector}\u034F\u115F\u1160\u17B4\u17B5\u2800\u3164\uFFA0\u{16FE4}\u{1D159}]/gu;
/** Control characters, line and paragraph separators, and every other space: each run becomes one space. */
const BREAKS = /[\p{Cc}\p{Zl}\p{Zp}\p{Zs}]+/gu;

/** Crawled text without the code points `INVISIBLE` lists, with no line break and no backtick. */
export function clean(crawled: string): string {
  return crawled.replace(INVISIBLE, '').replace(BREAKS, ' ').replaceAll('`', "'").trim();
}
