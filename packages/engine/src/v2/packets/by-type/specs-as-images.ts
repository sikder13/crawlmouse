/**
 * specs_as_images: a template whose product pages show their specifications in an image and not as
 * text (content/checks.ts `specsAsText`).
 */
import type { ContentDetection } from '../../content/aggregate.js';
import { MIN_SPEC_LINES, SPEC_IMAGE } from '../../content/thresholds.js';
import {
  AWK_TEXT,
  AWK_VISIBLE,
  CHROME_GAP,
  contentContext,
  firstFailing,
  firstFailingPage,
  KEEP_PAGE,
  mark,
  RECHECK,
  seeMarkup,
  SET_ASIDE,
  tagProbe,
  template,
} from '../content-rule.js';
import { count, line } from '../text.js';
import type { PacketEntry, PacketFacts } from '../types.js';

/**
 * Exits 0 when a table or a description list outside the set-aside elements (`s`) holds a `td` or
 * `dd` cell (`k`: inside one) with text in it.
 */
const PROGRAM =
  `${AWK_VISIBLE}!c&&l~/^(table|dl)[ \\t>]/{s=1}` +
  `l~/^\\/(td|dd)[ \\t>]/{k=0}` +
  `!c&&l~/^(td|dd)[ \\t>]/{k=s}` +
  `k{${AWK_TEXT};if(x~/[^ \\t]/)f=1}` +
  `END{exit !f}`;

const TABLE = mark('<table>');
const LIST = mark('<dl>');

const context = (fix: ContentDetection, facts: PacketFacts) =>
  contentContext(fix, facts, [
    line`The check applies to a page with ${mark('Product')} JSON-LD. It fails a page that shows an image of specifications and gives none as text: no ${TABLE}, no ${LIST}, and fewer than ${count(MIN_SPEC_LINES)} lines of the form ${mark('Label: value')} with a digit in the value.`,
    line`An image of specifications is an ${mark('<img>')} that is not a link to another page and whose alt text or file name matches the pattern ${mark(SPEC_IMAGE.source)} (letter case ignored).`,
    line`The audit does not record which image matched on which page, or what it shows: open the failing pages.`,
  ]);

export const specsAsImages: PacketEntry<'specs_as_images'> = {
  kind: 'builder',
  context,
  generic: (fix) => ({
    change: [
      line`In the template ${template(fix)}, print the specifications the image shows as text: a ${TABLE} with one row per specification (the label in a ${mark('<th>')}, the value in a ${mark('<td>')}), or a ${LIST} with ${mark('<dt>')} and ${mark('<dd>')} pairs.`,
      line`Fill the values from the product's own fields, so each product page prints its own; where the values exist only in the image, enter them as product data first. Add no specification the image does not show.`,
      line`Place it in the page's own content, in the HTML the server sends: one inside ${SET_ASIDE} is not read, and neither is one a script adds in the browser.`,
    ],
    keep: [
      KEEP_PAGE,
      line`Keep the image: the check fails a page for having no specifications as text, not for showing the image.`,
      line`Keep the values as the image gives them, units included.`,
      line`Keep the page's ${mark('Product')} JSON-LD as it is.`,
    ],
  }),
  stacks: {},
  verify: (fix, facts) => {
    const page = firstFailingPage(fix);
    const probe = tagProbe(facts, page, PROGRAM);
    return {
      command: probe.command,
      ua: probe.ua,
      see: {
        command: seeMarkup(facts, page, '<(th|td|dt|dd)[^>]*>[^<]*'),
        today: line`The cells of the page’s tables and description lists (${mark('<th>')}, ${mark('<td>')}, ${mark('<dt>')}, ${mark('<dd>')}), one per line, each with its text up to the next tag. The audit found no table and no description list outside ${SET_ASIDE} on the page, so today it prints nothing from the page’s own content. ${firstFailing(fix)}`,
        after: line`One line per cell: the label and the value of each specification.`,
      },
      expect: line`Exit status 0 when a ${TABLE} or ${LIST} of the first failing page holds a ${mark('<td>')} or ${mark('<dd>')} with text; the audit's check failed that page. ${probe.sender} A page that gives its specifications as labelled lines without a table also passes the check, and not this command. ${CHROME_GAP} ${RECHECK}`,
    };
  },
};
