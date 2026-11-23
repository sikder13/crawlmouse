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
 * the result from the worker, so at worst a note costs one read. A note that fails costs the run a
 * wait's timeout, so a failure here is answered and not retried.
 */
const MAX_BYTES = 512;

/** Whether these headers could pass `verifySignal`: a recent time and a whole hex signature. */
function headersCanPass(ts: string, signature: string, now: number): boolean {
  return (
    /^\d{1,15}$/.test(ts) &&
    Math.abs(now - Number(ts)) <= SIGNAL_MAX_SKEW_MS &&
    /^[0-9a-f]{64}$/i.test(signature)
  );
}

/** The body as text, or null past MAX_BYTES, whatever Content-Length said. */
async function bounded(req: Request): Promise<string | null> {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.WORKER_SIGNING_SECRET;
  const ts = req.headers.get(TS_HEADER) ?? '';
  const signature = req.headers.get(SIGNATURE_HEADER) ?? '';
  // Before the body: a request that cannot pass does not get to hold the connection open.
  if (!secret || !headersCanPass(ts, signature, Date.now())) {
    return new Response(null, { status: 401 });
  }
  const raw = await bounded(req);
  if (raw === null) return new Response(null, { status: 413 });
  if (!verifySignal(secret, ts, raw, signature, Date.now())) {
    return new Response(null, { status: 401 });
  }
  const note = parseWorkerNote(raw);
  if (note === null) return new Response(null, { status: 400 });
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
