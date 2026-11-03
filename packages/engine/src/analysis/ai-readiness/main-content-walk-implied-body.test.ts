/**
 * A page with no `<body>` element, read with `new MainContentWalk({ impliedBody: true })`.
 *
 * htmlparser2, the crawl worker's parser, builds no element a page does not write, so a page without a
 * `<body>` tag has no body and its main content was empty. parse5 (cheerio's default), like a browser,
 * builds the body the page implies. The implied walk reads htmlparser2's tree as parse5 would: the
 * cases below are pinned against parse5's extractMainContent, which is independent of this code, at
 * the vectors where the rule's parts decide the answer.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as cheerio from 'cheerio';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { simhashForDedup } from '../simhash.js';
import { extractMainContent } from './main-content.js';
import { MainContentWalk } from './main-content-walk.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../../../fixtures/v2/main-content/${name}`, import.meta.url), 'utf8');

const CORPUS: string[] = JSON.parse(
  gunzipSync(
    readFileSync(new URL('../../../fixtures/v2/main-content/corpus.json.gz', import.meta.url)),
  ).toString('utf8'),
);

/** The crawl worker's parse: htmlparser2 in HTML mode. */
const hp2 = (html: string) => cheerio.load(html, { xml: { xmlMode: false, decodeEntities: true } });
/** cheerio's default parse: parse5, which builds the implied body. */
const p5 = (html: string) => cheerio.load(html);

/** A pre-order walk of the whole document, as the worker's reader makes one, feeding the collector. */
function walk($: cheerio.CheerioAPI, impliedBody: boolean): MainContentWalk {
  const c = new MainContentWalk({ impliedBody });
  const stack: { node: cheerio.AnyNode; exit: boolean }[] = $.root()
    .toArray()
    .map((node) => ({ node, exit: false }));
  while (stack.length) {
    const { node, exit } = stack.pop()!;
    if (exit) {
      c.exit(node);
      continue;
    }
    c.enter(node);
    if (!('children' in node)) continue;
    stack.push({ node, exit: true });
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push({ node: node.children[i]!, exit: false });
    }
  }
  return c;
}

const implied = (html: string) => walk(hp2(html), true).result().text;
const parse5Main = (html: string) => extractMainContent(p5(html)).text;
const PREFIXES = [0, 1, 7, 100, 4096, 65_536];

describe('a page with no <body>, shaped like info.cern.ch’s', () => {
  const page = fixture('bodyless-1992.html');
  const withBody = page.replace('<NEXTID 9>\n', '<NEXTID 9>\n<BODY>\n') + '</BODY>\n';

  it('has no body element under the worker’s parser, and none under the default walk', () => {
    expect(hp2(page)('body')).toHaveLength(0);
    expect(walk(hp2(page), false).result()).toEqual({ mainTextChars: 0, text: '' });
  });

  it('gets the main content the same page has with an explicit <body>', () => {
    const explicit = walk(hp2(withBody), false).result();
    expect(explicit.text).toMatch(/^Hypertext Project - OverviewThe project joins/);
    expect(walk(hp2(page), true).result()).toEqual(explicit);
  });

  it('gets the main content parse5 gives it: the title stays out', () => {
    expect(implied(page)).toBe(parse5Main(page));
    expect(implied(page)).not.toContain('Overview -- /Project');
  });

  it('gets a simhash, the same as the explicit-body page’s', () => {
    const hash = simhashForDedup(walk(hp2(page), true).textPrefix(65_536));
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(hash).toBe(simhashForDedup(walk(hp2(withBody), false).textPrefix(65_536)));
  });
});

/** [case, html, the main content parse5 gives it]. */
const PINNED: Array<[string, string, string]> = [
  ['an empty document', '', ''],
  ['whitespace and a comment only', ' \n<!-- c --> ', ''],
  ['a head only', '<head><title>T</title><meta charset=utf-8></head>', ''],
  ['html and head, nothing after', '<html><head><title>T</title></head></html>', ''],
  [
    'text before <head>: the body starts there, and the later title is body text',
    'hello<head><title>T</title></head><p>para</p>',
    'helloTpara',
  ],
  ['an unclosed head, which htmlparser2 nests the content in', '<head><title>t</title><p>x', 'x'],
  [
    'a title with no head, then content',
    '<html lang=en><title>T</title><p>Body text <a href=/a>link</a></p></html>',
    'Body text link',
  ],
  [
    'a doctype and whitespace before the first element',
    '<!doctype html><title>T</title>  <h1>Head</h1>',
    'Head',
  ],
  ['a no-break space, which is not HTML whitespace', '<title>t</title>\u00a0x', 'x'],
  [
    'a no-break space alone starts the body, and a later title is body text',
    '<title>T</title>\u00a0<title>U</title>',
    'U',
  ],
  ['a frameset before the body: no body', '<title>t</title><frameset><frame src=a></frameset>', ''],
  [
    'text inside a frameset before the body is not body text',
    '<title>t</title><frameset><frame src=a>Your browser has no frames.</frameset>',
    '',
  ],
  [
    'a frameset after an empty element replaces the body',
    '<div></div><title>Hello</title><frameset></frameset>',
    '',
  ],
  ['the same without the frameset', '<div></div><title>Hello</title>', 'Hello'],
  ['text before a frameset keeps the body', '<p>x</p><frameset></frameset>', 'x'],
  [
    'the text that starts the body keeps it',
    '<title>t</title>Welcome<frameset><frame src=a></frameset>',
    'Welcome',
  ],
  ['text alone before a frameset keeps the body', 'x<frameset></frameset>', 'x'],
  [
    'the img that starts the body keeps it',
    '<img src=a><title>T</title><frameset></frameset>',
    'T',
  ],
  [
    'a hidden input that starts the body does not keep it',
    '<input type=hidden><title>T</title><frameset></frameset>',
    '',
  ],
  [
    'an img before a frameset keeps the body',
    '<div><img src=a></div><title>Hello</title><frameset></frameset>',
    'Hello',
  ],
  [
    'a hidden input does not keep it',
    '<div><input type=HIDDEN></div><title>Hello</title><frameset></frameset>',
    '',
  ],
  [
    'a text input does',
    '<div><input type=text></div><title>Hello</title><frameset></frameset>',
    'Hello',
  ],
  [
    'text in a raw-text element does not',
    '<div></div><script>s</script><title>T</title><frameset></frameset>',
    '',
  ],
  ['text in <noembed> does not', '<div></div><noembed>emb</noembed><frameset></frameset>', ''],
  [
    'text in a template in the head does',
    '<template>x</template><div></div><title>T</title><frameset></frameset>',
    'T',
  ],
  [
    'an img inside an element the walk strips does',
    '<div></div><nav><img></nav><title>T</title><frameset></frameset>',
    'T',
  ],
  [
    'an img inside svg does',
    '<div></div><svg><img></svg><title>T</title><frameset></frameset>',
    'T',
  ],
  [
    '<noscript> after a closed head starts the body',
    '<head></head><noscript></noscript> <title>T</title>',
    'T',
  ],
  [
    '<noscript> after a second head, the first closed',
    '<head></head><head><noscript></noscript> <title>T</title>',
    'T',
  ],
  ['<noscript> with no head stays in the head', '<noscript></noscript> <title>T</title>', ''],
  [
    '<noscript> inside an open head stays there',
    '<head><noscript></noscript></head> <title>T</title>',
    '',
  ],
  ['bgsound holds nothing: what htmlparser2 nests in it follows it', '<bgsound><p>x</p>', 'x'],
  ['bgsound after a title', '<title>a</title><bgsound>text', 'text'],
  [
    'bgsound stays in the head: a title after it does too',
    '<bgsound><title>T</title><p>x</p>',
    'x',
  ],
  [
    'a template in the head keeps its content there',
    '<template><p>tpl</p></template><p>x</p>',
    'x',
  ],
  [
    'a later </html> does not end the body',
    '<html>Lead text<div><p><html></p></html><title>Later title</title>',
    'Lead textLater title',
  ],
];

describe('the implied body, pinned against parse5', () => {
  it.each(PINNED)('%s', (_, html, expected) => {
    expect(hp2(html)('body')).toHaveLength(0);
    // The oracle first: parse5 gives what the table says.
    expect(parse5Main(html)).toBe(expected);
    const c = walk(hp2(html), true);
    expect(c.result()).toEqual({ mainTextChars: expected.length, text: expected });
    for (const n of PREFIXES) expect(c.textPrefix(n)).toBe(expected.slice(0, n));
  });

  it('is not "everything outside <head>": that rule reads text before the head wrongly', () => {
    const html = 'hello<head><title>T</title></head><p>para</p>';
    const $ = hp2(html);
    $('head').remove();
    expect(collapse($.root().text())).toBe('hellopara');
    expect(implied(html)).toBe('helloTpara');
  });
});

describe('a page with a <body> element reads as it did', () => {
  it.each([
    ['a body after content', '<p>before</p><div><body><p>inside</p></body></div>', 'inside'],
    ['a body inside an element the walk strips', '<p>before</p><nav><body>y</body></nav>', 'y'],
    ['a body after a frameset', '<title>t</title><frameset></frameset><body>x</body>', 'x'],
  ])('%s', (_, html, expected) => {
    expect(walk(hp2(html), false).result().text).toBe(expected);
    expect(walk(hp2(html), true).result()).toEqual(walk(hp2(html), false).result());
  });

  it.each([
    ['htmlparser2', hp2],
    ['parse5', p5],
  ] as const)(
    'on every corpus document that has one, parsed with %s',
    (name, parse) => {
      const differ: number[] = [];
      let withBody = 0;
      CORPUS.forEach((html, i) => {
        let $: cheerio.CheerioAPI;
        try {
          $ = parse(html);
        } catch {
          return; // parse5 throws on some numeric references: counted in main-content-walk.test.ts
        }
        if ($('body').length === 0) return;
        withBody++;
        const a = walk($, false);
        const b = walk($, true);
        const same =
          JSON.stringify(a.result()) === JSON.stringify(b.result()) &&
          PREFIXES.every((n) => a.textPrefix(n) === b.textPrefix(n));
        if (!same) differ.push(i);
      });
      expect(differ).toEqual([]);
      expect(withBody).toBe(WITH_BODY[name]);
    },
    600_000,
  );
});

describe('the corpus documents with no body', () => {
  it('read as parse5 reads them', () => {
    const bodyless = CORPUS.filter((html) => hp2(html)('body').length === 0);
    expect(bodyless).toHaveLength(BODYLESS);
    const differ = bodyless.filter((html) => implied(html) !== parse5Main(html));
    expect(differ).toEqual([]);
    // Not vacuous: each has main content under parse5.
    expect(bodyless.filter((html) => parse5Main(html) === '')).toEqual([]);
  });
});

describe('wrapping a bodyless document’s content in <body>', () => {
  it('never changes its main content', () => {
    fc.assert(
      fc.property(bodylessArb, fc.nat(80), ({ prefix, content }, n) => {
        const bare = walk(hp2(prefix + content), true);
        const wrapped = walk(hp2(`${prefix}<body>${content}</body>`), false);
        expect(bare.result()).toEqual(wrapped.result());
        expect(bare.textPrefix(n)).toBe(wrapped.textPrefix(n));
      }),
      { numRuns: 3000 },
    );
  });

  it('the generator reaches what it is for', () => {
    const seen = { openHead: 0, laterHead: 0, read: 0, dropped: 0 };
    fc.assert(
      fc.property(bodylessArb, ({ prefix, content }) => {
        const c = walk(hp2(prefix + content), true);
        if (c.result().text !== '') seen.read++;
        if (c.blocksDropped > 0) seen.dropped++;
        if (/<head>/.test(prefix) && !/<\/head>/.test(prefix) && c.result().text !== '')
          seen.openHead++;
        if (/<title>|<head>/.test(content) && /<title>/.test(prefix)) seen.laterHead++;
      }),
      { numRuns: 3000, seed: 11 },
    );
    expect(seen.read).toBeGreaterThan(2000);
    expect(seen.openHead).toBeGreaterThan(200);
    expect(seen.laterHead).toBeGreaterThan(200);
    expect(seen.dropped).toBeGreaterThan(50);
  });
});

describe('known gap: <noframes> holding a <body>', () => {
  it('is read as today: htmlparser2 builds the body inside <noframes>, which parse5 reads as text', () => {
    const html = fixture('noframes-body.html');
    const expected = 'This site uses frames. Read the plain version.';
    expect(walk(hp2(html), false).result().text).toBe(expected);
    expect(walk(hp2(html), true).result().text).toBe(expected);
    // parse5 keeps <noframes> as raw text in the head, and the frameset leaves no body.
    expect(parse5Main(html)).toBe('');
  });
});

/** Measured: corpus documents with a body element under each parser, and without one under htmlparser2. */
const WITH_BODY = { htmlparser2: 2607, parse5: 2578 };
const BODYLESS = 11;

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

// ─── generated bodyless documents ───────────────────────────────────────────────────────────────

/** What the parser keeps in the head, in any order. */
const headItem = fc.constantFrom(
  '<title>t</title>',
  '<meta charset=utf-8>',
  '<link rel=stylesheet href=/s.css>',
  '<base href=/>',
  '<script>var a = "<p>no</p>";</script>',
  '<style>p { color: red }</style>',
  '<template><p>tpl</p></template>',
  '<noframes>nf</noframes>',
  '<!-- c -->',
  ' ',
  '\n\t',
);

const prefixArb = fc
  .tuple(
    fc.constantFrom('', '<!doctype html>'),
    fc.constantFrom('', '<html>', '<html lang=en>'),
    fc.constantFrom('none', 'open', 'closed'),
    fc.array(fc.oneof(headItem, fc.constant('<noscript><p>ns</p></noscript>')), { maxLength: 4 }),
    fc.array(headItem, { maxLength: 3 }),
  )
  .map(([doctype, html, head, inHead, after]) => {
    if (head === 'none') return doctype + html + inHead.join('') + after.join('');
    const close = head === 'closed' ? '</head>' : '';
    return `${doctype}${html}<head>${inHead.join('')}${close}${after.join('')}`;
  });

/** Where the body starts: text that is not whitespace, or an element that is not head content. */
const starter = fc.constantFrom(
  'Lead text',
  '<p>First paragraph</p>',
  '<h1>Title</h1>',
  '<div>',
  '<nextid n>',
  '<nav><a href="/n">Nav</a></nav>',
  '<ul><li><a href=/a>A</a></li><li><a href=/b>B</a></li><li><a href=/c>C</a></li></ul>',
);

const contentNode: fc.Arbitrary<string> = fc.letrec((tie) => ({
  node: fc.oneof(
    { depthSize: 'small' },
    fc.constantFrom('Some prose.', ' ', 'w', '<!-- c -->', '<br>', '<img src=x>', '</p>'),
    fc.constantFrom(
      '<title>Later title</title>',
      '<head><title>h</title></head>',
      '<meta x>',
      // Open only: a close tag here would close the wrapping <body> in htmlparser2's tree, which
      // parse5 does not (pinned above), and the property would compare against that.
      '<html>',
    ),
    fc
      .array(fc.constantFrom('Home', 'About us', 'A much longer link title for a card'), {
        minLength: 2,
        maxLength: 5,
      })
      .map((ls) => `<ul>${ls.map((t) => `<li><a href="/x">${t}</a></li>`).join('')}</ul>`),
    fc
      .tuple(
        fc.constantFrom('div', 'p', 'section', 'span', 'a', 'nav', 'footer', 'script', 'main'),
        fc.array(tie('node'), { maxLength: 4 }),
        fc.boolean(),
      )
      .map(([tag, kids, close]) => `<${tag}>${kids.join('')}${close ? `</${tag}>` : ''}`),
  ),
})).node;

const bodylessArb = fc
  .tuple(prefixArb, starter, fc.array(contentNode, { maxLength: 6 }))
  .map(([prefix, first, rest]) => ({ prefix, content: first + rest.join('') }));
