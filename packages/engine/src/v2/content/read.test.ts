/** readPage on small synthetic pages: what each feature is read from, and what is set aside. */
import { describe, expect, it } from 'vitest';
import { readPage } from './read.js';

const page = (body: string, head = '') =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const ld = (o: unknown) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const prose = (n: number, end = '.') =>
  `<p>${Array.from({ length: n }, (_, i) => `word${i}`).join(' ')}${end}</p>`;

describe('the opening', () => {
  it('is the blocks after the first H1 with text, each with its word count and answer-shaped sentences', () => {
    const f = readPage(page(`<h1></h1><h1>Title</h1>${prose(12)}<ul><li>one two three</li></ul>`));
    expect(f.has_h1).toBe(true);
    expect(f.opening).toEqual([
      { tag: 'p', words: 12, answer_sentences: 1, question: false },
      { tag: 'li', words: 3, answer_sentences: 0, question: false },
    ]);
    expect(f.words_after_h1).toBe(15);
  });

  it('a sentence counts as an answer between 8 and 60 words, ending in a full stop', () => {
    const counts = [7, 8, 60, 61].map(
      (n) => readPage(page(`<h1>T</h1>${prose(n)}`)).opening[0]!.answer_sentences,
    );
    expect(counts).toEqual([0, 1, 1, 0]);
    expect(readPage(page(`<h1>T</h1>${prose(12, '?')}`)).opening[0]!.answer_sentences).toBe(0);
  });

  it('keeps only the blocks up to the one that reaches 150 words, and counts all of them', () => {
    const f = readPage(page(`<h1>T</h1>${prose(100)}${prose(100)}${prose(100)}`));
    expect(f.opening).toHaveLength(2);
    expect(f.words_after_h1).toBe(300);
  });

  it('text in site chrome is not read: nav, footer, aside, forms', () => {
    const f = readPage(
      page(
        `<h1>T</h1><nav>${prose(20)}</nav><aside>${prose(20)}</aside><form>${prose(20)}</form><footer>${prose(20)}</footer>`,
      ),
    );
    expect(f.words_after_h1).toBe(0);
  });

  it('an H1 inside a <header> is the page title, and the text after it is read', () => {
    expect(readPage(page(`<header><h1>Post</h1></header>${prose(10)}`)).words_after_h1).toBe(10);
  });
});

describe('section headings', () => {
  it('are h2/h3 after the H1 followed by prose; any h2/h3 question counts as a question, and those among section headings apart', () => {
    const f = readPage(
      page(
        `<h1>T</h1><h2>One</h2>${prose(6)}<h2>Recent posts</h2><ul><li>a link to another post here</li></ul><h3>Why? Because</h3>${prose(6)}<h3>FAQ?</h3><ul><li>x</li></ul>`,
      ),
    );
    expect(f.headings).toEqual({ count: 2, questions: 2, section_questions: 1 });
  });

  it('a heading followed by under five words of prose is not a section heading', () => {
    expect(readPage(page(`<h1>T</h1><h2>Short</h2>${prose(4)}`)).headings.count).toBe(0);
  });

  it('a question mark in Arabic or full width counts', () => {
    const f = readPage(page(`<h1>T</h1><h2>لماذا؟</h2>${prose(6)}<h2>なぜ？</h2>${prose(6)}`));
    expect(f.headings.questions).toBe(2);
  });
});

describe('JSON-LD', () => {
  it('is flattened out of arrays, nested arrays and @graph, keeping each typed node', () => {
    const f = readPage(
      page(
        ld([
          [{ '@type': 'SiteNavigationElement' }],
          {
            '@graph': [
              {
                '@type': ['Article', 'NewsArticle'],
                description: ' d ',
                author: { name: 'A' },
                datePublished: '2025-01-02',
              },
            ],
          },
        ]),
        '',
      ),
    );
    expect(f.json_ld).toEqual([
      {
        types: ['SiteNavigationElement'],
        has_description: false,
        has_author: false,
        has_dated_publication: false,
      },
      {
        types: ['Article', 'NewsArticle'],
        has_description: true,
        has_author: true,
        has_dated_publication: true,
      },
    ]);
  });

  it('an empty description or author, or a date without a year, declares nothing; markup that does not parse is skipped', () => {
    const f = readPage(
      page(
        `${ld({ '@type': 'Article', description: '  ', author: '', datePublished: 'soon' })}<script type="application/ld+json">{nope</script>`,
      ),
    );
    expect(f.json_ld).toEqual([
      {
        types: ['Article'],
        has_description: false,
        has_author: false,
        has_dated_publication: false,
      },
    ]);
  });
});

describe('byline markup', () => {
  it('reads meta author, article:published_time, rel=author, itemprop author and date, and time[datetime] outside chrome', () => {
    const f = readPage(
      page(
        '<a rel="author" href="/a">A</a><span itemprop="author">A</span><span itemprop="datePublished">2025</span><time datetime="2025-01-01">x</time>',
        '<meta name="author" content="A"><meta property="article:published_time" content="2025-01-01">',
      ),
    );
    expect(Object.values(f.byline).every(Boolean)).toBe(true);
    expect(
      readPage(page('<footer><time datetime="2025-01-01">x</time></footer>')).byline.time_datetime,
    ).toBe(false);
  });
});

describe('specifications', () => {
  it('counts tables and lists of terms, "Label: value" lines with a digit, and spec images that are not links', () => {
    const f = readPage(
      page(
        '<table><tr><td>a</td></tr></table><dl><dt>x</dt></dl><p>Weight: 2 kg</p><li>Width: 30 cm</li><p>Colour: red</p>' +
          '<img alt="Size chart" src="/a.png"><img src="/th%C3%B4ng-s%E1%BB%91.jpg"><a href="/other"><img alt="Specifications"></a><img src="/%E0%A4%A.jpg" alt="photo">',
      ),
    );
    expect(f.specs).toEqual({ structured: 2, label_value_lines: 2, spec_images: 2 });
  });
});

describe('a page served for JavaScript to fill in', () => {
  it('is marked client-rendered, and only its JSON-LD and meta tags are read', () => {
    const f = readPage(
      page(
        '<div id="root"></div>',
        `${ld({ '@type': 'Product', description: 'x' })}<meta name="author" content="A">`,
      ),
    );
    expect(f.client_rendered).toBe(true);
    expect(f.json_ld).toHaveLength(1);
    expect(f.byline.meta_author).toBe(true);
    expect(f.words_after_h1).toBe(0);
  });
});

describe('round-1 review cases', () => {
  it('a block inside another reading block is read through the inner one, so its words count once', () => {
    const f = readPage(
      page(`<h1>T</h1><li>${prose(12)}</li><blockquote>${prose(10)}</blockquote>`),
    );
    expect(f.opening.map((b) => [b.tag, b.words])).toEqual([
      ['p', 12],
      ['p', 10],
    ]);
    expect(f.words_after_h1).toBe(22);
  });

  it('a page with a "requires JavaScript" notice that also serves its title and text is read', () => {
    const f = readPage(
      page(`<noscript>This site requires JavaScript.</noscript><h1>T</h1>${prose(40)}`),
    );
    expect(f.client_rendered).toBe(false);
    expect(f.words_after_h1).toBe(40);
  });

  it('the same notice with no H1, or too few words after it, is client-rendered', () => {
    const notice = '<noscript>This site requires JavaScript.</noscript>';
    expect(readPage(page(`${notice}${prose(40)}`)).client_rendered).toBe(true);
    expect(readPage(page(`${notice}<h1>T</h1><p>one two</p>`)).client_rendered).toBe(true);
  });

  it('byline microdata in site chrome is not the page byline', () => {
    const f = readPage(
      page(
        '<footer><span itemprop="author">A</span><span itemprop="datePublished">2025</span></footer>',
      ),
    );
    expect(f.byline.itemprop_author).toBe(false);
    expect(f.byline.itemprop_date).toBe(false);
  });

  it('a schema.org IRI type is read as its name, and mainEntity is visited', () => {
    const f = readPage(
      page(
        ld({
          '@type': 'https://schema.org/FAQPage',
          mainEntity: { '@type': 'http://schema.org/Question', description: 'q' },
        }),
      ),
    );
    expect(f.json_ld.map((n) => n.types)).toEqual([['Question'], ['FAQPage']]);
    expect(f.json_ld[0]!.has_description).toBe(true);
  });

  it('a sentence ending in a full stop and a closing quote or bracket is an answer, and splits from the next', () => {
    const words = Array.from({ length: 10 }, (_, i) => `w${i}`).join(' ');
    const f = readPage(page(`<h1>T</h1><p>“${words}.” ${words} (${words}.) ${words}</p>`));
    expect(f.opening[0]!.answer_sentences).toBe(2);
  });
});
