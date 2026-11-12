import { describe, expect, it } from 'vitest';
import { CHROME } from '../content/thresholds.js';
import {
  AWK_VISIBLE,
  CHROME_GAP,
  contentContext,
  EXAMPLE_PAGES,
  firstFailingPage,
  gradeLine,
  mark,
  tagProbe,
  URL_CHARS,
} from './content-rule.js';
import { commandOf } from './shell.js';
import { contentFacts, contentRecord, FIRST_TESTABLE } from './test-support/content.js';
import { line, textOf } from './text.js';

describe('the lines every content packet opens with', () => {
  const record = contentRecord('quotable_opening', {
    template_key: '/guides/{slug}',
    affected_urls: ['https://shop.test/guides/a', 'https://shop.test/guides/b'],
    extent: { failing: 2, of: 3, unread: 0 },
  });
  const rule = line`The rule.`;

  it('are the extent, the caller’s rule, the failing pages and the grade line, in that order', () => {
    expect(contentContext(record, [rule]).map(textOf)).toEqual([
      'The check `direct_answer_150` fails on 2 of the 3 pages of the template `/guides/{slug}` it was decided on.',
      'The rule.',
      'Failing pages: `https://shop.test/guides/a`, `https://shop.test/guides/b`.',
      'The check does not count towards a grade yet, so this fix moves no grade today.',
    ]);
  });

  it('count the pages that could not be read, in the singular for one', () => {
    const one = { ...record, extent: { failing: 2, of: 3, unread: 1 } };
    expect(contentContext(one, []).map(textOf)[1]).toBe(
      '1 more page of the template could not be read for this check and is not counted.',
    );
  });

  it(`name ${EXAMPLE_PAGES} failing pages and count the rest`, () => {
    const urls = Array.from({ length: EXAMPLE_PAGES + 4 }, (_, i) => `https://shop.test/g/${i}`);
    const text = contentContext({ ...record, affected_urls: urls }, []).map(textOf)[1]!;
    expect(text.match(/`https/g)).toHaveLength(EXAMPLE_PAGES);
    expect(text).toMatch(/ and 4 more pages not shown\.$/);
  });

  it('cut a long URL and say how long it was', () => {
    const long = `https://shop.test/${'a'.repeat(300)}`;
    expect(contentContext({ ...record, affected_urls: [long] }, []).map(textOf)[1]).toBe(
      `Failing page: \`${long.slice(0, URL_CHARS)}\` (cut from ${long.length} characters).`,
    );
  });

  it('claim a grade effect only for a check that counts', () => {
    expect(textOf(gradeLine(false))).toMatch(/moves no grade today/);
    expect(textOf(gradeLine(true))).toBe(
      'The check counts in the Quotable part of the AI readability grade.',
    );
  });
});

describe('the page a content command requests', () => {
  it('is the first failing page of the record', () => {
    expect(firstFailingPage(contentRecord('quotable_opening'))).toBe('https://shop.test/blog/a');
  });

  it('does not exist for a record with none', () => {
    expect(() =>
      firstFailingPage(contentRecord('quotable_opening', { affected_urls: [] })),
    ).toThrow(/failing page/);
  });
});

describe('tagProbe', () => {
  const PROGRAM = '/^h1/{f=1}END{exit !f}';

  it('requests as a crawler the site serves, with the registry’s user agent', () => {
    const probe = tagProbe(contentFacts(), 'https://shop.test/a', PROGRAM);
    expect(probe.ua).toBe(FIRST_TESTABLE.token);
    expect(commandOf(probe.command)).toBe(
      `curl -sS -A '${FIRST_TESTABLE.ua_string}' 'https://shop.test/a' | tr '\\r\\n<' '  \\n' | awk '${PROGRAM}'`,
    );
    expect(probe.sender.text).toBe(
      `It requests as ${FIRST_TESTABLE.token}, which the site serves today.`,
    );
  });

  it('requests as no crawler when the audit recorded none that is served', () => {
    const probe = tagProbe(contentFacts('no_crawler'), 'https://shop.test/a', PROGRAM);
    expect(probe.ua).toBe(null);
    expect(commandOf(probe.command)).toBe(
      `curl -sS 'https://shop.test/a' | tr '\\r\\n<' '  \\n' | awk '${PROGRAM}'`,
    );
  });
});

describe('what a command sets aside', () => {
  it('is each element the check sets aside; the attribute selectors are named as not followed', () => {
    const selectors = CHROME.split(', ');
    const elements = selectors.filter((s) => /^[a-z]+$/.test(s));
    expect(elements).toEqual(['nav', 'footer', 'aside', 'form']);
    expect(AWK_VISIBLE).toContain(`^(${elements.join('|')})[ \\t>]`);
    expect(CHROME_GAP.text).toBe(
      'The command sets aside `nav, footer, aside, form` elements as the check does, but not `[role="navigation"], [aria-hidden="true"]`.',
    );
    expect(selectors).toHaveLength(elements.length + 2);
  });
});

describe('mark', () => {
  it('shows markup of ours in a code span, and refuses a backtick', () => {
    expect(mark('<h2>').text).toBe('`<h2>`');
    expect(() => mark('a`b')).toThrow(/backtick/);
  });
});
