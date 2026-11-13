import { describe, expect, it } from 'vitest';
import { buildOutgoing } from '../headers';
import {
  amountText,
  FOUNDER_EVENT_KINDS,
  founderEvent,
  founderOverflow,
  internalAccountUrl,
  invoiceFact,
  type FounderEventInput,
  type InvoiceFact,
} from './founder-event';
import { foreignTargets, htmlTargets } from './inspect';

const ACCOUNT = 'a0000000-0000-4000-8000-0000000000aa';
const OWNER = ['owner', 'shop.example'].join('@');
const HOSTILE = '<script>x</script>"\'&\r\nBcc: victim@example.com https://evil.example/';

const event = (over: Partial<FounderEventInput> = {}): FounderEventInput => ({
  kind: 'payment',
  internal: false,
  accountId: ACCOUNT,
  plan: 'pro',
  payment: 'first',
  amount: { minor: 1900, currency: 'usd', status: 'paid' },
  host: 'shop.example',
  ownerEmail: OWNER,
  occurredAt: '2026-11-13T12:00:00.000Z',
  ...over,
});

describe('founderEvent', () => {
  it('names the event, the plan, Stripe’s amount, the site, the owner and the console link', () => {
    const m = founderEvent(event());
    expect(m.subject).toBe('First payment: Pro');
    for (const part of [m.text, m.html]) {
      expect(part).toContain('Amount: $19.00');
      expect(part).toContain('Site: shop.example');
      expect(part).toContain('2026-11-13T12:00:00.000Z');
    }
    expect(m.text).toContain(`Owner: ${OWNER}`);
    expect(m.text).toContain(`Account: https://crawlmouse.com/internal/accounts/${ACCOUNT}`);
    expect(htmlTargets(m.html)).toEqual([`https://crawlmouse.com/internal/accounts/${ACCOUNT}`]);
  });

  it('marks an internal account’s notice [TEST] and says it is left out of the digests', () => {
    const m = founderEvent(event({ internal: true }));
    expect(m.subject).toBe('[TEST] First payment: Pro');
    expect(m.text).toContain('marked internal');
    expect(founderEvent(event()).subject).not.toContain('[TEST]');
  });

  it('words each kind, and a payment by what the history said', () => {
    const subjects = FOUNDER_EVENT_KINDS.map(
      (kind) => founderEvent(event({ kind, plan: null, payment: undefined })).subject,
    );
    expect(subjects).toEqual([
      'New sign-up',
      'Trial started',
      'Payment',
      'Payment failed',
      'Cancellation',
      'Agency account created',
    ]);
    expect(founderEvent(event({ payment: 'returning', plan: 'agency' })).subject).toBe(
      'Payment (returning): Agency',
    );
    expect(founderEvent(event({ payment: 'unknown' })).subject).toBe('Payment: Pro');
  });

  it('says whether Stripe’s invoice is paid: paid, or due and not yet paid with its status (review C3)', () => {
    expect(founderEvent(event()).text).toContain('Amount: $19.00 paid');
    for (const status of ['open', 'draft'] as const) {
      const text = founderEvent(event({ amount: { minor: 1900, currency: 'usd', status } })).text;
      expect(text).toContain(`Amount: $19.00 due, not yet paid (Stripe invoice status: ${status})`);
      expect(text).not.toContain('$19.00 paid');
    }
    expect(
      founderEvent(event({ amount: { minor: 1900, currency: 'usd', status: null } })).text,
    ).toContain('Amount: $19.00 due, not yet paid (Stripe invoice status: not given)');
  });

  it('heads a payment whose invoice is not paid as a plan start, saying which (review N4)', () => {
    const at = (status: 'open' | 'draft' | null, payment: FounderEventInput['payment']) =>
      founderEvent(event({ payment, amount: { minor: 1900, currency: 'usd', status } }));
    expect(at('open', 'first').subject).toBe('Plan started: Pro — first invoice not yet paid');
    expect(at('draft', 'returning').subject).toBe('Plan started: Pro — invoice not yet paid');
    expect(at(null, 'unknown').subject).toBe('Plan started: Pro — invoice not yet paid');
    for (const amount of [null, undefined])
      expect(founderEvent(event({ amount })).subject).toBe(
        'Plan started: Pro — invoice not read from Stripe',
      );
    expect(founderEvent(event({ internal: true, amount: null, plan: null })).subject).toBe(
      '[TEST] Plan started — invoice not read from Stripe',
    );
    const m = at('open', 'first');
    expect(m.text.split('\n')[0]).toBe('Plan started: Pro — first invoice not yet paid');
    expect(`${m.subject}\n${m.text}`).not.toMatch(/payment/i);
    // A paid one is a payment; a failed one is headed as before.
    expect(at(null, 'first').subject).not.toContain('First payment');
    expect(founderEvent(event()).subject).toBe('First payment: Pro');
    expect(founderEvent(event({ kind: 'payment_failed', amount: null })).subject).toBe(
      'Payment failed: Pro',
    );
  });

  it('records what Stripe said of the invoice: its status, not_given, or not_read (review N4)', () => {
    expect(invoiceFact({ minor: 1, currency: 'usd', status: 'paid' })).toBe('paid');
    expect(invoiceFact({ minor: 1, currency: 'usd', status: 'open' })).toBe('open');
    expect(invoiceFact({ minor: 1, currency: 'usd', status: null })).toBe('not_given');
    expect(invoiceFact(null)).toBe('not_read');
    expect(invoiceFact(undefined)).toBe('not_read');
  });

  it('shows an amount only for payments, and says when Stripe’s was not read', () => {
    expect(founderEvent(event({ kind: 'signup', plan: null })).text).not.toContain('Amount');
    expect(founderEvent(event({ amount: null })).text).toContain('Amount: not read from Stripe');
    expect(
      founderEvent(
        event({ kind: 'payment_failed', amount: { minor: 1.5, currency: 'usd', status: 'open' } }),
      ).text,
    ).toContain('Amount: not read from Stripe');
  });

  it('formats Stripe’s minor units by the currency’s own decimals', () => {
    expect(amountText({ minor: 1900, currency: 'usd' })).toBe('$19.00');
    expect(amountText({ minor: 19000, currency: 'eur' })).toBe('€190.00');
    expect(amountText({ minor: 1900, currency: 'jpy' })).toBe('¥1,900');
    expect(amountText({ minor: 0, currency: 'usd' })).toBe('$0.00');
    expect(amountText({ minor: 1.5, currency: 'usd' })).toBeNull();
    expect(amountText({ minor: 1900, currency: 'US$' })).toBeNull();
    expect(amountText({ minor: 1900, currency: 'USD' })).toBeNull();
  });

  it('says what it does not know rather than leaving a gap', () => {
    const m = founderEvent(event({ accountId: null, host: null, ownerEmail: null }));
    expect(m.text).toContain('Account: not known');
    expect(m.text).toContain('Site: none yet');
    expect(m.text).toContain('Owner: not known');
    expect(htmlTargets(m.html)).toEqual([]);
    // An id that is not one is not linked.
    expect(htmlTargets(founderEvent(event({ accountId: '../x' })).html)).toEqual([]);
  });

  it('escapes, bounds and folds the host and the address, and links neither', () => {
    const m = founderEvent(event({ host: HOSTILE.repeat(20), ownerEmail: HOSTILE.repeat(20) }));
    expect(m.html).not.toContain('<script>');
    expect(foreignTargets(m)).toEqual([]);
    expect(() =>
      buildOutgoing({ to: 'a@example.com', mail: m, idempotencyKey: 'founder_event:x' }),
    ).not.toThrow();
    // The text part keeps each outside value on its own line.
    expect(m.text.split('\n').filter((l) => l.startsWith('Bcc:'))).toEqual([]);
  });

  it('carries no card field', () => {
    for (const kind of FOUNDER_EVENT_KINDS) {
      const m = founderEvent(event({ kind }));
      // The layout's own markup names a `card` class; the words a reader sees are what is read.
      const shown = m.html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ');
      for (const part of [m.subject, m.text, shown]) expect(part).not.toMatch(/card|last ?4/i);
    }
  });

  it('refuses to link an id that is not an account id', () => {
    expect(() => internalAccountUrl('../../evil')).toThrow(RangeError);
  });
});

describe('founderOverflow', () => {
  const row = (n: number, internal = false) => ({
    kind: 'signup' as const,
    accountId: `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    internal,
  });

  it('says how many, and lists each held notice’s kind and console link', () => {
    const m = founderOverflow({ total: 2, rows: [row(1), row(2, true)] });
    expect(m.subject).toBe('2 more notices in the last hour');
    expect(m.text).toContain(
      '- New sign-up: https://crawlmouse.com/internal/accounts/a0000000-0000-4000-8000-000000000001',
    );
    expect(m.text).toContain('- [TEST] New sign-up: https://crawlmouse.com/internal/accounts/');
    expect(htmlTargets(m.html)).toHaveLength(2);
    expect(m.text).not.toContain('not listed');
  });

  it('says how many it does not list when the take was bounded', () => {
    const m = founderOverflow({ total: 7, rows: [row(1), row(2)] });
    expect(m.subject).toBe('7 more notices in the last hour');
    expect(m.text).toContain('5 more are not listed here');
    expect(founderOverflow({ total: 3, rows: [row(1), row(2)] }).text).toContain(
      '1 more is not listed here',
    );
  });

  it('lists a held payment as a payment only when its invoice was paid (review N4)', () => {
    const pay = (invoice?: InvoiceFact | null) => ({
      ...row(1),
      kind: 'payment' as const,
      invoice,
    });
    const m = founderOverflow({
      total: 5,
      rows: [pay('paid'), pay('open'), pay('not_given'), pay('not_read'), pay(undefined)],
    });
    expect(
      m.text
        .split('\n')
        .filter((l) => l.startsWith('- '))
        .map((l) => l.split(': ')[0]),
    ).toEqual([
      '- Payment',
      '- Plan started, invoice not yet paid',
      '- Plan started, invoice not yet paid',
      '- Plan started, invoice not read from Stripe',
      '- Plan started, invoice not read from Stripe',
    ]);
  });

  it('is [TEST] only when every held notice is an internal account’s', () => {
    expect(founderOverflow({ total: 1, rows: [row(1, true)] }).subject).toBe(
      '[TEST] 1 more notice in the last hour',
    );
    expect(founderOverflow({ total: 2, rows: [row(1, true)] }).subject).not.toContain('[TEST]');
    expect(founderOverflow({ total: 2, rows: [row(1, true), row(2)] }).subject).not.toContain(
      '[TEST]',
    );
  });
});
