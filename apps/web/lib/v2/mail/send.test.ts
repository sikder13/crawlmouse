import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { hashMailAddress } from './address-hash';
import {
  buildOutgoing,
  EXTRA_HEADERS,
  HeaderRefused,
  isPlainAddress,
  unsubscribeHeaders,
} from './headers';
import type { MailLedger } from './ledger';
import { memoryLedger, type MemoryLedger } from './memory';
import { keyRef, MailRetry, send, type MailDeps, type SendRequest } from './send';
import { resendTransport, type MailTransport, type TransportResult } from './transport';
import { AGENCY_PLUS_INBOX } from './templates/agency-plus-contact';
import { ACCOUNT_KINDS, MAIL_KINDS, OWN_INBOX_KINDS, type OutgoingMail } from './types';

const PEPPER = 'p'.repeat(40);
const NOW = new Date('2026-11-13T10:00:00.000Z');

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

function deps(over: Partial<MailDeps> = {}, mem: MemoryLedger = memoryLedger()) {
  const t = fakeTransport();
  const log = vi.fn();
  const d: MailDeps = {
    ledger: mem,
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
    mem.rows.set('k', { status: 'sent', attempts: 1, addressHash: '' });
    expect(await send(d, request({ idempotencyKey: 'k', render }))).toBe('done');
    mem.rows.set('k2', { status: 'sending', attempts: 1, addressHash: '' });
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
    expect(mem.rows.get('check_notify:c1')).toMatchObject({ status: 'failed', attempts: 3 });
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
      ledger: mem,
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

  it('sends own-inbox mail to our inbox only: any other address is refused before any claim', async () => {
    expect(OWN_INBOX_KINDS.size).toBeGreaterThan(0);
    for (const kind of OWN_INBOX_KINDS) {
      const { d, mem, t, log } = deps();
      for (const to of ['buyer@agency.example', AGENCY_PLUS_INBOX.toUpperCase(), 'support@x.co']) {
        expect(await send(d, request({ kind, to, idempotencyKey: `${kind}:${to}` }))).toBe(
          'invalid_address',
        );
      }
      expect(mem.claims).toHaveLength(0);
      expect(t.sent).toHaveLength(0);
      expect(log).toHaveBeenCalledWith('mail.invalid_address', expect.objectContaining({ kind }));
      expect(await send(d, request({ kind, to: AGENCY_PLUS_INBOX, idempotencyKey: kind }))).toBe(
        'sent',
      );
      expect(t.sent.map((m) => m.to)).toEqual([AGENCY_PLUS_INBOX]);
    }
    // Any other kind still goes to the address it names.
    const { d } = deps();
    expect(await send(d, request({ to: 'buyer@agency.example' }))).toBe('sent');
  });

  it('refuses an address that is not a plain one, before any claim', async () => {
    const { d, mem } = deps();
    for (const to of ['a@b.com, c@d.com', 'A <a@b.com>', 'a@b.com\r\nBcc: x@y.com', 'nobody']) {
      expect(await send(d, request({ to }))).toBe('invalid_address');
    }
    expect(mem.claims).toHaveLength(0);
  });
});

describe('send: every failure after the claim (correctness review r1, B1)', () => {
  /** The memory ledger with one of its calls failing, as a PostgREST error would. */
  const failing = (mem: MemoryLedger, which: 'claim' | 'finish', times = Infinity): MailLedger => {
    let left = times;
    return {
      claim: (c) => {
        if (which === 'claim' && left-- > 0)
          return Promise.reject(new Error('claim_email_send: 503'));
        return mem.claim(c);
      },
      finish: (f) => {
        if (which === 'finish' && left-- > 0)
          return Promise.reject(new Error('finish_email_send: 503'));
        return mem.finish(f);
      },
    };
  };

  it('a claim that fails is retried, with nothing rendered or sent', async () => {
    const mem = memoryLedger();
    const render = vi.fn(request().render);
    const { d, t } = deps({ ledger: failing(mem, 'claim') }, mem);
    await expect(send(d, request({ render }))).rejects.toMatchObject({
      name: 'MailRetry',
      code: 'claim_failed',
    });
    expect(render).not.toHaveBeenCalled();
    expect(t.sent).toHaveLength(0);
  });

  it('a render that throws records failed (render_failed) and is retried; the next claim is attempt 2', async () => {
    const { d, mem, t } = deps();
    let calls = 0;
    const render = async () => {
      if (++calls === 1) throw new Error('issue_account_link: 503');
      return { subject: 's', text: 't', html: 'h' };
    };
    await expect(send(d, request({ render }))).rejects.toMatchObject({ code: 'render_failed' });
    expect(mem.rows.get('check_notify:c1')).toMatchObject({
      status: 'failed',
      attempts: 1,
      errorCode: 'render_failed',
    });
    expect(await send(d, request({ render }))).toBe('sent');
    expect(mem.claims).toHaveLength(2);
    expect(t.sent).toHaveLength(1);
  });

  it('a render that keeps throwing ends exhausted after three attempts, never left sending', async () => {
    const { d, mem } = deps();
    const render = async () => {
      throw new Error('boom');
    };
    for (let i = 0; i < 3; i++) {
      await expect(send(d, request({ render }))).rejects.toBeInstanceOf(MailRetry);
      expect(mem.rows.get('check_notify:c1')!.status).toBe('failed');
    }
    expect(await send(d, request({ render }))).toBe('exhausted');
  });

  it('a header builder or transport that throws records failed and is retried', async () => {
    const built = deps();
    await expect(
      send(
        built.d,
        request({
          headers: () => {
            throw new TypeError('not a header error');
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'build_failed' });
    expect(built.mem.rows.get('check_notify:c1')).toMatchObject({
      status: 'failed',
      errorCode: 'build_failed',
    });
    const thrown = deps({
      transport: {
        send: () => Promise.reject(new Error('socket hang up')),
      },
    });
    await expect(send(thrown.d, request())).rejects.toMatchObject({ code: 'transport_threw' });
    expect(thrown.mem.rows.get('check_notify:c1')).toMatchObject({
      status: 'failed',
      errorCode: 'transport_threw',
    });
  });

  it('a render that throws while the ledger is down is still retried (the lease takes the claim back)', async () => {
    const mem = memoryLedger();
    const { d } = deps({ ledger: failing(mem, 'finish') }, mem);
    const render = () => Promise.reject(new Error('boom'));
    await expect(send(d, request({ render }))).rejects.toMatchObject({ code: 'render_failed' });
    expect(mem.rows.get('check_notify:c1')!.status).toBe('sending');
  });

  it('a finish that fails after Resend accepted is retried, and the retry sends under the same key', async () => {
    const mem = memoryLedger();
    const { d, t } = deps({ ledger: failing(mem, 'finish', 1) }, mem);
    await expect(send(d, request())).rejects.toMatchObject({ code: 'finish_failed' });
    expect(t.sent).toHaveLength(1);
    // The key is still sending; past the two-minute lease the SQL answers go (memory has no clock).
    mem.rows.get('check_notify:c1')!.status = 'failed';
    expect(await send(d, request())).toBe('sent');
    expect(t.sent.map((m) => m.idempotencyKey)).toEqual(['check_notify:c1', 'check_notify:c1']);
    expect(mem.rows.get('check_notify:c1')!.status).toBe('sent');
  });

  it('a finish that fails on a retryable or permanent provider answer is retried', async () => {
    for (const result of [
      { ok: false, code: 'provider_500', retryable: true },
      { ok: false, code: 'provider_422', retryable: false },
    ] as const) {
      const mem = memoryLedger();
      const tr = fakeTransport([result]);
      const { d } = deps({ ledger: failing(mem, 'finish'), transport: tr.transport }, mem);
      await expect(send(d, request())).rejects.toMatchObject({ code: 'finish_failed' });
    }
  });

  it('logs the kind and a hash of the key, never the key (it can hold a check id)', async () => {
    const key = 'check_notify:c0000000-0000-4000-8000-0000000000aa';
    const logs: unknown[] = [];
    for (const over of [
      { transport: null },
      {
        transport: fakeTransport([{ ok: false, code: 'provider_422', retryable: false }]).transport,
      },
    ] as const) {
      const { d, log } = deps(over);
      await send(d, request({ idempotencyKey: key }));
      logs.push(...log.mock.calls);
    }
    const { d, log } = deps();
    await send(d, request({ idempotencyKey: key, to: 'not an address' }));
    logs.push(...log.mock.calls);
    expect(logs).toHaveLength(3);
    expect(JSON.stringify(logs)).not.toContain('c0000000');
    expect(logs[0]).toEqual([
      'mail.unconfigured',
      expect.objectContaining({ key_ref: keyRef(key) }),
    ]);
    expect(keyRef(key)).toMatch(/^[0-9a-f]{16}$/);
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
      buildOutgoing({
        to: 'a@b.com',
        mail,
        idempotencyKey: 'k',
        headers: { 'List-Unsubscribe': bad },
      }),
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
  it('refuses any extra header but the two unsubscribe headers, whatever its value', () => {
    for (const name of ['From', 'Bcc', 'Reply-To', 'To', 'X-A', 'list-unsubscribe', 'Sender']) {
      expect(() =>
        buildOutgoing({ to: 'a@b.com', mail, idempotencyKey: 'k', headers: { [name]: 'v' } }),
      ).toThrow(HeaderRefused);
    }
    expect(EXTRA_HEADERS).toEqual(new Set(['List-Unsubscribe', 'List-Unsubscribe-Post']));
  });
  it('takes a dot-atom local part only: no specials a parser could read as a group or a route', () => {
    for (const ok of ["o'brien+tag@example.co.uk", 'a.b-c_d@x.io', 'x!#$%&*/=?^`{|}~@ex.com']) {
      expect(isPlainAddress(ok)).toBe(true);
    }
    for (const bad of [
      'a:b@c.com',
      'a[b]@c.com',
      'a;b@c.com',
      '"a b"@c.com',
      '.a@c.com',
      'a.@c.com',
      'a..b@c.com',
      'a(b)@c.com',
      'a\\b@c.com',
      'a@b@c.com',
      '@c.com',
      `${'x'.repeat(65)}@c.com`,
      'a@c',
      'a@-c.com',
    ]) {
      expect(isPlainAddress(bad), bad).toBe(false);
    }
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
  // The migrations in order: the last that sets `email_sends.kind`'s check, or redefines
  // `email_kind_suppressible`, is the one in force (CC-29's 20261114000001 widens the first).
  const MIGRATIONS = resolve(__dirname, '../../../../../infra/supabase/migrations');
  const lastMatch = (re: RegExp): string => {
    let found: string | undefined;
    for (const f of readdirSync(MIGRATIONS)
      .filter((n) => n.endsWith('.sql'))
      .sort()) {
      for (const m of readFileSync(resolve(MIGRATIONS, f), 'utf8').matchAll(re))
        found = m[1] ?? m[2];
    }
    return found!;
  };
  const quoted = (list: string) => [...list.matchAll(/'(\w+)'/g)].map((m) => m[1]);

  it('are the email_sends.kind check in force, and its suppressible kinds are neither account nor own-inbox mail', () => {
    const list = lastMatch(
      /create table if not exists public\.email_sends \([^;]*?kind text not null check \(kind in \(([^)]*)\)\)|constraint email_sends_kind_check\s+check \(kind in \(([^)]*)\)\)/g,
    );
    // 031's section C writes no list: it adds to each of the two the kinds its arrays name, after
    // what is there. What the database holds after every migration is read in
    // __tests__/v2-031-m-mail-kinds.test.ts.
    const added = readFileSync(resolve(MIGRATIONS, '20261114000002_v2_031_agency.sql'), 'utf8');
    const array = (name: string) =>
      quoted(new RegExp(`${name} constant text\\[\\] := array\\[([^\\]]*)\\]`).exec(added)![1]!);
    expect([...quoted(list), ...array('v_added')]).toEqual([...MAIL_KINDS]);
    const supp = lastMatch(/select p_kind in \(([^)]*)\)/g);
    expect([...quoted(supp), ...array('v_added_suppressible')].sort()).toEqual(
      MAIL_KINDS.filter((k) => !ACCOUNT_KINDS.has(k) && !OWN_INBOX_KINDS.has(k)).sort(),
    );
  });
});
