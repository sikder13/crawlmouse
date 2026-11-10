import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { JsonLd } from './jsonld';

// The JSON-LD renderer writes JSON.stringify output into a <script> element as raw HTML. JSON does not
// escape `<`, `>`, `&`, U+2028 or U+2029, so a string holding `</script>` would end the element early and
// whatever follows would parse as markup. These tests parse the rendered HTML the way a browser does and
// check that the payload stays inside the one script element and still reads back as the same object.

const HOSTILE = 'x</script><script>alert(1)</script><!-- & \u2028 \u2029 y';

const PAYLOAD = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  name: HOSTILE,
  mainEntity: [{ '@type': 'Question', name: '</SCRIPT >', acceptedAnswer: { text: 'a <b> & c' } }],
};

function render(data: object | object[]) {
  const html = renderToStaticMarkup(<JsonLd data={data} />);
  const doc = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, {
    url: 'https://crawlmouse.com/',
  }).window.document;
  return { html, scripts: Array.from(doc.querySelectorAll('script')) };
}

describe('JsonLd script body', () => {
  it('keeps a hostile payload inside one script element, with no raw < > & or U+2028/9', () => {
    const { html, scripts } = render(PAYLOAD);
    expect(scripts.length).toBe(1);
    const text = scripts[0]!.textContent ?? '';
    expect(text).not.toMatch(/[<>&\u2028\u2029]/);
    expect(text).toContain('\\u2028');
    expect(text).toContain('\\u2029');
    expect(text).toContain('\\u003c/script\\u003e');
    // Nothing outside the one element: the rendered markup is that element and only that element.
    expect(html.startsWith('<script type="application/ld+json">')).toBe(true);
    expect(html.endsWith('</script>')).toBe(true);
    expect(html.match(/<\/script>/gi)).toHaveLength(1);
    expect(html).not.toContain('<!--');
  });

  it('reads back, through a JSON-LD parser, as the same object', () => {
    const { scripts } = render(PAYLOAD);
    expect(JSON.parse(scripts[0]!.textContent ?? '')).toEqual(PAYLOAD);
  });

  it('round-trips an array of nodes and leaves an ordinary payload meaning the same', () => {
    const plain = [
      { '@type': 'WebSite', name: 'Crawlmouse', url: 'https://crawlmouse.com' },
      PAYLOAD,
    ];
    const { scripts } = render(plain);
    expect(scripts.length).toBe(1);
    expect(JSON.parse(scripts[0]!.textContent ?? '')).toEqual(plain);
  });
});
