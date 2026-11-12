import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { commandOf, crawledWord, int, sh, url, word, type Word } from './shell.js';
import { clean } from './text.js';
import { hostileText } from './test-support/hostile.js';

const run = promisify(execFile);
/** What the shell passes on when `w` is one argument of a command. */
const printed = async (w: Word) =>
  (await run('sh', ['-c', commandOf(sh`printf '%s' ${w}`)])).stdout;

describe('sh', () => {
  it('joins our words and quoted values', () => {
    const c = sh`curl -sS -A ${word('GPTBot/1.4')} ${url('https://a.test/x?y=1')} | grep -q ${word('<h1')}`;
    expect(commandOf(c)).toBe("curl -sS -A 'GPTBot/1.4' 'https://a.test/x?y=1' | grep -q '<h1'");
  });

  it('refuses a value this module did not make', () => {
    expect(() => sh`curl ${{ word: '$(reboot)' } as Word}`).toThrow(/only words made by/);
  });

  it('refuses a line break in our own words', () => {
    expect(
      () => sh`curl
-s`,
    ).toThrow(/one line/);
  });
});

describe('url', () => {
  it('percent-encodes what would end the quote or draw a code span', () => {
    expect(url("https://a.test/it's?q=`x` y").word).toBe("'https://a.test/it%27s?q=%60x%60%20y'");
  });

  it('percent-encodes what curl would read as a range or a set, and leaves an IPv6 host alone', () => {
    expect(url('https://a.test/list/p[1-3]?x={a,b}').word).toBe(
      "'https://a.test/list/p%5B1-3%5D?x=%7Ba,b%7D'",
    );
    expect(url('http://[::1]:8080/a[b]').word).toBe("'http://[::1]:8080/a%5Bb%5D'");
  });

  it('refuses a scheme a record cannot hold', () => {
    expect(() => url('file:///etc/passwd')).toThrow(/http or https/);
    expect(() => url('javascript:alert(1)')).toThrow(/http or https/);
  });

  it('reaches the shell as one argument, whatever the path and query hold (property)', async () => {
    await fc.assert(
      fc.asyncProperty(hostileText(4), hostileText(4), async (path, query) => {
        let crawled: string;
        try {
          crawled = new URL(`https://a.test/${path}?q=${query}`).href;
        } catch {
          return;
        }
        const w = url(crawled);
        expect(w.word).toMatch(/^'[A-Za-z0-9\-._~:/?#[\]@!$&()*+,;=%]*'$/);
        expect(await printed(w)).toBe(w.word.slice(1, -1));
      }),
      { numRuns: 60 },
    );
  });
});

describe('word, crawledWord, int', () => {
  it('writes an apostrophe of ours so the shell reads it as one', async () => {
    expect(await printed(word("it's"))).toBe("it's");
  });

  it('throws on a control character in a word of ours', () => {
    expect(() => word('a\nb')).toThrow();
  });

  it('writes a whole number', () => {
    expect(int(200).word).toBe("'200'");
    expect(() => int(0.5)).toThrow();
  });

  it('passes crawled text to the shell as its cleaned self and runs none of it (property)', async () => {
    await fc.assert(
      fc.asyncProperty(hostileText(), async (crawled) => {
        expect(await printed(crawledWord(crawled, 500))).toBe(
          [...clean(crawled)].slice(0, 500).join(''),
        );
      }),
      { numRuns: 60 },
    );
  });
});
