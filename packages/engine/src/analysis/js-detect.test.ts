import { describe, it, expect } from 'vitest';
import { looksJsRendered } from './js-detect.js';

describe('looksJsRendered', () => {
  it('flags an empty SPA root shell (empty div#root) as JS-rendered', () => {
    // Classic Create-React-App / Vite shell: a single mount node with no content.
    const html = `<!doctype html><html><head><title>App</title></head>
      <body><div id="root"></div><script src="/static/main.js"></script></body></html>`;
    expect(looksJsRendered(html)).toBe(true);
  });

  it('flags an empty #app / #__next mount node too', () => {
    expect(looksJsRendered('<html><body><div id="app"></div><script src="a.js"></script></body></html>')).toBe(true);
    expect(looksJsRendered('<html><body><div id="__next"></div><script src="n.js"></script></body></html>')).toBe(true);
  });

  it('flags a CRA "you need to enable JavaScript" noscript notice', () => {
    const html = `<html><body>
      <noscript>You need to enable JavaScript to run this app.</noscript>
      <div id="root"><p>server fallback text that is long enough to not be empty here</p></div>
      </body></html>`;
    expect(looksJsRendered(html)).toBe(true);
  });

  it('does NOT flag a normal SSR page with paragraphs and several links', () => {
    const html = `<html><head><title>About Us</title></head><body>
      <h1>About Our Company</h1>
      <p>We have been building software for over a decade and care deeply about quality.</p>
      <p>Our team spans three continents and ships every week.</p>
      <nav><a href="/home">Home</a><a href="/about">About</a><a href="/blog">Blog</a><a href="/contact">Contact</a></nav>
      </body></html>`;
    expect(looksJsRendered(html)).toBe(false);
  });

  it('does NOT false-positive on a content-rich long article with only 1-2 links', () => {
    // CONSERVATIVE check: lots of real text but few links must NOT be treated as a SPA
    // shell — flagging it would wrongly suppress genuine orphan findings.
    const body = 'This is a long-form essay. '.repeat(80); // ~2300 chars of real prose
    const html = `<html><head><title>Essay</title></head><body>
      <article><h1>A Long Read</h1><p>${body}</p>
      <p>For more, <a href="/next">read the sequel</a>.</p></article>
      </body></html>`;
    expect(looksJsRendered(html)).toBe(false);
  });

  it('does NOT flag empty or tiny HTML (too little to judge a SPA shell)', () => {
    expect(looksJsRendered('')).toBe(false);
    expect(looksJsRendered('<html><body></body></html>')).toBe(false);
    expect(looksJsRendered('<p>hi</p>')).toBe(false);
  });

  it('does NOT flag a mount node that already has rendered children (SSR/SSG output)', () => {
    // A populated #root (e.g. Next.js SSR / Gatsby SSG) is server-rendered HTML, not a
    // blank SPA shell — its links are real and must be honored.
    const html = `<html><body><div id="root">
      <header><a href="/a">A</a><a href="/b">B</a><a href="/c">C</a></header>
      <main><p>Real server-rendered content that is plenty long to count as visible.</p></main>
      </div></body></html>`;
    expect(looksJsRendered(html)).toBe(false);
  });
});

describe('looksJsRendered — weak-shell guardrails (A4 false-positive fixes)', () => {
  // A long inline stylesheet, the kind a design-heavy static homepage ships. The whole point
  // of these cases: heavy non-content markup must NOT trick the detector into calling a
  // genuinely STATIC page "JS-rendered" (which would suppress real orphan findings site-wide).
  const CSS = `<style>${'.x{color:red;margin:0;padding:0;border:1px solid #000;background:#fff;}'.repeat(30)}</style>`;

  it('does NOT flag a SCRIPT-FREE page (no JS at all cannot be a SPA) even if sparse + CSS-heavy', () => {
    // No <script> anywhere → the page literally cannot be client-rendered. The old ratio-only
    // weak combo flagged this (tiny text vs huge inline CSS, <3 links); it must not.
    const html = `<!doctype html><html><head><title>Studio</title>${CSS}</head>
      <body><div class="hero"><div class="logo">S</div><a href="/work">Work</a></div></body></html>`;
    expect(looksJsRendered(html)).toBe(false);
  });

  it('does NOT flag a CSS-heavy splash that still has real content (an <h1>), even with a bundle', () => {
    const html = `<!doctype html><html><head><title>Agency</title>${CSS}</head>
      <body><main><h1>We craft brands</h1><a href="/work">Work</a></main>
      <script src="/bundle.js"></script></body></html>`;
    expect(looksJsRendered(html)).toBe(false);
  });

  it('does NOT flag an image gallery (content elements present) with few nav links + a bundle', () => {
    const imgs = '<img src="/p.jpg" alt="">'.repeat(8);
    const html = `<!doctype html><html><head>${CSS}</head>
      <body><div class="grid">${imgs}</div><nav><a href="/">Home</a><a href="/about">About</a></nav>
      <script src="/gallery.js"></script></body></html>`;
    expect(looksJsRendered(html)).toBe(false);
  });

  it('does NOT flag a video/iframe landing page (the iframe is real content) + a bundle', () => {
    const html = `<!doctype html><html><head>${CSS}</head>
      <body><iframe src="https://player.example/v/123"></iframe><a href="/more">More</a>
      <script src="/player.js"></script></body></html>`;
    expect(looksJsRendered(html)).toBe(false);
  });

  it('DOES flag a blank shell with a non-standard mount id + a JS bundle (custom-SPA coverage)', () => {
    // #application is not one of the well-known ids in signal (a), and there's no noscript
    // notice, so only the weak-shell path can catch it: an empty body that ships a bundle.
    const html = `<!doctype html><html><head><title>App</title></head>
      <body><div id="application"></div><script src="/app.js"></script></body></html>`;
    expect(looksJsRendered(html)).toBe(true);
  });

  it('does NOT flag once there are >= 3 links (a real nav, not a shell) — pins the link gate', () => {
    const html = `<!doctype html><html><head>${CSS}</head>
      <body><div id="shell"></div><a href="/a">a</a><a href="/b">b</a><a href="/c">c</a>
      <script src="/x.js"></script></body></html>`;
    expect(looksJsRendered(html)).toBe(false);
  });

  it('does NOT flag a content-free body that still carries real text (>= 64 chars) + a bundle — pins the upper text bound', () => {
    // No content elements (the copy lives in bare <div>/<span>), a script bundle, and < 3 links —
    // but ~80 chars of real prose. A blank SPA shell has almost no text; a maintenance / coming-soon
    // interstitial does, so it must NOT be called JS-rendered. Removing or loosening the
    // MAX_SHELL_TEXT gate would wrongly flag this (it returns true with that gate neutered).
    const text = 'We are performing scheduled maintenance and will be back online shortly. Thanks!';
    const html = `<!doctype html><html><head><title>Maintenance</title></head>
      <body><div class="wrap"><span>${text}</span></div><a href="/status">Status</a>
      <script src="/analytics.js"></script></body></html>`;
    expect(looksJsRendered(html)).toBe(false);
  });

  it('DOES flag a blank shell whose only text is a short loading message (< 64 chars) + a bundle — pins the lower text bound', () => {
    // A real SPA shell (non-standard mount id, so signal (a) misses it) often shows a brief
    // "Loading…" before hydration; that short text must not exempt it. Over-tightening
    // MAX_SHELL_TEXT would miss this genuine shell.
    const html = `<!doctype html><html><head><title>App</title></head>
      <body><div id="app-mount"><span>Loading…</span></div><script src="/app.js"></script></body></html>`;
    expect(looksJsRendered(html)).toBe(true);
  });
});
