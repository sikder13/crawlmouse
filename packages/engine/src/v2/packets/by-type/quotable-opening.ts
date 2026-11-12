/**
 * quotable_opening: a template whose pages of prose do not open with a sentence that can be quoted
 * as an answer (content/checks.ts `directAnswer`).
 */
import type { ContentDetection } from '../../content/aggregate.js';
import {
  ANSWER_SENTENCE_WORDS,
  MIN_BLOCK_WORDS,
  MIN_BODY_WORDS,
  OPENING_BLOCKS,
  OPENING_WORDS,
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
import { count, line, ours } from '../text.js';
import type { PacketEntry } from '../types.js';

/** What may follow a sentence's last mark and still end it (content/read.ts): quotes and brackets. */
const CLOSERS = `("|'|”|’|\\)|\\]|»)*`;

/**
 * Exits 0 when the check's rule holds on the page's own blocks, read tag by tag. After the first h1
 * (`s`), each block element's text is gathered in `t` (`b` is its tag) and judged by `e` when the
 * next block opens or this one closes: while fewer than OPENING_WORDS words were read (`r`), a block
 * that is not a list item and has MIN_BLOCK_WORDS words passes the page (`f`) if one of its
 * sentences ends in a full stop and has ANSWER_SENTENCE_WORDS words (`k` counts a sentence's words).
 */
const PROGRAM =
  `function e(n,i,k,w){n=split(t,w," ");if(b!=""&&r<${OPENING_WORDS}){r+=n;if(b!="li"&&n>=${MIN_BLOCK_WORDS})` +
  `{k=0;for(i=1;i<=n;i++){k++;if(w[i]~/([.!?]|؟)${CLOSERS}$/){if(w[i]~/\\.${CLOSERS}$/&&k>=${ANSWER_SENTENCE_WORDS.min}&&k<=${ANSWER_SENTENCE_WORDS.max})f=1;k=0}}}}t="";b=""}` +
  `${AWK_VISIBLE}!s{if(!c&&l~/^h1[ \\t>]/)s=1;next}` +
  `l~/^\\/?(${[...OPENING_BLOCKS].join('|')})[ \\t>]/{e();if(!c&&l!~/^\\//){match(l,/^[a-z0-9]+/);b=substr(l,1,RLENGTH)}}` +
  `b!=""{${AWK_TEXT};t=t x}` +
  `END{e();exit !f}`;

const SENTENCE = ours(
  `a sentence of ${ANSWER_SENTENCE_WORDS.min} to ${ANSWER_SENTENCE_WORDS.max} words that ends in a full stop`,
);

const context = (fix: ContentDetection) =>
  contentContext(fix, [
    line`The check applies to a page of prose: an H1 with at least ${count(MIN_BODY_WORDS)} words after it and no ${mark('Product')} JSON-LD.`,
    line`It reads the first ${count(OPENING_WORDS)} words after the H1 and passes a page when a block there, other than a list item, has at least ${count(MIN_BLOCK_WORDS)} words and holds ${SENTENCE}. On the failing pages no block does.`,
    line`The audit keeps no page text, so this packet cannot quote the openings: read the failing pages.`,
  ]);

export const quotableOpening: PacketEntry<'quotable_opening'> = {
  kind: 'builder',
  context,
  generic: (fix) => ({
    change: [
      line`On each failing page of ${template(fix)}, make the first paragraph after the H1 state the page's main point in ${SENTENCE}.`,
      line`Put it in a ${mark('<p>')} directly after the H1, before any list, gallery or call to action, so it falls inside the first ${count(OPENING_WORDS)} words.`,
      line`A sentence that ends in ${mark('?')} or ${mark('!')} does not pass, and neither does a list item's own text or anything inside ${SET_ASIDE}.`,
      line`Where the opening comes from a field (a summary, an excerpt, a lead), fill that field on each failing page and have the template print it after the H1; where an editor writes the body, rewrite its first paragraph.`,
    ],
    keep: [
      KEEP_PAGE,
      line`Keep the meaning: the sentence states what the page already says, and adds no claim the page does not support.`,
      line`Keep the rest of the body where it is; the opening is added or reworded, nothing is removed.`,
    ],
  }),
  stacks: {},
  verify: (fix, facts) => {
    const probe = tagProbe(facts, firstFailingPage(fix), PROGRAM);
    return {
      command: probe.command,
      ua: probe.ua,
      expect: line`Exit status 0 when, within the first ${count(OPENING_WORDS)} words after the first ${mark('<h1>')} of the first failing page, a block other than a list item holds ${SENTENCE}; the audit's check failed that page. ${probe.sender} ${CHROME_GAP} ${RECHECK}`,
    };
  },
};
