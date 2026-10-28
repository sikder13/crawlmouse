import { describe, expect, it } from 'vitest';
import { outcome } from '../test-support/outcome.js';
import {
  MAX_DOM_DEPTH,
  MAX_READ_CHARS,
  READ_IN_PART,
  TOO_DEEP,
  countWords,
  domDepth,
  parseHtml,
  servedText,
  wordsIn,
} from './text.js';

const parse = (html: string) => parseHtml(html)!;

describe('servedText', () => {
  it('keeps adjacent elements apart and skips script, style, noscript, template and svg', () => {
    const $ = parse(
      '<html><head><title>T</title></head><body><p>one</p><p>two</p><a>three</a><script>no</script><style>no</style>' +
        '<noscript>no</noscript><template>no</template><svg><text>no</text></svg></body></html>',
    );
    expect(servedText($)).toBe('one two three');
  });

  it('does not change the document it reads', () => {
    const $ = parse('<body><p>a</p><script>s</script></body>');
    servedText($);
    expect($('script').length).toBe(1);
  });

  it('reads a body with a million sibling elements', () => {
    const $ = parse(`<body>${'<p>w'.repeat(1_000_000)}</body>`);
    expect(countWords(servedText($))).toBe(1_000_000);
  });

  it('reads text without a body element', () => {
    expect(servedText(parse('<p>no body</p>'))).toBe('no body');
  });
});

describe('nesting depth', () => {
  const nested = (depth: number) =>
    `<body>${'<div>'.repeat(depth)}deep${'</div>'.repeat(depth)}</body>`;

  it(`reads a page nested exactly ${MAX_DOM_DEPTH} deep, and refuses one level more`, () => {
    // body is one level, so depth - 1 divs inside it reach depth.
    expect(domDepth(parse(nested(MAX_DOM_DEPTH - 1)))).toBe(MAX_DOM_DEPTH);
    expect(parseHtml(nested(MAX_DOM_DEPTH))).toBeNull();
  });

  it('measures 200,000 levels in linear time, without overflowing the stack', () => {
    const t0 = Date.now();
    expect(parseHtml(nested(200_000))).toBeNull();
    expect(Date.now() - t0).toBeLessThan(5_000);
  });
});

describe('wordsIn', () => {
  it('counts words in HTML and is null for anything else', () => {
    expect(wordsIn(outcome({ body: '<body><p>a b</p><p>c</p></body>' }))).toEqual({
      words: 3,
      note: null,
    });
    const json = outcome({ headers: { 'content-type': 'application/json' }, body: '{"a": 1}' });
    expect(wordsIn(json)).toEqual({ words: null, note: null });
    expect(countWords('  ')).toBe(0);
  });

  it('is null for a page too deep to read, and says so', () => {
    const deep = outcome({ body: `<body>${'<div>'.repeat(600)}x</body>` });
    expect(wordsIn(deep)).toEqual({ words: null, note: TOO_DEEP });
  });

  it(`reads a page past ${MAX_READ_CHARS} characters up to there, and says so`, () => {
    const r = wordsIn(outcome({ body: `<body>${'w '.repeat(MAX_READ_CHARS)}</body>` }));
    expect(r.note).toBe(READ_IN_PART);
    // "<body>" takes six of the characters read; each word and its space take two.
    expect(r.words).toBe((MAX_READ_CHARS - '<body>'.length) / 2);
  });
});
