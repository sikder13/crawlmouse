import { describe, it, expect } from 'vitest';
import { classifyUrlKind, URL_KIND_RULES } from './page-kind.js';

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a §5.1 — the URL rule table.
//
// Every rule carries a POSITIVE and a NEGATIVE fixture, and the negatives are the point: the risk in
// this table is not missing a login page, it is excluding a real content page and deleting it from the
// grade. Rules match on PATH SEGMENT EQUALITY, never substring, because substring matching is what
// turns `/research` into a search page and `/about/accountability` into an account page.
//
// Rules must be GENERAL, not site-specific (§5.1). E5 named `/tweets/{id}` on one customer's site; the
// rule implemented is "a bare numeric-or-opaque id under a status-shaped parent segment", which has no
// customer in it and which `/products/12345` deliberately does not match.
// ─────────────────────────────────────────────────────────────────────────────

describe('§5.1 URL rules — positive fixtures', () => {
  const cases: [string, string][] = [
    ['https://s.test/login', 'auth'],
    ['https://s.test/cp/auth/login', 'auth'],          // E5: recommended as an orphan fix in production
    ['https://s.test/my-account/orders', 'auth'],
    ['https://s.test/cart', 'utility'],
    ['https://s.test/checkout/step-2', 'utility'],
    ['https://s.test/p?replytocom=42', 'utility'],
    ['https://s.test/search?q=shoes', 'search'],
    ['https://s.test/?s=shoes', 'search'],
    ['https://s.test/blog?query=x', 'search'],
    ['https://s.test/blog/page/2', 'pagination'],
    ['https://s.test/blog?paged=3', 'pagination'],
    ['https://s.test/shop?page=7', 'pagination'],
    ['https://s.test/tag/seo', 'archive'],
    ['https://s.test/category/news', 'archive'],
    ['https://s.test/author/jane', 'archive'],
    ['https://s.test/2026/03', 'archive'],
    ['https://s.test/feed', 'feed'],
    ['https://s.test/blog/feed', 'feed'],
    ['https://s.test/p?feed=rss2', 'feed'],
    ['https://s.test/tweets/1876554433221100', 'status'],  // E5
    ['https://s.test/status/1876554433221100', 'status'],
    ['https://s.test/notes/a1b2c3d4e5f6', 'status'],
  ];
  for (const [url, kind] of cases) {
    it(`classifies ${url} as ${kind}`, () => {
      expect(classifyUrlKind(url)).toBe(kind);
    });
  }
});

describe('§5.1 URL rules — the negatives that keep real pages gradeable', () => {
  const contentUrls = [
    'https://s.test/',
    'https://s.test/about',
    'https://s.test/contact',
    'https://s.test/about/accountability',            // contains "account" — segment equality saves it
    'https://s.test/products/shopping-cart-organizer', // contains "cart"
    'https://s.test/research',                         // contains "search"
    'https://s.test/blog/search-engine-basics',        // contains "search"
    'https://s.test/feedback',                         // contains "feed"
    'https://s.test/page/about',                       // "page" not followed by a number
    'https://s.test/blog/category-theory-explained',   // contains "category"
    'https://s.test/products/12345',                   // a bare id, but NOT under a status-shaped parent
    'https://s.test/blog/2026-launch-notes',           // a slug that starts with a year
    'https://s.test/blog/2026/03/12/my-post',          // a dated post WITH a slug is content, not archive
    'https://s.test/p?sort=price&page_size=20',        // `page_size` is not `page`
  ];
  for (const url of contentUrls) {
    it(`leaves ${url} unclassified, so it stays content`, () => {
      expect(classifyUrlKind(url)).toBeNull();
    });
  }
});

describe('§5.1 URL rules — table integrity', () => {
  it('is ORDERED and first-match-wins, so a URL matching two rules has one stable answer', () => {
    // `/cart` is both a utility segment and, with `?s=`, a search. Order decides, and the decision must
    // be a property of the table rather than of iteration order in the engine.
    expect(classifyUrlKind('https://s.test/cart?s=x')).toBe(classifyUrlKind('https://s.test/cart?s=x'));
    expect(classifyUrlKind('https://s.test/cart?s=x')).toBe('utility');
  });

  it('every rule in the table is reachable — none is shadowed by an earlier one', () => {
    // A shadowed rule is dead code that reads as coverage. Each rule ships a sample it alone must claim.
    for (const rule of URL_KIND_RULES) {
      expect(classifyUrlKind(rule.sample), `rule "${rule.id}" is shadowed; its sample resolves elsewhere`)
        .toBe(rule.kind);
    }
  });

  it('every rule carries a sample and a counter-sample, and the counter-sample stays content', () => {
    for (const rule of URL_KIND_RULES) {
      expect(rule.sample, `rule "${rule.id}" has no sample`).toBeTruthy();
      expect(rule.counterSample, `rule "${rule.id}" has no counter-sample`).toBeTruthy();
      expect(classifyUrlKind(rule.counterSample), `rule "${rule.id}" counter-sample was classified`).toBeNull();
    }
  });

  it('is total and never throws on hostile input', () => {
    expect(classifyUrlKind('not a url')).toBeNull();
    expect(classifyUrlKind('')).toBeNull();
    expect(classifyUrlKind('https://s.test/%%%')).toBeNull();
  });

  it('is case-insensitive on segments, because path case is a server choice not a semantic one', () => {
    expect(classifyUrlKind('https://s.test/Login')).toBe('auth');
    expect(classifyUrlKind('https://s.test/CART')).toBe('utility');
  });
});
