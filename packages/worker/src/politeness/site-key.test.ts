import { describe, expect, it } from 'vitest';
import { siteKeyOf } from './site-key.js';

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
