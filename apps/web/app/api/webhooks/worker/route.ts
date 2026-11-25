import { inngest } from '../../../../../../inngest/client';
import { parseWorkerNote } from '../../../../lib/v2/pipeline/worker-note';
import {
  SIGNAL_MAX_SKEW_MS,
  SIGNATURE_HEADER,
  TS_HEADER,
  verifySignal,
} from '../../../../lib/worker-client/sign';

export const runtime = 'nodejs';

/**
 * The crawl worker's note that a batch ended (PR 5a). The worker holds no Inngest key, so it signs
 * this and the app sends the event. It wakes a run's wait and carries no data: the run still reads
 * the result from the worker, so at worst a note costs one read, or puts that run back on polling. A note that fails costs the run a
 * wait's timeout, so a failure here is answered and not retried.
 */
const MAX_BYTES = 512;
const BODY_DEADLINE_MS = 5_000;
const TOO_LARGE = Symbol('too_large');
const TIMED_OUT = Symbol('timeout');
const ABORTED = Symbol('aborted');

/** Whether these headers could pass `verifySignal`: a recent time and a whole hex signature. */
function headersCanPass(ts: string, signature: string, now: number): boolean {
  return (
    /^\d{1,15}$/.test(ts) &&
    Math.abs(now - Number(ts)) <= SIGNAL_MAX_SKEW_MS &&
    /^[0-9a-f]{64}$/i.test(signature)
  );
}

/**
 * The body as text; `too_large` past MAX_BYTES, whatever Content-Length said; `timeout` when it has
 * not ended within BODY_DEADLINE_MS, so a sender with a well-formed forged signature cannot hold the
 * route open by never finishing its body; `aborted` when the sender went away, which is answered
 * here so an anonymous disconnect does not reach error reporting.
 */
async function bounded(
  req: Request,
): Promise<string | typeof TOO_LARGE | typeof TIMED_OUT | typeof ABORTED> {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES) return TOO_LARGE;
  if (!req.body) return '';
  const reader = req.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), BODY_DEADLINE_MS);
  });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), deadline]);
      if (next === 'timeout') {
        void reader.cancel().catch(() => undefined);
        return TIMED_OUT;
      }
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BYTES) {
        void reader.cancel().catch(() => undefined);
        return TOO_LARGE;
      }
      chunks.push(next.value);
    }
  } catch {
    return ABORTED;
  } finally {
    clearTimeout(timer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.WORKER_SIGNING_SECRET;
  const ts = req.headers.get(TS_HEADER) ?? '';
  const signature = req.headers.get(SIGNATURE_HEADER) ?? '';
  // Before the body, so an impossible request is answered without reading it.
  if (!secret || !headersCanPass(ts, signature, Date.now())) {
    return new Response(null, { status: 401 });
  }
  const raw = await bounded(req);
  if (raw === TOO_LARGE) return new Response(null, { status: 413 });
  if (raw === TIMED_OUT) return new Response(null, { status: 408 });
  if (raw === ABORTED) return new Response(null, { status: 400 });
  if (!verifySignal(secret, ts, raw, signature, Date.now())) {
    return new Response(null, { status: 401 });
  }
  const note = parseWorkerNote(raw);
  if (note === null) return new Response(null, { status: 400 });
  // The sentinel's look, batch 0: its function polls the look and waits on no event, so the note is
  // answered and sends none (F-333). Refusing it only filled the worker's log with signal_refused.
  if (note.batch === 0) return new Response(null, { status: 204 });
  try {
    // No event id: the worker's repeat is the same note, and must not be dropped as a duplicate.
    await inngest.send({
      name: 'check.batch.ended',
      data: { checkId: note.check_id, batch: note.batch, status: note.status },
    });
  } catch {
    return new Response(null, { status: 502 });
  }
  return new Response(null, { status: 204 });
}
