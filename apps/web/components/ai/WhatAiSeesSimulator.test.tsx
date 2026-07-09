import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WhatAiSeesPage } from '@crawlmouse/types';
import { WhatAiSeesSimulator } from './WhatAiSeesSimulator';

const pages: WhatAiSeesPage[] = [
  { url: 'https://example.com/', title: 'Home', pageClass: 'readable', excerpt: 'Home text', mainTextChars: 100 },
  { url: 'https://example.com/app', title: 'App', pageClass: 'js_blind', excerpt: '', mainTextChars: 0 },
  { url: 'https://example.com/about', title: 'About', pageClass: 'partial', excerpt: 'About text', mainTextChars: 40 },
];

describe('WhatAiSeesSimulator', () => {
  it('lists every page with its class badge and honest whole-site framing', () => {
    const html = renderToStaticMarkup(<WhatAiSeesSimulator pages={pages} />);
    expect(html.toLowerCase()).toContain('across your whole site');
    // one badge per page class present
    expect(html).toContain('Readable');
    expect(html).toContain('JavaScript-blind');
    expect(html).toContain('Partial');
    // the urls render as text
    expect(html).toContain('https://example.com/app');
  });

  it('renders each crawled url as TEXT, never inside an href (no anchor around the url)', () => {
    const html = renderToStaticMarkup(<WhatAiSeesSimulator pages={pages} />);
    expect(html).not.toContain('href=');
  });

  it('A14 — escapes an attacker-controlled row excerpt; never emits a live tag', () => {
    const evil: WhatAiSeesPage[] = [
      {
        url: 'https://x.com/',
        title: 't',
        pageClass: 'readable',
        excerpt: '<script>alert(1)</script><img src=x onerror=alert(2)>',
        mainTextChars: 9,
      },
    ];
    const html = renderToStaticMarkup(<WhatAiSeesSimulator pages={evil} />);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain('<img ');
  });
});
