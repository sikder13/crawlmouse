import { describe, it, expect } from 'vitest';
import { htmlEscape } from './html-escape';

describe('htmlEscape', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(htmlEscape(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('escapes & first so existing entities are not double-decoded', () => {
    expect(htmlEscape('a&lt;b')).toBe('a&amp;lt;b');
  });

  it('neutralizes a script-tag injection attempt', () => {
    expect(htmlEscape('</span><script>alert(1)</script>')).toBe(
      '&lt;/span&gt;&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('neutralizes an attribute-breakout injection attempt', () => {
    // A malicious "domain" trying to break out of an href="..." attribute.
    expect(htmlEscape('"><img src=x onerror=alert(1)>')).toBe(
      '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;',
    );
  });

  it('leaves a benign hostname untouched', () => {
    expect(htmlEscape('shop.example-store.com')).toBe('shop.example-store.com');
  });

  it('returns an empty string unchanged', () => {
    expect(htmlEscape('')).toBe('');
  });
});
