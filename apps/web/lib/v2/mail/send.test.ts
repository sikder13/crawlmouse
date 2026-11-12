import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { hashMailAddress } from './address-hash';
import { buildOutgoing, HeaderRefused, isPlainAddress, unsubscribeHeaders } from './headers';
import type { Claim, ClaimInput, MailLedger } from './ledger';
import { MailRetry, send, type MailDeps, type SendRequest } from './send';
import { resendTransport, type MailTransport, type TransportResult } from './transport';
import { ACCOUNT_KINDS, MAIL_KINDS, type OutgoingMail } from './types';

const PEPPER = 'p'.repeat(40);
const NOW = new Date('2026-11-13T10:00:00.000Z');

/**
 * An in-memory ledger with the migration's claim rule, minus time: a key is `sending` until finished,
 * `sent` after; three attempts. The real rule, leases and the two-transaction race are
 * __tests__/v2-028-mail.test.ts and scripts/db/mail-race.test.ts.
 */
function memoryLedger(suppressed: ReadonlySet<string> = new Set()) {
  const rows = new Map<string, { status: string; attempts: number }>();
  const claims: ClaimInput[] = [];
  const ledger: MailLedger = {
    async claim(c): Promise<Claim> {
      claims.push(c);
      const r = rows.get(c.key);
      if (!r) {
        if (!ACCOUNT_KINDS.has(c.kind) && suppressed.has(c.addressHash)) {
          rows.set(c.key, { status: 'suppressed', attempts: 0 });
          return { outcome: 'suppressed' };
        }
        rows.set(c.key, { status: 'sending', attempts: 1 });
        return { outcome: 'go', attempt: 1 };
      }
      if (r.status === 'sent') return { outcome: 'done' };
      if (r.status === 'suppressed') return { outcome: 'suppressed' };
      if (r.status === 'sending') return { outcome: 'busy' };
      if (r.attempts >= 3) return { outcome: 'exhausted' };
      r.status = 'sending';
      r.attempts += 1;
      return { outcome: 'go', attempt: r.attempts };
    },
    async finish(f) {
      const r = rows.get(f.key);
      if (!r || r.status !== 'sending') return false;
      r.status = f.status;
      return true;
    },
  };
  return { ledger, rows, claims };
}

function fakeTransport(results: TransportResult[] = [{ ok: true, providerId: 'msg_1' }]) {
  const sent: OutgoingMail[] = [];
  const transport: MailTransport = {
    async send(m) {
      sent.push(m);
      return results.length > 1 ? results.shift()! : results[0]!;
    },
  };
  return { transport, sent };
}

function deps(over: Partial<MailDeps> = {}) {
  const mem = memoryLedger();
  const t = fakeTransport();
  const log = vi.fn();
  const d: MailDeps = {
    ledger: mem.ledger,
    transport: t.transport,
    pepper: PEPPER,
    now: () => NOW,
    log,
    ...over,
  };
  return { d, mem, t, log };
}

const request = (over: Partial<SendRequest> = {}): SendRequest => ({
  kind: 'check_notify',
  to: 'someone@example.com',
  idempotencyKey: 'check_notify:c1',
  accountId: null,
  render: async () => ({
    subject: 'Your check of example.com finished',
    text: 't',
    html: '<p>t</p>',
  }),
  ...over,
});

describe('send: claim before send (D1)', () => {
  it('sends once for a retried event: the second call finds the key done', async () => {
    const { d, t } = deps();
    expect(await send(d, request())).toBe('sent');
    expect(await send(d, request())).toBe('done');
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]!.idempotencyKey).toBe('check_notify:c1');
  });

  it('claims with the peppered hash of the address, never the address', async () => {
    const { d, mem } = deps();
    await send(d, request({ to: 'Some.One+tag@Example.com' }));
    expect(mem.claims[0]!.addressHash).toBe(hashMailAddress(PEPPER, 'some.one+tag@example.com'));
    // A `+tag` is not folded away: a bounce on one tagged address must not suppress the plain one.
    expect(hashMailAddress(PEPPER, 'some.one+tag@example.com')).not.toBe(
      hashMailAddress(PEPPER, 'some.one@example.com'),
    );
    expect(JSON.stringify(mem.claims)).not.toMatch(/example\.com/i);
  });

  it('renders only after the claim answers go (an account link is minted inside render)', async () => {
    const { d, mem } = deps();
    const render = vi.fn(async () => ({ subject: 's', text: 't', html: 'h' }));
    mem.rows.set('k', { status: 'sent', attempts: 1 });
    expect(await send(d, request({ idempotencyKey: 'k', render }))).toBe('done');
    mem.rows.set('k2', { status: 'sending', attempts: 1 });
    await expect(send(d, request({ idempotencyKey: 'k2', render }))).rejects.toBeInstanceOf(
      MailRetry,
    );
    expect(render).not.toHaveBeenCalled();
  });

  it('claims nothing and logs when Resend or the pepper is not configured', async () => {
    for (const over of [{ transport: null }, { pepper: null }]) {
      const { d, mem, log } = deps(over);
      expect(await send(d, request())).toBe('unconfigured');
      expect(mem.claims).toHaveLength(0);
      expect(log).toHaveBeenCalledWith('mail.unconfigured', expect.any(Object));
    }
  });

  it('retries a retryable failure through the ledger, three attempts in all, then gives up and logs', async () => {
    const t = fakeTransport([{ ok: false, code: 'provider_500', retryable: true }]);
    const { d, log, mem } = deps({ transport: t.transport });
    for (let i = 0; i < 3; i++) await expect(send(d, request())).rejects.toBeInstanceOf(MailRetry);
    expect(await send(d, request())).toBe('exhausted');
    expect(t.sent).toHaveLength(3);
    expect(mem.rows.get('check_notify:c1')).toEqual({ status: 'failed', attempts: 3 });
    expect(log).toHaveBeenCalledWith('mail.exhausted', expect.any(Object));
  });

  it('records a failure that is not worth retrying, logs it, and does not throw', async () => {
    const t = fakeTransport([{ ok: false, code: 'provider_422', retryable: false }]);
    const { d, log } = deps({ transport: t.transport });
    expect(await send(d, request())).toBe('failed');
    expect(log).toHaveBeenCalledWith(
      'mail.failed',
      expect.objectContaining({ code: 'provider_422' }),
    );
  });

  it('records nothing_to_send when render answers null, and sends nothing', async () => {
    const { d, t, mem } = deps();
    expect(await send(d, request({ render: async () => null }))).toBe('nothing_to_send');
    expect(t.sent).toHaveLength(0);
    expect(mem.rows.get('check_notify:c1')!.status).toBe('failed');
  });

  it('never mails a suppressed address mail that is not account mail; account mail still goes', async () => {
    const hash = hashMailAddress(PEPPER, 'bounced@example.com');
    const mem = memoryLedger(new Set([hash]));
    const t = fakeTransport();
    const d: MailDeps = {
      ledger: mem.ledger,
      transport: t.transport,
      pepper: PEPPER,
      now: () => NOW,
      log: vi.fn(),
    };
    expect(await send(d, request({ to: 'bounced@example.com' }))).toBe('suppressed');
    expect(
      await send(
        d,
        request({ to: 'bounced@example.com', kind: 'trial_reminder', idempotencyKey: 'tr' }),
      ),
    ).toBe('sent');
    expect(t.sent.map((m) => m.idempotencyKey)).toEqual(['tr']);
  });

  it('refuses an address that is not a plain one, before any claim', async () => {
    const { d, mem } = deps();
    for (const to of ['a@b.com, c@d.com', 'A <a@b.com>', 'a@b.com\r\nBcc: x@y.com', 'nobody']) {
      expect(await send(d, request({ to }))).toBe('invalid_address');
    }
    expect(mem.claims).toHaveLength(0);
  });
});

describe('headers (D3): CR or LF in any field never reaches a header', () => {
  const mail = { subject: 'ok', text: 't', html: 'h' };
  const injections = ['a\r\nBcc: x@y.com', 'a\nb', 'a\rb', 'a\u2028b', 'a\u0000b', 'a\tb'];

  it.each(injections)('refuses %j as the subject', (bad) => {
    expect(() =>
      buildOutgoing({ to: 'a@b.com', mail: { ...mail, subject: bad }, idempotencyKey: 'k' }),
    ).toThrow(HeaderRefused);
  });
  it.each(injections)('refuses %j in an extra header value and the idempotency key', (bad) => {
    expect(() =>
      buildOutgoing({ to: 'a@b.com', mail, idempotencyKey: 'k', headers: { 'X-A': bad } }),
    ).toThrow(HeaderRefused);
    expect(() => buildOutgoing({ to: 'a@b.com', mail, idempotencyKey: bad })).toThrow(
      HeaderRefused,
    );
  });
  it.each(injections)('refuses %j in the recipient', (bad) => {
    expect(isPlainAddress(`x${bad}@b.com`)).toBe(false);
  });
  it('refuses a header name that is not a token, and a subject over the bound', () => {
    expect(() =>
      buildOutgoing({ to: 'a@b.com', mail, idempotencyKey: 'k', headers: { 'Bcc:\r\nX': 'v' } }),
    ).toThrow(HeaderRefused);
    expect(() =>
      buildOutgoing({
        to: 'a@b.com',
        mail: { ...mail, subject: 'x'.repeat(201) },
        idempotencyKey: 'k',
      }),
    ).toThrow(HeaderRefused);
  });
  it('sends from alerts@ and builds RFC 8058 headers from an https URL only', () => {
    const out = buildOutgoing({
      to: 'a@b.com',
      mail,
      idempotencyKey: 'k',
      headers: unsubscribeHeaders({ url: 'https://crawlmouse.com/unsubscribe?t=abc' }),
    });
    expect(out.from).toBe('Crawlmouse <alerts@crawlmouse.com>');
    expect(out.headers).toEqual({
      'List-Unsubscribe': '<https://crawlmouse.com/unsubscribe?t=abc>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    expect(() => unsubscribeHeaders({ url: 'http://crawlmouse.com/u' })).toThrow(HeaderRefused);
  });
});

describe('resendTransport', () => {
  const mail: OutgoingMail = {
    from: 'F <f@x.com>',
    to: 'a@b.com',
    subject: 's',
    text: 't',
    html: 'h',
    headers: { 'X-A': '1' },
    idempotencyKey: 'key-1',
  };
  const reply = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it('is null without an API key', () => {
    expect(resendTransport(undefined)).toBeNull();
    expect(resendTransport('')).toBeNull();
  });
  it('sends the ledger key as Idempotency-Key, and the recipient as `to` only', async () => {
    const f = reply(200, { id: 'msg_9' });
    expect(await resendTransport('k', f as unknown as typeof fetch)!.send(mail)).toEqual({
      ok: true,
      providerId: 'msg_9',
    });
    const [, init] = f.mock.calls[0]! as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('key-1');
    const body = JSON.parse(init.body as string);
    expect(body.to).toEqual(['a@b.com']);
    expect(body.headers).toEqual({ 'X-A': '1' });
  });
  it.each([
    [500, {}, { ok: false, code: 'provider_500', retryable: true }],
    [429, {}, { ok: false, code: 'provider_429', retryable: true }],
    [
      409,
      { name: 'concurrent_idempotent_requests' },
      { ok: false, code: 'provider_409', retryable: true },
    ],
    [422, {}, { ok: false, code: 'provider_422', retryable: false }],
    [409, { name: 'invalid_idempotent_request' }, { ok: true, providerId: null }],
  ])('answers %i %j as %j', async (status, body, want) => {
    expect(
      await resendTransport('k', reply(status, body) as unknown as typeof fetch)!.send(mail),
    ).toEqual(want);
  });
  it('answers a network failure as retryable', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await resendTransport('k', f as unknown as typeof fetch)!.send(mail)).toEqual({
      ok: false,
      code: 'network',
      retryable: true,
    });
  });
});

describe('the kinds', () => {
  it('are the migration’s email_sends.kind list, and its suppressible kinds are the non-account ones', () => {
    const sql = readFileSync(
      resolve(
        __dirname,
        '../../../../../infra/supabase/migrations/20261113000001_v2_028_monitoring.sql',
      ),
      'utf8',
    );
    const list = /kind text not null check \(kind in \(([^)]*)\)\)/.exec(sql)![1]!;
    expect([...list.matchAll(/'(\w+)'/g)].map((m) => m[1])).toEqual([...MAIL_KINDS]);
    const supp = /select p_kind in \(([^)]*)\)/.exec(sql)![1]!;
    expect([...supp.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort()).toEqual(
      MAIL_KINDS.filter((k) => !ACCOUNT_KINDS.has(k)).sort(),
    );
  });
});
