import { describe, expect, it } from 'vitest';
import { BOUNDARY_ELEMENTS, countWords, mainWords } from './words.js';

describe('countWords', () => {
  it('counts runs of non-space characters', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
    expect(countWords('one')).toBe(1);
    expect(countWords(' one  two\nthree\tfour ')).toBe(4);
    expect(countWords('co-op, re:use — ok')).toBe(4);
  });
});

describe('mainWords', () => {
  it('counts the words of the main content only, with navigation and footer stripped', () => {
    const html = `<body>
      <nav><a href="/a">Home</a><a href="/b">Shop</a><a href="/c">About</a></nav>
      <main><h1>Ridge tent</h1><p>Two person, three season.</p></main>
      <footer>Copyright notice text</footer>
    </body>`;
    // Counted by hand: "Ridge tent" (2) + "Two person, three season." (4).
    expect(mainWords(html)).toBe(6);
  });

  it('counts the same words whether or not the markup has whitespace between its blocks', () => {
    const server = `<body><main>
      <h1>Ridge tent</h1>
      <ul>
        <li>Two person</li>
        <li>Three season</li>
      </ul>
      <p>Weighs <b>1.9 kg</b>.</p>
    </main></body>`;
    const script =
      '<body><main><h1>Ridge tent</h1><ul><li>Two person</li><li>Three season</li></ul>' +
      '<p>Weighs <b>1.9 kg</b>.</p></main></body>';
    // By hand: Ridge, tent, Two, person, Three, season, Weighs, 1.9, kg. — nine.
    expect(mainWords(server)).toBe(9);
    expect(mainWords(script)).toBe(9);
  });

  it('does not split a word inside inline markup', () => {
    expect(mainWords('<body><main><p>co<b>op</b> <a href="/x">re</a>use</p></main></body>')).toBe(
      2,
    );
  });

  it('is zero for an empty application shell', () => {
    expect(mainWords('<body><div id="__next"></div><script src="/app.js"></script></body>')).toBe(
      0,
    );
  });
});

describe('the boundary split', () => {
  it.each([
    ['buttons', '<button>Add</button><button>Remove</button>', 2],
    ['inputs between labels', '<label>Name</label><input><label>Email</label>', 2],
    [
      'nothing between inline labels, as a browser shows them',
      '<label>Name</label><label>Email</label>',
      1,
    ],
    ['table cells', '<table><tr><td>Size</td><td>2P</td></tr></table>', 2],
    ['a line break', 'one<br>two<br/>three', 3],
    ['tags in upper case', '<P>One</P><P>Two</P>', 2],
    ['images', 'one<img src="/a.png">two', 2],
    ['a caption', '<table><caption>Sizes</caption><tr><td>2P</td></tr></table>', 2],
    ['a legend', '<fieldset><legend>Size</legend>2P</fieldset>', 2],
    [
      'a select and its options',
      '<select><option>Small</option><option>Large</option></select>',
      2,
    ],
    ['a textarea', 'Notes<textarea>none</textarea>', 2],
    ['a select whose options are not closed', '<select><option>Small<option>Large</select>Qty', 3],
  ])('separates %s', (_name, inner, words) => {
    expect(mainWords(`<body><main>${inner}</main></body>`)).toBe(words);
  });

  it('does not split on a tag whose name only starts like a boundary element', () => {
    expect(mainWords('<body><main><p>co<pre-x>op</pre-x></p></main></body>')).toBe(1);
  });

  // Every listed element, so removing one from the list fails here. Void elements take no content;
  // those the extractor strips leave only the words either side.
  const VOID = new Set(['br', 'hr', 'img', 'input']);
  const STRIPPED = new Set(['nav', 'footer', 'header', 'aside']);
  // Written out here, not taken from BOUNDARY_ELEMENTS, so dropping an element from the code fails.
  const MUST_SPLIT = [
    'address',
    'article',
    'aside',
    'blockquote',
    'br',
    'button',
    'dd',
    'details',
    'dialog',
    'div',
    'dl',
    'dt',
    'fieldset',
    'figcaption',
    'figure',
    'footer',
    'form',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'header',
    'hr',
    'img',
    'input',
    'legend',
    'li',
    'main',
    'nav',
    'ol',
    'option',
    'p',
    'pre',
    'section',
    'select',
    'summary',
    'table',
    'tbody',
    'td',
    'textarea',
    'tfoot',
    'th',
    'thead',
    'tr',
    'ul',
  ];

  it('has a case for each element the code splits on, and the code splits on each of them', () => {
    expect([...BOUNDARY_ELEMENTS].sort()).toEqual([...MUST_SPLIT].sort());
  });

  it.each(MUST_SPLIT)('splits words at <%s>', (el) => {
    const inner = VOID.has(el) ? `a<${el}>c` : `a<${el}>b</${el}>c`;
    const expected = VOID.has(el) || STRIPPED.has(el) ? 2 : 3;
    expect(mainWords(`<body><main><div>${inner}</div></main></body>`)).toBe(expected);
  });

  it('lists each element once', () => {
    expect(new Set(BOUNDARY_ELEMENTS).size).toBe(BOUNDARY_ELEMENTS.length);
  });
});

describe('the cost of counting', () => {
  const flat = (n: number) => `<body><main>${'<p>w</p>'.repeat(n)}</main></body>`;
  const fastest = (html: string) => {
    let best = Infinity;
    for (let i = 0; i < 3; i += 1) {
      const t = performance.now();
      mainWords(html);
      best = Math.min(best, performance.now() - t);
    }
    return best;
  };

  it('grows about linearly with flat siblings, not with their square', () => {
    // Four times the siblings: about 4x when linear, about 16x when quadratic.
    expect(mainWords(flat(80_000))).toBe(80_000);
    const ratio = fastest(flat(80_000)) / fastest(flat(20_000));
    expect(ratio).toBeLessThan(9);
  });
});
