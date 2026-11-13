/**
 * The support link (CC-33 D5): one `mailto:` to the support address, whose subject is fixed copy and
 * whose body carries only the ids the page has. The property holds for any string in any field: the
 * link names one recipient, carries a subject and a body and nothing else, and no value can add a
 * line, a header or an address.
 */
import { FixTypeSchema } from '@crawlmouse/types/v2';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SUPPORT_EMAIL } from '../../../components/v2/footer-links';
import { SUPPORT_COPY } from '../copy/support';
import { idsInPath, supportMailto, type SupportRequest, type SupportTopic } from './mailto';

const UUID = '0b0e7a52-5f0b-4b53-9c0e-0d4a3a1f2c11';
const OTHER = 'a0000000-0000-4000-8000-00000000000a';
const EVENT = '4f0b6c1d2e3a4b5c6d7e8f9a0b1c2d3e';
const TOPICS: readonly SupportTopic[] = ['general', 'error', 'fix'];

/** The link's parts, read the way a mail client reads them. */
function parts(href: string) {
  expect(href.startsWith('mailto:')).toBe(true);
  const url = new URL(href);
  const query = href.includes('?') ? href.slice(href.indexOf('?') + 1) : '';
  return {
    url,
    names: [...url.searchParams.keys()],
    rawPairs: query === '' ? [] : query.split('&'),
    subject: url.searchParams.get('subject') ?? '',
    body: url.searchParams.get('body') ?? '',
  };
}

// Independent of the module: the label each field is written under, and what a value must look like.
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINES: Record<string, RegExp> = {
  Page: /^\/[A-Za-z0-9/_.-]{0,200}$/,
  Account: ID,
  Site: ID,
  Check: ID,
  Fix: ID,
  'Fix type': new RegExp(`^(?:${FixTypeSchema.options.join('|')})$`),
  Reference: /^[0-9a-f]{32}$/i,
};

/** Each line of the body is a fixed line, a blank, or `Label: value` with a value its field accepts. */
function strangeLines(body: string): string[] {
  const fixed = new Set<string>(['', ...TOPICS.map((t) => SUPPORT_COPY.mail.prompt[t])]);
  return body.split('\r\n').filter((line) => {
    if (fixed.has(line)) return false;
    const m = /^([A-Za-z ]+): (.*)$/.exec(line);
    return !(m && Object.hasOwn(LINES, m[1]!) && LINES[m[1]!]!.test(m[2]!));
  });
}

describe('supportMailto', () => {
  it('writes each id the page has, under its label, and the fixed prompt', () => {
    const href = supportMailto({
      topic: 'fix',
      path: `/audit/${UUID}/fix/${OTHER}`,
      accountId: OTHER,
      siteId: UUID,
      checkId: UUID,
      fixId: OTHER,
      fixType: 'orphan_pages',
      eventId: EVENT,
    });
    const p = parts(href);
    expect(p.url.pathname).toBe(SUPPORT_EMAIL);
    expect(p.names).toEqual(['subject', 'body']);
    expect(p.subject).toBe(SUPPORT_COPY.mail.subject.fix);
    expect(p.body.split('\r\n')).toEqual([
      `Page: /audit/${UUID}/fix/${OTHER}`,
      `Account: ${OTHER}`,
      `Site: ${UUID}`,
      `Check: ${UUID}`,
      `Fix: ${OTHER}`,
      'Fix type: orphan_pages',
      `Reference: ${EVENT}`,
      '',
      SUPPORT_COPY.mail.prompt.fix,
      '',
    ]);
  });

  it('leaves out an id the page does not have', () => {
    const { body } = parts(supportMailto({ topic: 'general', path: '/settings', accountId: UUID }));
    expect(body.split('\r\n')).toEqual([
      'Page: /settings',
      `Account: ${UUID}`,
      '',
      SUPPORT_COPY.mail.prompt.general,
      '',
    ]);
  });

  it.each([
    ['path', { path: '/sites/x\r\nBcc: someone@example.test' }],
    ['path', { path: 'https://elsewhere.test/' }],
    ['path', { path: '/sites/a b' }],
    ['path', { path: `/${'a'.repeat(201)}` }],
    ['accountId', { accountId: `${UUID}\n` }],
    ['siteId', { siteId: 'not-an-id' }],
    ['checkId', { checkId: `${UUID}&cc=x` }],
    ['fixId', { fixId: UUID.slice(1) }],
    ['fixType', { fixType: 'orphan_pages\r\nTo: x' }],
    ['fixType', { fixType: 'toString' }],
    ['eventId', { eventId: `${EVENT}0` }],
  ] as const)('drops a %s that is not of its shape, rather than escaping it', (_field, bad) => {
    const input = { topic: 'error', path: '/alerts', ...bad } as SupportRequest;
    const { body } = parts(supportMailto(input));
    const values = Object.values(bad) as string[];
    for (const v of values) expect(body).not.toContain(v);
    expect(strangeLines(body)).toEqual([]);
  });

  it('reads an unknown topic as a general question', () => {
    const p = parts(supportMailto({ topic: 'x' as SupportTopic, path: '/' }));
    expect(p.subject).toBe(SUPPORT_COPY.mail.subject.general);
  });

  // Plan review M12: arbitrary strings, binary included, mixed with the strings an attacker reaches
  // for first; and the same strings appended to a value that would pass.
  const INJECTIONS = fc.constantFrom(
    '\r\n',
    '\n',
    '\r',
    '%0D%0A',
    '%0a',
    '&cc=x',
    '?bcc=x',
    '@',
    ',',
    ' ',
    '\u00a0',
    '\u2028',
    '\u0000',
  );
  const anyString = fc.oneof(
    fc.string({ unit: 'binary' }),
    INJECTIONS,
    fc.tuple(fc.constantFrom(UUID, EVENT, '/settings', 'orphan_pages'), INJECTIONS).map(
      ([a, b]) => a + b,
    ),
    fc.tuple(INJECTIONS, fc.constantFrom(UUID, EVENT, '/settings')).map(([a, b]) => a + b),
  );
  const field = fc.option(fc.oneof(anyString, fc.constantFrom(UUID, EVENT, '/sites')), {
    nil: undefined,
  });
  const request = fc.record({
    topic: fc.oneof(fc.constantFrom(...TOPICS), anyString) as fc.Arbitrary<SupportTopic>,
    path: fc.oneof(anyString, fc.constantFrom('/', '/settings', `/sites/${UUID}`)),
    accountId: field,
    siteId: field,
    checkId: field,
    fixId: field,
    fixType: field,
    eventId: field,
  });

  it('for any input: one recipient, a subject and a body, and no line, header or address added', () => {
    fc.assert(
      fc.property(request, (input) => {
        const href = supportMailto(input);
        const p = parts(href);
        expect(p.url.protocol).toBe('mailto:');
        expect(p.url.pathname).toBe(SUPPORT_EMAIL);
        expect(href.slice('mailto:'.length).split('?')[0]).toBe(SUPPORT_EMAIL);
        expect(p.names.every((n) => n === 'subject' || n === 'body')).toBe(true);
        expect(new Set(p.names).size).toBe(p.names.length);
        // Each value is encoded, so the query splits into exactly the two pairs.
        expect(p.rawPairs.map((pair) => pair.split('=')[0])).toEqual(p.names);
        expect(href.split('?')).toHaveLength(2);
        expect(p.subject).not.toMatch(/[\r\n\u2028\u2029]/);
        expect(p.rawPairs.find((x) => x.startsWith('subject='))).not.toMatch(/%0[AD]/i);
        expect(`${p.subject}\n${p.body}`).not.toContain('@');
        expect(strangeLines(p.body)).toEqual([]);
      }),
      { numRuns: 500 },
    );
  });
});

describe('idsInPath', () => {
  it('reads the site id of a site page, and nothing from other paths', () => {
    expect(idsInPath(`/sites/${UUID}`)).toEqual({ siteId: UUID });
    expect(idsInPath(`/sites/${UUID}/x`)).toEqual({ siteId: UUID });
    expect(idsInPath('/sites/not-an-id')).toEqual({});
    expect(idsInPath(`/x/sites/${UUID}`)).toEqual({});
    expect(idsInPath('/alerts')).toEqual({});
    expect(idsInPath(null)).toEqual({});
  });
});
