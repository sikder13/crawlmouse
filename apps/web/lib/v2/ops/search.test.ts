import { describe, expect, it } from 'vitest';
import { classifyQuery } from './search';

const at = (local: string, domain: string) => [local, domain].join('@');

describe('classifyQuery decides the kind by shape', () => {
  it('a uuid, in any case, is an id', () => {
    expect(classifyQuery(' 6F1C2A8E-0000-4000-8000-00000000000A ')).toEqual({
      kind: 'id',
      id: '6f1c2a8e-0000-4000-8000-00000000000a',
    });
  });

  it('a cus_ id is a Stripe customer', () => {
    expect(classifyQuery('cus_AbC123')).toEqual({
      kind: 'stripe_customer',
      customerId: 'cus_AbC123',
    });
  });

  it('a cus_ prefix with anything else in it is not one', () => {
    expect(classifyQuery('cus_Ab-C').kind).not.toBe('stripe_customer');
    expect(classifyQuery('cus_').kind).not.toBe('stripe_customer');
  });

  it('a string with an @ is an address, lower-cased', () => {
    expect(classifyQuery(` ${at('Pat', 'Example.COM')} `)).toEqual({
      kind: 'email',
      email: at('pat', 'example.com'),
    });
  });

  it('an @ in the wrong shape is nothing, never a host', () => {
    for (const q of [at('', 'example.com'), at('a', ''), `${at('a', 'b')}@c`, 'a @b.com'])
      expect(classifyQuery(q), q).toEqual({ kind: 'none' });
  });

  it('anything else is a host, through the sign-up form normaliser', () => {
    expect(classifyQuery('https://WWW.Example.com/path?x=1')).toEqual({
      kind: 'host',
      host: 'www.example.com',
    });
    expect(classifyQuery('example.com.')).toEqual({ kind: 'host', host: 'example.com' });
  });

  it('something that is no host is nothing', () => {
    for (const q of ['', '   ', 'not a host', 'localhost', 'ftp://example.com'])
      expect(classifyQuery(q), q).toEqual({ kind: 'none' });
  });

  it('a query longer than 320 characters is nothing', () => {
    expect(classifyQuery(`${'a'.repeat(320)}.com`)).toEqual({ kind: 'none' });
  });
});
