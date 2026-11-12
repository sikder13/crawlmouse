import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CHROME } from '../content/thresholds.js';
import {
  AWK_SCRIPTS,
  AWK_VISIBLE,
  CHROME_GAP,
  contentContext,
  EXAMPLE_PAGES,
  firstFailingPage,
  gradeLine,
  mark,
  tagProbe,
  template,
  URL_CHARS,
} from './content-rule.js';
import { commandOf } from './shell.js';
import {
  contentFacts,
  contentRecord,
  FIRST_TESTABLE,
  hostileRecord,
  servedRow,
} from './test-support/content.js';
import { outsideCodeSpans, UNSHOWN } from './test-support/hostile.js';
import { inBothStates, runCommand, twoStateSite } from './test-support/verify.js';
import { line, textOf } from './text.js';

describe('the lines every content packet opens with', () => {
  const record = contentRecord('quotable_opening', {
    template_key: '/guides/{slug}',
    affected_urls: ['https://shop.test/guides/a', 'https://shop.test/guides/b'],
    extent: { failing: 2, of: 3, unread: 0 },
  });
  const rule = line`The rule.`;

  it('are the extent, the caller’s rule, the failing pages and the grade line, in that order', () => {
    expect(contentContext(record, contentFacts(), [rule]).map(textOf)).toEqual([
      'The check for a quotable opening sentence fails on 2 of the 3 pages of the template `/guides/{slug}` it was decided on.',
      'The rule.',
      'Failing pages: `https://shop.test/guides/a`, `https://shop.test/guides/b`.',
      'The check does not count towards a grade yet, so this fix moves no grade today.',
    ]);
  });

  it('count the pages that could not be read, in the singular for one', () => {
    const one = { ...record, extent: { failing: 2, of: 3, unread: 1 } };
    expect(contentContext(one, contentFacts(), []).map(textOf)[1]).toBe(
      '1 more page of the template could not be read for this check and is not counted.',
    );
  });

  it(`name ${EXAMPLE_PAGES} failing pages and count the rest`, () => {
    const urls = Array.from({ length: EXAMPLE_PAGES + 4 }, (_, i) => `https://shop.test/g/${i}`);
    const text = contentContext({ ...record, affected_urls: urls }, contentFacts(), []).map(
      textOf,
    )[1]!;
    expect(text.match(/`https/g)).toHaveLength(EXAMPLE_PAGES);
    expect(text).toMatch(/ and 4 more pages not shown\.$/);
  });

  it('cut a long URL and say how long it was', () => {
    const long = `https://shop.test/${'a'.repeat(300)}`;
    expect(
      contentContext({ ...record, affected_urls: [long] }, contentFacts(), []).map(textOf)[1],
    ).toBe(`Failing page: \`${long.slice(0, URL_CHARS)}\` (cut from ${long.length} characters).`);
  });

  it('name a failing page at the address its server answered at', () => {
    const facts = contentFacts(
      'every_crawler',
      null,
      new Map([
        servedRow('https://shop.test/guides/a', 'https://shop.test/guides/a/'),
        // a request that landed on another page: the page keeps its own URL
        servedRow('https://shop.test/guides/b', 'https://shop.test/login'),
      ]),
    );
    expect(contentContext(record, facts, []).map(textOf)[1]).toBe(
      'Failing pages: `https://shop.test/guides/a/`, `https://shop.test/guides/b`.',
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
      `curl -sSf --compressed -A '${FIRST_TESTABLE.ua_string}' 'https://shop.test/a' | tr '\\r\\n<' '  \\n' | awk '${PROGRAM}'`,
    );
    expect(probe.sender.text).toBe(
      `It requests as ${FIRST_TESTABLE.token}, which the site serves today.`,
    );
  });

  it('requests the address the page is served at, in both forms of the command', () => {
    const pages = new Map([servedRow('https://shop.test/a', 'https://shop.test/a/')]);
    for (const served of ['every_crawler', 'no_crawler'] as const) {
      const probe = tagProbe(contentFacts(served, null, pages), 'https://shop.test/a', PROGRAM);
      expect(commandOf(probe.command)).toContain(" 'https://shop.test/a/' | tr ");
    }
  });

  it('requests as no crawler when the audit recorded none that is served', () => {
    const probe = tagProbe(contentFacts('no_crawler'), 'https://shop.test/a', PROGRAM);
    expect(probe.ua).toBe(null);
    expect(commandOf(probe.command)).toBe(
      `curl -sSf --compressed 'https://shop.test/a' | tr '\\r\\n<' '  \\n' | awk '${PROGRAM}'`,
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

describe('a closing tag with a space before its `>`', () => {
  it('ends a set-aside element, so what follows it is read', async () => {
    const html = '<nav>menu</nav ><FOOTER>f</FOOTER\t><h1>Title</h1>';
    const site = await twoStateSite({
      broken: (_req, res) => void res.end(html.replace('<h1>Title</h1>', '')),
      fixed: (_req, res) => void res.end(html),
    });
    try {
      const program = `${AWK_VISIBLE}!c&&l~/^h1[ \\t>]/{f=1}END{exit !f}`;
      const { command } = tagProbe(contentFacts(), `${site.base}/a`, program);
      const { broken, fixed } = await inBothStates(site, commandOf(command));
      expect(broken.status).not.toBe(0);
      expect(fixed.status).toBe(0);
    } finally {
      await site.close();
    }
  });
});

describe('mark', () => {
  it('shows markup of ours in a code span, and refuses a backtick', () => {
    expect(mark('<h2>').text).toBe('`<h2>`');
    expect(() => mark('a`b')).toThrow(/backtick/);
  });
});

describe('AWK_SCRIPTS', () => {
  const PRINT = `${AWK_SCRIPTS}{print}`;
  const linesOf = async (html: string): Promise<string[]> => {
    const site = await twoStateSite({
      broken: (_req, res) => void res.end(html),
      fixed: (_req, res) => void res.end(html),
    });
    try {
      const probe = tagProbe(contentFacts(), `${site.base}/a`, PRINT);
      return (await runCommand(commandOf(probe.command))).stdout.split('\n').filter(Boolean);
    } finally {
      await site.close();
    }
  };

  it('gives a JSON-LD script element as one line, with the `<` of its text put back', async () => {
    expect(
      await linesOf(
        '<p>a</p><script type="application/ld+json">{"h":"a < b","t":"<nav>"}</SCRIPT ><nav>m</nav>',
      ),
    ).toEqual([
      'p>a',
      '/p>',
      'script type="application/ld+json">{"h":"a < b","t":"<nav>"}',
      'nav>m',
      '/nav>',
    ]);
  });

  it('gives no line for a script that is not JSON-LD, or for one that is not closed', async () => {
    expect(
      await linesOf(
        '<script>a <b</script><script type="application/ld+json">{"a":1}</script>' +
          '<script src="x"></script><p>t</p><script>b <i>c',
      ),
    ).toEqual(['script type="application/ld+json">{"a":1}', 'p>t', '/p>']);
    expect(await linesOf('<p>t</p><script type="application/ld+json">{"a": "<i>')).toEqual([
      'p>t',
      '/p>',
    ]);
  });
});

describe('content-rule over hostile records (properties)', () => {
  const CUT = / \(cut from \d+ characters\)/g;
  const plain = contentRecord('quotable_opening', { template_key: '/t' });

  it('shows the template key and each failing page in a code span, with nothing that draws nothing', () => {
    fc.assert(
      fc.property(hostileRecord('quotable_opening'), (record) => {
        const facts = contentFacts();
        const calm = {
          ...plain,
          affected_urls: record.affected_urls.map((_, i) => `https://a.test/${i}`),
          extent: record.extent,
        };
        const shown = [...contentContext(record, facts, []), line`In ${template(record)}.`];
        const expected = [...contentContext(calm, contentFacts(), []), line`In ${template(calm)}.`];
        for (const l of shown) expect(UNSHOWN.test(textOf(l))).toBe(false);
        expect(shown.map((l) => outsideCodeSpans(textOf(l)).replace(CUT, ''))).toEqual(
          expected.map((l) => outsideCodeSpans(textOf(l))),
        );
      }),
    );
  });

  it('puts a hostile page address in the command as one quoted word', () => {
    fc.assert(
      fc.property(hostileRecord('quotable_opening'), (record) => {
        const command = commandOf(
          tagProbe(contentFacts('no_crawler'), firstFailingPage(record), 'END{exit 1}').command,
        );
        expect(UNSHOWN.test(command)).toBe(false);
        expect(command).toMatch(
          /^curl -sSf --compressed '[^']*' \| tr '\\r\\n<' ' {2}\\n' \| awk 'END\{exit 1\}'$/,
        );
      }),
    );
  });
});
