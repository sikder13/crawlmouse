import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WhatAiSeesPage } from '@crawlmouse/types';
import { HomepageAiView } from './HomepageAiView';

const base: WhatAiSeesPage = {
  url: 'https://example.com/',
  title: 'Home',
  pageClass: 'readable',
  excerpt: 'Welcome to Example — the friendly widget shop.',
  mainTextChars: 512,
};

describe('HomepageAiView', () => {
  it('renders the page-class badge, its meaning, the excerpt and the char count', () => {
    const html = renderToStaticMarkup(<HomepageAiView view={base} />);
    expect(html).toContain('What AI sees on your homepage');
    expect(html).toContain('Readable'); // page-class badge label
    expect(html).toContain('without running JavaScript'); // the honest meaning
    expect(html).toContain('Welcome to Example'); // the excerpt (escaped text)
    expect(html).toContain('512 characters of readable text.');
  });

  it('shows an honest empty-state for a JavaScript-blind homepage with no readable text', () => {
    const html = renderToStaticMarkup(
      <HomepageAiView view={{ ...base, pageClass: 'js_blind', excerpt: '', mainTextChars: 0 }} />,
    );
    expect(html).toContain('JavaScript-blind');
    expect(html).toContain('(An AI crawler sees no readable text on this page.)');
    expect(html).toContain('0 characters of readable text.');
  });

  it('A14 — escapes attacker-controlled excerpt text; never emits a live tag', () => {
    const html = renderToStaticMarkup(
      <HomepageAiView
        view={{ ...base, excerpt: '<script>alert(1)</script><img src=x onerror=alert(2)>' }}
      />,
    );
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain('<img ');
  });
});
