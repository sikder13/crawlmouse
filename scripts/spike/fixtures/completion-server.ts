import http from 'node:http';
import { CompletionRoute, type DoneEvent } from '../worker/completion.js';

/**
 * node:http wrapper over the reference completion logic, for offline rehearsal of spike spec 2.7.
 * `/__open` and `/__events` are rehearsal-only controls standing in for the crawl_batches table and the
 * Inngest Event API; the preview deployment has the real ones.
 */
export function createCompletionServer(jwtSecret: string, now: () => number = Date.now): { server: http.Server; events: DoneEvent[]; route: CompletionRoute } {
  const events: DoneEvent[] = [];
  const route = new CompletionRoute({
    jwtSecret,
    now,
    emit: async (e) => {
      await new Promise((r) => setTimeout(r, 5));
      events.push(e);
    },
  });
  const server = http.createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    };
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    let body: Record<string, unknown> = {};
    try {
      body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    } catch {
      return send(400, { error: 'invalid_json' });
    }
    if (req.url === '/__open' && req.method === 'POST') {
      route.openBatch({ checkId: String(body.checkId), batch: Number(body.batch), nonce: String(body.nonce) });
      return send(200, { ok: true });
    }
    if (req.url === '/__events') return send(200, { count: events.length });
    if (req.url === '/api/internal/batch-done' && req.method === 'POST') {
      const auth = String(req.headers.authorization ?? '');
      const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const r = await route.handle({
        jwt,
        checkId: String(body.checkId),
        batch: Number(body.batch),
        nonce: String(body.nonce),
        counters: body.counters as never,
      });
      return send(r.status, { reason: r.reason });
    }
    send(404, { error: 'not_found' });
  });
  return { server, events, route };
}
