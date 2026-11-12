import { describe, expect, it } from 'vitest';
import type { PageResult } from '@crawlmouse/types/v2';
import { readAt, servedAt } from './served-at.js';

const facts = (url: string, final_url: string | null) => ({
  pages: new Map([[url, { url, final_url } as PageResult]]),
});

describe('servedAt', () => {
  it('is the slashed address when the server redirects the page to it', () => {
    expect(servedAt(facts('https://wp.test/p', 'https://wp.test/p/'), 'https://wp.test/p')).toBe(
      'https://wp.test/p/',
    );
  });

  it('is the page’s own URL when the request landed on another page', () => {
    expect(servedAt(facts('https://a.test/old', 'https://a.test/new'), 'https://a.test/old')).toBe(
      'https://a.test/old',
    );
  });

  it('is the page’s own URL when the address that answered carries credentials', () => {
    expect(servedAt(facts('https://a.test/p', 'https://x@a.test/p/'), 'https://a.test/p')).toBe(
      'https://a.test/p',
    );
  });

  it('is the page’s own URL when nothing answered, or the check holds no row for it', () => {
    expect(servedAt(facts('https://a.test/p', null), 'https://a.test/p')).toBe('https://a.test/p');
    expect(servedAt({ pages: new Map() }, 'https://a.test/q')).toBe('https://a.test/q');
  });
});

describe('readAt', () => {
  const row = (url: string, final_url: string | null, status_code: number) => ({
    pages: new Map([[url, { url, final_url, status_code } as PageResult]]),
  });

  it('is where the request ended, when that answered 200: a homepage that redirects to /en/', () => {
    expect(readAt(row('https://a.test', 'https://a.test/en/', 200), 'https://a.test')).toBe(
      'https://a.test/en/',
    );
  });

  it('is the served address when the request ended in anything but a 200, or nowhere', () => {
    expect(readAt(row('https://a.test/p', 'https://a.test/gone', 404), 'https://a.test/p')).toBe(
      'https://a.test/p',
    );
    expect(readAt(row('https://a.test/p', null, 200), 'https://a.test/p')).toBe('https://a.test/p');
  });

  it('never returns an address with credentials or another scheme', () => {
    expect(readAt(row('https://a.test/p', 'https://x@b.test/p', 200), 'https://a.test/p')).toBe(
      'https://a.test/p',
    );
    expect(readAt(row('https://a.test/p', 'ftp://b.test/p', 200), 'https://a.test/p')).toBe(
      'https://a.test/p',
    );
  });
});
