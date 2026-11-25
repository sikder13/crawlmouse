import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signSignal as workerSignSignal } from '../../../../../../packages/worker/src/signal';
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

  // F-333: the sentinel's look posts its access batch as 0 (sentinel-work.ts) and polls it; nothing
  // waits on its event. The note is answered, so the worker logs no refusal, and sends nothing.
  it('answers the sentinel look’s note, batch 0, and sends no event', async () => {
    const res = await call(JSON.stringify({ ...BODY, batch: 0 }));
    expect(res.status).toBe(204);
    expect(send).not.toHaveBeenCalled();
  });

  it('still refuses an unsigned batch 0', async () => {
    const res = await call(JSON.stringify({ ...BODY, batch: 0 }), { sig: 'ab'.repeat(32) });
    expect(res.status).toBe(401);
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
    ['a negative batch', { ...BODY, batch: -1 }],
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

  it('accepts what the worker itself signs, and the signature is the one computed outside this code', async () => {
    const raw = JSON.stringify(BODY);
    const ts = String(NOW);
    // Python: hmac(hmac(secret, label), f"{ts}.{raw}"), so app and worker cannot agree on a wrong rule.
    const independent = 'af2ff4a937a0618390629af814a6dbaf71aff4a98a399fef9f61955e24716ea5';
    expect(workerSignSignal(SECRET, ts, raw)).toBe(independent);
    expect(signSignal(SECRET, ts, raw)).toBe(independent);
    expect((await call(raw, { sig: independent })).status).toBe(204);
  });

  it('refuses a batch or read signature over the body a signal context would prefix', async () => {
    const raw = JSON.stringify(BODY);
    const ts = String(NOW);
    for (const sig of [
      signBody(SECRET, ts, `signal:${raw}`),
      signRead(SECRET, ts, `signal:${raw}`),
    ]) {
      expect((await call(raw, { sig })).status).toBe(401);
    }
    expect(send).not.toHaveBeenCalled();
  });

  const streamed = (body: ReadableStream, ts = String(NOW), sig = 'a'.repeat(64)) =>
    POST(
      new Request(URL_, {
        method: 'POST',
        headers: { 'x-crawlmouse-ts': ts, 'x-crawlmouse-signature': sig },
        body,
        duplex: 'half',
      } as RequestInit),
    );
  const bytes = (text: string) => new TextEncoder().encode(text);

  it('answers a stale time without waiting on the body, even with a well-formed signature', async () => {
    const pull = vi.fn();
    const stale = String(NOW - 5 * 60_000 - 1);
    const body = new ReadableStream({ pull }, { highWaterMark: 0 });
    expect((await streamed(body, stale)).status).toBe(401);
    expect(pull).not.toHaveBeenCalled();
  });

  it('answers 400, and does not throw, when the sender disconnects mid-body', async () => {
    const body = new ReadableStream({
      pull(c) {
        c.error(new Error('aborted'));
      },
    });
    expect((await streamed(body)).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('answers 413 at once even if cancelling the over-long body never settles', async () => {
    const body = new ReadableStream({
      start(c) {
        c.enqueue(bytes('x'.repeat(513)));
      },
      cancel: () => new Promise(() => undefined),
    });
    expect((await streamed(body)).status).toBe(413);
  });

  it('reads exactly 512 bytes and refuses 513', async () => {
    const of = (n: number) =>
      new ReadableStream({
        start(c) {
          c.enqueue(bytes('x'.repeat(n)));
          c.close();
        },
      });
    expect((await streamed(of(512))).status).toBe(401);
    expect((await streamed(of(513))).status).toBe(413);
  });

  it('refuses on a false Content-Length without reading the body', async () => {
    const pull = vi.fn();
    const res = await POST(
      new Request(URL_, {
        method: 'POST',
        headers: {
          'x-crawlmouse-ts': String(NOW),
          'x-crawlmouse-signature': 'a'.repeat(64),
          'content-length': '513',
        },
        body: new ReadableStream({ pull }, { highWaterMark: 0 }),
        duplex: 'half',
      } as RequestInit),
    );
    expect(res.status).toBe(413);
    expect(pull).not.toHaveBeenCalled();
  });

  it('takes a real note that arrives just inside the deadline', async () => {
    const raw = JSON.stringify(BODY);
    let finish!: () => void;
    const body = new ReadableStream({
      start(c) {
        finish = () => {
          c.enqueue(bytes(raw));
          c.close();
        };
      },
    });
    const pending = streamed(body, String(NOW), signSignal(SECRET, String(NOW), raw));
    await vi.advanceTimersByTimeAsync(4_999);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect((await pending).status).toBe(204);
  });

  it('refuses a note that went stale while its body was arriving', async () => {
    const raw = JSON.stringify(BODY);
    const ts = String(NOW - 5 * 60_000 + 1_000);
    let finish!: () => void;
    const body = new ReadableStream({
      start(c) {
        finish = () => {
          c.enqueue(bytes(raw));
          c.close();
        };
      },
    });
    const pending = streamed(body, ts, signSignal(SECRET, ts, raw));
    await vi.advanceTimersByTimeAsync(2_000);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect((await pending).status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it('stops reading a body that missed the deadline and leaves no timer behind', async () => {
    const cancel = vi.fn();
    const pending = streamed(new ReadableStream({ cancel }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await pending).status).toBe(408);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves no timer behind when the body arrives', async () => {
    await call(JSON.stringify(BODY));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a body that went over the limit', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({
      start(c) {
        c.enqueue(bytes('x'.repeat(513)));
      },
      cancel,
    });
    expect((await streamed(body)).status).toBe(413);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('leaves no timer behind when the sender disconnects', async () => {
    const body = new ReadableStream({
      pull(c) {
        c.error(new Error('aborted'));
      },
    });
    await streamed(body);
    expect(vi.getTimerCount()).toBe(0);
  });

  /** Rejections nothing handled while `act` ran, after a real turn of the event loop. */
  async function unhandledDuring(act: () => Promise<unknown>): Promise<unknown[]> {
    const seen: unknown[] = [];
    const on = (e: unknown) => seen.push(e);
    process.on('unhandledRejection', on);
    try {
      await act();
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 30));
    } finally {
      process.off('unhandledRejection', on);
    }
    return seen;
  }

  it('a cancel that rejects on the over-limit path is not an unhandled rejection', async () => {
    const body = new ReadableStream({
      start(c) {
        c.enqueue(bytes('x'.repeat(513)));
      },
      cancel: () => Promise.reject(new Error('rejected')),
    });
    expect(await unhandledDuring(() => streamed(body))).toEqual([]);
  });

  it('a cancel that rejects on the timeout path is not an unhandled rejection', async () => {
    const body = new ReadableStream({ cancel: () => Promise.reject(new Error('rejected')) });
    const seen = await unhandledDuring(async () => {
      const pending = streamed(body);
      await vi.advanceTimersByTimeAsync(5_000);
      await pending;
    });
    expect(seen).toEqual([]);
  });

  it('answers 502 when the event cannot be sent; the run falls back to polling', async () => {
    send.mockRejectedValueOnce(new Error('down'));
    expect((await call(JSON.stringify(BODY))).status).toBe(502);
  });
});
