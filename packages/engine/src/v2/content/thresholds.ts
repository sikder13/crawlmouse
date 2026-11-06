/**
 * What the content checks read and decide on. The spec (docs/specs/v2/17-content-and-grade.md) is
 * rendered from this module, and grade-guard.test.ts fails when it changes without expected.json.
 */

/** Site chrome, set aside before a page is read: its headings and text are not the page's own. */
export const CHROME = 'nav, footer, aside, form, [role="navigation"], [aria-hidden="true"]';

/** The elements whose text is read after the H1, in document order. */
export const OPENING_BLOCKS: ReadonlySet<string> = new Set([
  'p',
  'li',
  'h2',
  'h3',
  'h4',
  'blockquote',
  'dd',
  'td',
]);

/** The elements whose own text may hold a "Label: value" specification line. */
export const SPEC_LINE_BLOCKS = 'p, li, dd, td, span';

/** A "Label: value" line whose value has a digit: "Kích thước: 860*10*254mm", "Alc: 13%". */
export const SPEC_LINE = /^[^:]{2,40}:\s*[^:]*\d/;

/**
 * An image whose alt text or file name names specifications. English and the languages of the label
 * set (Vietnamese "thông số", German "technische daten"); an image the matcher misses is not judged.
 */
export const SPEC_IMAGE =
  /spec(?:ification)?s?\b|size[\s_-]?(?:chart|guide)|dimension|measurement|datasheet|th[oô]ng[\s_-]?s[oố]|technische[\s_-]?daten/i;

/** direct_answer_150: the words read for an answer, after the H1. */
export const OPENING_WORDS = 150;

/** direct_answer_150 applies to a page with at least this many words after its H1. */
export const MIN_BODY_WORDS = 150;

/** A sentence that can answer: between these word counts, ending in a full stop. */
export const ANSWER_SENTENCE_WORDS = { min: 8, max: 60 } as const;

/** A block of fewer words than this is page furniture (a date, a byline, "Book now"), not an answer. */
export const MIN_BLOCK_WORDS = 5;

/** question_headings applies to a page with at least this many section headings. */
export const MIN_HEADINGS = 3;

/**
 * The elements of prose. A section heading is an h2 or h3 after the H1 whose next block is prose of at
 * least MIN_BLOCK_WORDS words: a sidebar's or a related list's heading is followed by links or by
 * other headings, not by a paragraph.
 */
export const PROSE_BLOCKS: ReadonlySet<string> = new Set(['p', 'blockquote', 'dd', 'td']);

/** A clause ends as a question: ?, Arabic ؟, full-width ？, then a space or the end. */
export const QUESTION_MARK = /[?؟？](?:\s|$)/;

/** A specifications line count from which a page shows its specifications as text. */
export const MIN_SPEC_LINES = 2;

/**
 * A template's content fix is detected when at least DETECT_MIN_PAGES of its decided pages fail and
 * they are at least DETECT_SHARE of them; clear at CLEAR_SHARE or less; between the two it stays as it
 * was (hysteresis).
 */
export const TEMPLATE_RULE = { DETECT_MIN_PAGES: 2, DETECT_SHARE: 0.5, CLEAR_SHARE: 0.1 } as const;
