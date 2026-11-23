import { describe, expect, it } from 'vitest';
import { politenessKeyOf, siteKeyOf } from './site-key.js';

describe('siteKeyOf', () => {
  it.each([
    ['https://www.nike.com/', 'nike.com'],
    ['https://nike.com/x', 'nike.com'],
    ['https://shop.example.co.uk/a', 'example.co.uk'],
    ['https://WWW.Example.COM./', 'example.com'],
    ['https://a.github.io/', 'a.github.io'],
    ['https://b.github.io/', 'b.github.io'],
    ['http://127.0.0.1:8080/', '127.0.0.1'],
    ['http://[::1]/', '::1'],
    ['http://localhost:3000/', 'localhost'],
  ])('%s -> %s', (url, key) => expect(siteKeyOf(url)).toBe(key));
});

describe('politenessKeyOf (F-018)', () => {
  const urls = [
    'https://a.lab.crawlmouse.com/',
    'https://www.nike.com/',
    'https://crawlmouse.com/',
    'http://127.0.0.1:8080/',
    'https://a.github.io/',
  ];

  it.each(urls)('with the setting off, %s keeps its registrable domain', (url) => {
    expect(politenessKeyOf(url, false)).toBe(siteKeyOf(url));
  });

  it.each([
    ['https://a.lab.crawlmouse.com/x', 'a.lab.crawlmouse.com'],
    ['https://b.lab.crawlmouse.com/', 'b.lab.crawlmouse.com'],
    ['https://A.LAB.Crawlmouse.COM./', 'a.lab.crawlmouse.com'],
    ['https://x.y.lab.crawlmouse.com/', 'x.y.lab.crawlmouse.com'],
  ])('with the setting on, %s is its own key', (url, key) => {
    expect(politenessKeyOf(url, true)).toBe(key);
  });

  it.each([
    ['https://lab.crawlmouse.com/', 'crawlmouse.com'],
    ['https://.lab.crawlmouse.com/', 'crawlmouse.com'],
    ['https://crawlmouse.com/', 'crawlmouse.com'],
    ['https://www.crawlmouse.com/', 'crawlmouse.com'],
    ['https://evil-lab.crawlmouse.com/', 'crawlmouse.com'],
    ['https://alab.crawlmouse.com/', 'crawlmouse.com'],
    ['https://a.lab.crawlmouse.com.evil.test/', 'evil.test'],
    ['https://a.lab.crawlmouse.org/', 'crawlmouse.org'],
    ['https://www.nike.com/', 'nike.com'],
  ])('with the setting on, %s keeps its registrable domain', (url, key) => {
    expect(politenessKeyOf(url, true)).toBe(key);
  });

  it('gives a host with an empty label no key of its own', () => {
    const url = 'https://a..lab.crawlmouse.com/';
    expect(politenessKeyOf(url, true)).toBe(siteKeyOf(url));
  });

  it('leaves "off-site" alone: two lab hosts are still one site to siteKeyOf', () => {
    expect(siteKeyOf('https://a.lab.crawlmouse.com/')).toBe(
      siteKeyOf('https://b.lab.crawlmouse.com/'),
    );
  });
});
