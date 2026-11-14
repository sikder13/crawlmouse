/**
 * Review r2 N-c: a value from the env file is registered by NAME LIST, not by guessing which names
 * look secret. Every value is registered at 4 characters or more unless its name is on the short
 * public list; a `TOKEN_ENV` value at any length; a received value keeps the 12-character floor.
 */
import { describe, expect, it } from 'vitest';
import {
  MASK,
  MIN_FILE_LENGTH,
  MIN_RECEIVED_LENGTH,
  PUBLIC_ENV,
  Redactor,
  TOKEN_ENV,
} from './redact';

const part = (...p: string[]) => p.join('');

describe('env-file values', () => {
  // Names the old token-name regex did not match, with short values.
  it.each([
    ['DB_PASS', part('hun', 'ter')],
    ['ADMIN_PWD', part('pw', '42')],
    ['BASIC_AUTH', part('u:', 'pw9')],
    ['SESSION_COOKIE', part('ck', '_77')],
    ['WEBHOOK_SIG', part('sig', '1')],
    ['CRAWL_WORKER_URL', part('http', 's://w')],
  ])('masks %s at 4 characters or more', (name, value) => {
    const r = new Redactor();
    r.addFileValue(name, value);
    expect(value.length).toBeGreaterThanOrEqual(MIN_FILE_LENGTH);
    expect(value.length).toBeLessThan(MIN_RECEIVED_LENGTH);
    expect(r.redact(`a ${value} b`)).toBe(`a ${MASK} b`);
  });

  it('leaves a value shorter than 4 characters under an ordinary name', () => {
    const r = new Redactor();
    r.addFileValue('WORKER_REGION', 'iad');
    expect(r.redact('region iad')).toBe('region iad');
  });

  it('masks a TOKEN_ENV value at any length', () => {
    for (const name of TOKEN_ENV) {
      const r = new Redactor();
      r.addFileValue(name, 'k9');
      expect(r.redact('x k9 y'), name).toBe(`x ${MASK} y`);
    }
  });

  it('never registers a value under a public name', () => {
    expect(PUBLIC_ENV).toEqual(expect.arrayContaining(['NODE_ENV', 'CRAWL_PAUSED', 'V2_PIPELINE']));
    const r = new Redactor();
    r.addFileValue('NODE_ENV', 'production');
    r.addFileValue('CRAWL_PAUSED', '1');
    r.addFileValue('V2_PIPELINE', 'true');
    expect(r.redact('the live production commit; true; 1')).toBe(
      'the live production commit; true; 1',
    );
  });

  it('keeps the 12-character floor for a received value', () => {
    const r = new Redactor();
    r.addReceived('a'.repeat(MIN_RECEIVED_LENGTH - 1));
    r.addReceived('b'.repeat(MIN_RECEIVED_LENGTH));
    expect(r.redact(`${'a'.repeat(11)} ${'b'.repeat(12)}`)).toBe(`${'a'.repeat(11)} ${MASK}`);
  });
});
