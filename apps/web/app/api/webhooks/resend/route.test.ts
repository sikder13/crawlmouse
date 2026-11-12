import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Webhook } from 'svix';
import { hashMailAddress } from '@/lib/v2/mail/address-hash';
import { memoryLedger, memoryTransport } from '@/lib/v2/mail/memory';
import { send } from '@/lib/v2/mail/send';

vi.mock('server-only', () => ({}));
const upsert = vi.fn(async () => ({ error: null }));
const rpc = vi.fn(async () => ({ data: null, error: null as { code: string } | null }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: () => ({ upsert }), rpc }),
}));

const SECRET = `whsec_${Buffer.from('a'.repeat(32)).toString('base64')}`;
const PEPPER = 'p'.repeat(40);

/** A request signed as Resend (svix) signs one. */
function signed(payload: unknown, id = `msg_${Math.random()}`, secret = SECRET): Request {
  const body = JSON.stringify(payload);
  const at = new Date();
  const signature = new Webhook(secret).sign(id, at, body);
  return new Request('https://crawlmouse.com/api/webhooks/resend', {
    method: 'POST',
    headers: {
      'svix-id': id,
      'svix-timestamp': String(Math.floor(at.getTime() / 1000)),
      'svix-signature': signature,
    },
    body,
  });
}

const bounce = (type: string, to = ['Bounced+tag@Example.com']) => ({
  type: 'email.bounced',
  created_at: '2026-11-13T10:00:00.000Z',
  data: { email_id: 'e1', to, bounce: { message: 'm', subType: 'General', type } },
});
const complaint = { type: 'email.complained', data: { email_id: 'e2', to: ['angry@example.com'] } };
const delivered = { type: 'email.delivered', data: { email_id: 'e3', to: ['ok@example.com'] } };

async function post(req: Request) {
  const { POST } = await import('./route');
  return POST(req);
}

beforeEach(() => {
  vi.stubEnv('RESEND_WEBHOOK_SECRET', SECRET);
  vi.stubEnv('TRIAL_LEDGER_PEPPER', PEPPER);
  upsert.mockClear();
  rpc.mockClear();
  rpc.mockImplementation(async () => ({ data: null, error: null }));
});
afterEach(() => vi.unstubAllEnvs());

describe('the Resend webhook: v1’s record, kept', () => {
  it('refuses a bad signature and records nothing', async () => {
    const req = signed(
      complaint,
      'msg_bad',
      `whsec_${Buffer.from('b'.repeat(32)).toString('base64')}`,
    );
    expect((await post(req)).status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('records every verified event in email_events, as before', async () => {
    expect((await post(signed(delivered, 'msg_d'))).status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        resend_event_id: 'msg_d',
        email_address: 'ok@example.com',
        event_type: 'delivered',
      }),
      { onConflict: 'resend_event_id', ignoreDuplicates: true },
    );
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('suppression (D7)', () => {
  it('a hard bounce suppresses the hash of the address as written, lower-cased, tag kept', async () => {
    expect((await post(signed(bounce('Permanent')))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('record_email_suppression', {
      p_hash: hashMailAddress(PEPPER, 'bounced+tag@example.com'),
      p_reason: 'hard_bounce',
      p_now: expect.any(String),
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/bounced@|Bounced/);
  });

  it('a complaint suppresses; a temporary bounce and a delivery do not', async () => {
    await post(signed(complaint));
    expect(rpc).toHaveBeenCalledWith('record_email_suppression', {
      p_hash: hashMailAddress(PEPPER, 'angry@example.com'),
      p_reason: 'complaint',
      p_now: expect.any(String),
    });
    rpc.mockClear();
    await post(signed(bounce('Temporary')));
    await post(signed(delivered));
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a failed suppression write answers 500, so Resend sends the event again', async () => {
    rpc.mockImplementation(async () => ({ data: null, error: { code: '57014' } }));
    expect((await post(signed(bounce('Permanent')))).status).toBe(500);
  });

  it('with no pepper nothing can be hashed: the event is recorded, the miss logged', async () => {
    vi.stubEnv('TRIAL_LEDGER_PEPPER', '');
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await post(signed(bounce('Permanent')))).status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
    expect(String(err.mock.calls[0]![0])).toContain('mail.suppression_unhashed');
    expect(String(err.mock.calls[0]![0])).not.toContain('@');
    err.mockRestore();
  });

  it('end to end: the address a hard bounce suppressed is not mailed again; the untagged one still is', async () => {
    await post(signed(bounce('Permanent')));
    const [, args] = rpc.mock.calls[0] as unknown as [string, { p_hash: string }];
    const ledger = memoryLedger(new Set([args.p_hash]));
    const transport = memoryTransport();
    const mail = (to: string, key: string) =>
      send(
        { ledger, transport, pepper: PEPPER, now: () => new Date(), log: () => undefined },
        {
          kind: 'check_notify',
          to,
          idempotencyKey: key,
          accountId: null,
          render: async () => ({ subject: 's', text: 't', html: 'h' }),
        },
      );
    expect(await mail('bounced+tag@example.com', 'check_notify:x')).toBe('suppressed');
    expect(transport.sent).toEqual([]);
    // A stranger's tagged address cannot silence the plain one (security review r1, B2).
    expect(await mail('bounced@example.com', 'check_notify:y')).toBe('sent');
    expect(transport.sent.map((m) => m.to)).toEqual(['bounced@example.com']);
  });
});
