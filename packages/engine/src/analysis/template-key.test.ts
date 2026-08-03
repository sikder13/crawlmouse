import { describe, it, expect } from 'vitest';
import { templateKeyFor, TEMPLATE_SLUG_MIN_LEN } from './template-key.js';

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a §6.2 — stratum keys.
//
// CONTEXT-FREE BY NECESSITY, not by preference. The accurate approach genericises a path position once
// enough distinct sibling values have been observed — but then a URL's templateKey changes as discovery
// grows, and I6 ("the same URL + same HTML always yields the same PageKind and templateKey") fails by
// construction. I6 as written forbids the frequency rule, so this is a pure per-URL function and the
// cost is occasionally under-genericising a short-slug template.
// ─────────────────────────────────────────────────────────────────────────────

describe('§6.2 templateKeyFor', () => {
  const cases: [string, string][] = [
    ['https://s.test/event/soknalopet-2026', '/event/{slug}'],       // the spec's own example
    ['https://s.test/blog/2026/03/12/x-marks', '/blog/{n}/{n}/{n}/{slug}'],
    ['https://s.test/', '/'],
    ['https://s.test/about', '/about'],                               // depth 1 stays literal
    ['https://s.test/contact', '/contact'],
    ['https://s.test/products/12345', '/products/{n}'],
    ['https://s.test/u/550e8400-e29b-41d4-a716-446655440000', '/u/{uuid}'],
    ['https://s.test/p/a1b2c3d4e5f6a7b8', '/p/{id}'],                 // opaque hex
    ['https://s.test/shop/blue-widget', '/shop/{slug}'],              // hyphen ⇒ slug
    ['https://s.test/shop/averylongproductname', '/shop/{slug}'],     // long ⇒ slug
    ['https://s.test/shop/hats', '/shop/hats'],                       // short, no hyphen ⇒ literal
  ];
  for (const [url, key] of cases) {
    it(`${url} → ${key}`, () => expect(templateKeyFor(url)).toBe(key));
  }

  it('keeps depth-1 pages literal, so /about and /pricing are DIFFERENT strata', () => {
    // Genericising the top level would merge every top-level page into one stratum and let a single
    // quota decide whether /about or /pricing is crawled at all.
    expect(templateKeyFor('https://s.test/about')).not.toBe(templateKeyFor('https://s.test/pricing'));
  });

  it('groups siblings of one template together — the whole point of a stratum', () => {
    const a = templateKeyFor('https://s.test/event/oslo-marathon-2026');
    const b = templateKeyFor('https://s.test/event/bergen-half-2027');
    expect(a).toBe(b);
  });

  it('is a pure function of the URL: no dependence on what else was discovered (I6)', () => {
    const u = 'https://s.test/event/soknalopet-2026';
    expect(templateKeyFor(u)).toBe(templateKeyFor(u));
  });

  it('ignores the query string — a stratum is a path shape', () => {
    expect(templateKeyFor('https://s.test/shop/blue-widget?colour=navy')).toBe('/shop/{slug}');
  });

  it('applies the slug rule at exactly the documented length boundary', () => {
    // 'z' deliberately: a segment of only hex characters is an opaque id, so an 'a'-repeat vector
    // would test the id rule instead of the boundary it claims to test.
    const short = 'z'.repeat(TEMPLATE_SLUG_MIN_LEN - 1);
    const long = 'z'.repeat(TEMPLATE_SLUG_MIN_LEN);
    expect(templateKeyFor(`https://s.test/shop/${short}`)).toBe(`/shop/${short}`);
    expect(templateKeyFor(`https://s.test/shop/${long}`)).toBe('/shop/{slug}');
  });

  it('does NOT mistake an English word spelled in hex letters for an opaque id', () => {
    // `facade`, `decade`, `defaced` and `deadbeef` are all valid hex strings. Without the digit
    // requirement each would key as {id} and shred a real content template into per-page strata.
    expect(templateKeyFor('https://s.test/design/facade')).toBe('/design/facade');
    expect(templateKeyFor('https://s.test/history/deadbeef')).toBe('/history/deadbeef');
    // A genuine id still keys as one.
    expect(templateKeyFor('https://s.test/p/a1b2c3d4e5f6')).toBe('/p/{id}');
  });

  it('is total on hostile input', () => {
    expect(templateKeyFor('not a url')).toBe('/');
    expect(templateKeyFor('')).toBe('/');
  });

  it('is case-insensitive, matching the URL rules', () => {
    expect(templateKeyFor('https://s.test/Shop/Blue-Widget')).toBe(templateKeyFor('https://s.test/shop/blue-widget'));
  });
});
