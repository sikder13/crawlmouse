import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signBody, signRead, signSignal } from '../../../../lib/worker-client/sign';

const send = vi.hoisted(() => vi.fn(async () => ({ ids: ['e'] })));
vi.mock('../../../../../../inngest/client', () => ({ inngest: { send } }));

import { POST } from './route';

const SECRET = 's'.repeat(32);
const NOW = 1_800_000_000_000;
const BODY = { check_id: '00000000-0000-4000-8000-000000000001', batch: 3, status: 'done' };
const URL_ = 'https://crawlmouse.test/api/webhooks/worker';

function call(raw: string, over: { ts?: string; sig?: string; length?: string } = {}) {
  const ts = over.ts ?? String(NOW);
  return POST(
    new Request(URL_, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-crawlmouse-ts': ts,
        'x-crawlmouse-signature': over.sig ?? signSignal(SECRET, ts, raw),
        ...(over.length && { 'content-length': over.length }),
      },
      body: raw,
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  vi.stubEnv('WORKER_SIGNING_SECRET', SECRET);
  send.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('POST /api/webhooks/worker', () => {
  it('turns a signed note into the run’s event, holding ids only', async () => {
    const res = await call(JSON.stringify(BODY));
    expect(res.status).toBe(204);
    expect(send).toHaveBeenCalledWith({
      name: 'check.batch.ended',
      data: { checkId: BODY.check_id, batch: 3, status: 'done' },
    });
  });

  it('sets no event id, so the worker’s repeat is not dropped as a duplicate', async () => {
    await call(JSON.stringify(BODY));
    expect(send.mock.calls[0]![0 as never]).not.toHaveProperty('id');
  });

  it.each([
    ['a wrong signature', { sig: 'ab'.repeat(32) }],
    ['a short signature', { sig: 'ab' }],
    ['a stale time', { ts: String(NOW - 5 * 60_000 - 1), sig: undefined }],
    ['a future time', { ts: String(NOW + 5 * 60_000 + 1), sig: undefined }],
    ['a time that is no number', { ts: 'soon', sig: undefined }],
  ])('refuses %s', async (_n, over) => {
    const res = await call(JSON.stringify(BODY), over);
    expect(res.status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a signature made for a batch post or a read', async () => {
    const raw = JSON.stringify(BODY);
    const ts = String(NOW);
    for (const sig of [signBody(SECRET, ts, raw), signRead(SECRET, ts, raw)]) {
      expect((await call(raw, { sig })).status).toBe(401);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ['extra fields', { ...BODY, url: 'https://x.test' }],
    ['a check id that is no uuid', { ...BODY, check_id: 'x' }],
    ['batch 0', { ...BODY, batch: 0 }],
    ['an unknown status', { ...BODY, status: 'maybe' }],
  ])('refuses a signed body with %s', async (_n, body) => {
    expect((await call(JSON.stringify(body))).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a body too large to be a note, before verifying it', async () => {
    const raw = JSON.stringify({ ...BODY, pad: 'x'.repeat(2048) });
    expect((await call(raw)).status).toBe(413);
    expect(send).not.toHaveBeenCalled();
  });

  it('fails closed with no secret', async () => {
    vi.stubEnv('WORKER_SIGNING_SECRET', '');
    const raw = JSON.stringify(BODY);
    // Signed with the empty key, which is what a route with no secret would otherwise accept.
    expect((await call(raw, { sig: signSignal('', String(NOW), raw) })).status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a request that cannot pass without reading its body', async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream({ cancel: cancelled });
    const res = await POST(
      new Request(URL_, {
        method: 'POST',
        headers: { 'x-crawlmouse-ts': String(NOW), 'x-crawlmouse-signature': 'nope' },
        body,
        duplex: 'half',
      } as RequestInit),
    );
    expect(res.status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it('a well-formed forged signature cannot hold the route open with a body that never ends', async () => {
    const pending = POST(
      new Request(URL_, {
        method: 'POST',
        headers: { 'x-crawlmouse-ts': String(NOW), 'x-crawlmouse-signature': 'a'.repeat(64) },
        body: new ReadableStream(),
        duplex: 'half',
      } as RequestInit),
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await pending).status).toBe(408);
    expect(send).not.toHaveBeenCalled();
  });

  it('answers 502 when the event cannot be sent; the run falls back to polling', async () => {
    send.mockRejectedValueOnce(new Error('down'));
    expect((await call(JSON.stringify(BODY))).status).toBe(502);
  });
});
