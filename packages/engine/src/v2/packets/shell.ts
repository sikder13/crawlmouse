/**
 * The verify command of a packet: one line a developer pastes into a POSIX shell.
 *
 * `sh` is a tagged template. The words the template holds are this repository's; every value put into
 * them is a single-quoted shell word made here, so nothing in a value is read by the shell:
 *
 *   - `url`: a crawled URL, re-serialised by the URL parser, with every character outside
 *     `URL_SAFE` percent-encoded. An apostrophe, a backtick, a space and a `$` are outside it.
 *   - `word`: text of ours (a user-agent string from the registry, a pattern we wrote). An apostrophe
 *     in it is written `'\''`; a control or invisible character throws.
 *   - `crawledWord`: crawled text that is not a URL, cleaned as a packet line cleans it (text.ts
 *     `clean`) and cut, then quoted the same way.
 */
import { clean, MAX_CRAWLED_CHARS } from './text.js';

/** The characters a URL in a command keeps as written: RFC 3986's unreserved and reserved sets, less the apostrophe, and `%`. */
const URL_UNSAFE = /[^A-Za-z0-9\-._~:/?#[\]@!$&()*+,;=%]/gu;

const made = new WeakSet<object>();

/** One single-quoted shell word. */
export interface Word {
  readonly word: string;
}
/** A verify command: one line. */
export interface Command {
  readonly command: string;
}

function quoted(text: string): Word {
  const value = Object.freeze({ word: `'${text.replaceAll("'", `'\\''`)}'` });
  made.add(value);
  return value;
}

const encoder = new TextEncoder();
const percent = (ch: string) =>
  [...encoder.encode(ch)].map((b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`).join('');

/** A crawled http or https URL as a shell word. Anything else throws: a record holds no other URL. */
export function url(crawled: string): Word {
  const parsed = new URL(crawled);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('packets: a verify command requests http or https only');
  }
  return quoted(parsed.href.replace(URL_UNSAFE, percent));
}

/** Text of ours as a shell word. */
export function word(text: string): Word {
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cs}\p{Cn}]/u.test(text)) {
    throw new Error('packets: a shell word of ours holds a control or invisible character');
  }
  return quoted(text);
}

/** Crawled text that is not a URL, as a shell word: cleaned, and cut to `max` code points. */
export function crawledWord(crawled: string, max: number = MAX_CRAWLED_CHARS): Word {
  return quoted([...clean(crawled)].slice(0, max).join(''));
}

/** A whole number as a shell word. */
export function int(n: number): Word {
  if (!Number.isSafeInteger(n)) throw new Error(`packets: ${n} is not a whole number`);
  return quoted(String(n));
}

/** A verify command, from this repository's words and quoted values. */
export function sh(parts: TemplateStringsArray, ...values: readonly Word[]): Command {
  let command = '';
  parts.forEach((part, i) => {
    if (/[\r\n]/.test(part)) throw new Error('packets: a verify command is one line');
    command += part;
    if (i < values.length) {
      const value = values[i];
      if (typeof value !== 'object' || value === null || !made.has(value)) {
        throw new Error(
          'packets: a command takes only words made by url, word, crawledWord or int',
        );
      }
      command += value.word;
    }
  });
  const value = Object.freeze({ command: command.trim() });
  made.add(value);
  return value;
}

/** The text of a command `sh` made; anything else throws. */
export function commandOf(value: Command): string {
  if (!made.has(value)) throw new Error('packets: not a command made by `sh`');
  return value.command;
}
