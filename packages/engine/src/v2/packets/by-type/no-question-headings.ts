/**
 * no_question_headings: a template whose pages of prose have section headings and none phrased as a
 * question (content/checks.ts `questionHeadings`).
 */
import type { ContentDetection } from '../../content/aggregate.js';
import {
  MIN_BLOCK_WORDS,
  MIN_BODY_WORDS,
  MIN_HEADINGS,
  PROSE_BLOCKS,
} from '../../content/thresholds.js';
import {
  AWK_TEXT,
  AWK_VISIBLE,
  CHROME_GAP,
  contentContext,
  firstFailingPage,
  KEEP_PAGE,
  mark,
  RECHECK,
  SET_ASIDE,
  tagProbe,
  template,
} from '../content-rule.js';
import { count, line, list } from '../text.js';
import type { PacketEntry } from '../types.js';

/**
 * The marks that end a question for the check (thresholds.ts QUESTION_MARK): the test beside this
 * file holds this list to that pattern.
 */
export const QUESTION_MARKS = ['?', '؟', '？'] as const;

const MARKS_PATTERN = QUESTION_MARKS.map((m) => (m === '?' ? '\\?' : m)).join('|');

/**
 * Exits 0 when an h2 or h3 after the first h1, outside the set-aside elements, holds a question mark
 * followed by a space or by the end of the heading. `s`: the h1 was passed; `h`: inside a heading
 * that counts; `t`: its text so far.
 */
const PROGRAM =
  `${AWK_VISIBLE}!c&&l~/^h1[ \\t>]/{s=1}` +
  `l~/^\\/h[23]>/{if(h&&t~/(${MARKS_PATTERN})([ \\t]|$)/)f=1;h=0}` +
  `h{${AWK_TEXT};t=t x}` +
  `l~/^h[23][ \\t>]/{h=s&&!c;${AWK_TEXT};t=x}` +
  `END{exit !f}`;

const context = (fix: ContentDetection) =>
  contentContext(fix, [
    line`The check applies to a page of prose (an H1 with at least ${count(MIN_BODY_WORDS)} words after it and no ${mark('Product')} JSON-LD) with at least ${count(MIN_HEADINGS)} section headings: an ${mark('<h2>')} or ${mark('<h3>')} after the H1 whose next block is prose (${list(
      [...PROSE_BLOCKS].map((tag) => mark(`<${tag}>`)),
      PROSE_BLOCKS.size,
      'element',
    )}) of at least ${count(MIN_BLOCK_WORDS)} words.`,
    line`It passes a page when one ${mark('<h2>')} or ${mark('<h3>')} after the H1 has a clause that ends in a question mark (${list(
      QUESTION_MARKS.map(mark),
      QUESTION_MARKS.length,
      'mark',
    )}). On the failing pages none does. Headings inside ${SET_ASIDE} are not read.`,
  ]);

export const noQuestionHeadings: PacketEntry<'no_question_headings'> = {
  kind: 'builder',
  context,
  generic: (fix) => ({
    change: [
      line`On each failing page of ${template(fix)}, phrase one ${mark('<h2>')} or ${mark('<h3>')} after the H1 as the question its section answers, ending in a question mark. One heading is enough to pass.`,
      line`Choose a section whose text already answers a question a reader would ask, and word the heading as that question. Do not turn a heading into a question its section does not answer.`,
      line`Where the template writes the headings (a fixed section on every page), change the heading in the template; where an editor writes them, edit one heading per page in the CMS.`,
      line`Keep the heading in the page's own content: one inside ${SET_ASIDE} is not read.`,
    ],
    keep: [
      KEEP_PAGE,
      line`Keep the other headings as they are: the check asks for one question, not for every heading to be one.`,
      line`Keep the heading's level, its place in the page and its ${mark('id')} if it has one, so links to the section still land.`,
      line`Keep the section's text: the heading changes, what it introduces does not.`,
    ],
  }),
  stacks: {},
  verify: (fix, facts) => {
    const probe = tagProbe(facts, firstFailingPage(fix), PROGRAM);
    return {
      command: probe.command,
      ua: probe.ua,
      expect: line`Exit status 0 when an ${mark('<h2>')} or ${mark('<h3>')} after the first ${mark('<h1>')} of the first failing page holds a question mark at the end of a clause; the audit's check failed that page. ${probe.sender} ${CHROME_GAP} ${RECHECK}`,
    };
  },
};
