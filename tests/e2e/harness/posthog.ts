/**
 * The walk's PostHog (CC-41 D7): a capture stub at /ph/ of the stand-in, for the browser's posthog-js
 * (the build's NEXT_PUBLIC_POSTHOG_HOST) and the server's sender (POSTHOG_CAPTURE_URL,
 * apps/web/lib/analytics-server.ts). NOT part of the product; only journey 8 points a build here.
 *
 * What posthog-js 1.376.0 sends with a custom host, read from its dist/module.js:
 *   POST /e/?compression=gzip-js&ver=…&_=…   events, gzip (fflate's or the browser's); `text/plain`
 *   POST /flags/?v=2&compression=base64       flags, `data=<urlencoded base64 of UTF-8 JSON>`
 *   GET  /array/<token>/config.js             remote config as a script; /array/<token>/config as JSON
 *   GET  /static/<name>.js                    lazily loaded extensions
 * A body without compression is plain JSON; `/batch/`, `/i/v0/e/`, `/capture/` and `/decide/` are
 * accepted as well, so a change of path in the SDK is recorded rather than lost. The server's sender
 * posts one JSON event, with `api_key` and a top-level `distinct_id`, to `/i/v0/e/`.
 *
 * Every event is recorded, decoded, in arrival order, and appended as one JSON line to
 * $WALK_CAPTURES when that is set. Flags and remote config are answered empty, so posthog-js keeps
 * running with nothing switched on.
 */
import { appendFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { gunzipSync } from 'node:zlib';

type Json = Record<string, unknown>;

export interface Capture {
  /** `browser` for posthog-js, `server` for the app's sender (a body with a top-level distinct_id). */
  source: 'browser' | 'server';
  path: string;
  event: string;
  distinct_id: string | null;
  uuid: string | null;
  timestamp: string | null;
  properties: Json;
  $set: Json | null;
  $set_once: Json | null;
}

/** A request body as posthog-js or the server encoded it: gzip, `data=<base64>`, or JSON. */
export function decodeBody(raw: Buffer, url: URL): unknown {
  if (raw.length === 0) return null;
  let text: string;
  if ((raw[0] === 0x1f && raw[1] === 0x8b) || url.searchParams.get('compression') === 'gzip-js') {
    text = gunzipSync(raw).toString('utf8');
  } else {
    text = raw.toString('utf8');
    if (text.startsWith('data=')) {
      const b64 = new URLSearchParams(text).get('data') ?? '';
      text = Buffer.from(b64, 'base64').toString('utf8');
    }
  }
  return JSON.parse(text) as unknown;
}

const obj = (v: unknown): Json | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** The events of one decoded body: an array, `{batch: […]}`, or one event. */
export function eventsOf(body: unknown, path: string): Capture[] {
  const list = Array.isArray(body)
    ? body
    : Array.isArray(obj(body)?.batch)
      ? (obj(body)!.batch as unknown[])
      : [body];
  const out: Capture[] = [];
  for (const item of list) {
    const e = obj(item);
    if (!e || typeof e.event !== 'string') continue;
    const properties = obj(e.properties) ?? {};
    const server = typeof e.distinct_id === 'string';
    out.push({
      source: server ? 'server' : 'browser',
      path,
      event: e.event,
      distinct_id: str(e.distinct_id) ?? str(properties.distinct_id),
      uuid: str(e.uuid),
      timestamp: str(e.timestamp),
      properties,
      $set: obj(e.$set) ?? obj(properties.$set),
      $set_once: obj(e.$set_once) ?? obj(properties.$set_once),
    });
  }
  return out;
}

const EVENT_PATHS = ['/ph/e/', '/ph/i/v0/e/', '/ph/batch/', '/ph/capture/', '/ph/engage/'];

export class WalkPostHog {
  readonly captures: Capture[] = [];
  /** Requests the stub answered, by path, for the evidence's account of what posthog-js asked for. */
  readonly requests: { method: string; path: string; encoding: string }[] = [];

  constructor(private readonly file: string = process.env.WALK_CAPTURES ?? '') {}

  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);
    const origin = String(req.headers.origin ?? '');
    const cors: Record<string, string> = origin
      ? {
          'access-control-allow-origin': origin,
          'access-control-allow-credentials': 'true',
          'access-control-allow-headers': String(
            req.headers['access-control-request-headers'] ?? '*',
          ),
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          vary: 'origin',
        }
      : {};
    const answer = (status: number, type: string, body: string) => {
      res.writeHead(status, { 'content-type': type, ...cors });
      res.end(body);
    };
    const json = (body: unknown) => answer(200, 'application/json', JSON.stringify(body));
    const path = url.pathname;
    const encoding =
      raw[0] === 0x1f && raw[1] === 0x8b
        ? 'gzip'
        : raw.toString('utf8', 0, 5) === 'data='
          ? 'base64'
          : raw.length
            ? 'json'
            : 'none';
    this.requests.push({ method: req.method ?? '', path, encoding });
    if (req.method === 'OPTIONS') return answer(204, 'text/plain', '');

    if (EVENT_PATHS.some((p) => path === p || path === p.slice(0, -1))) {
      const events = eventsOf(decodeBody(raw, url), path.replace(/^\/ph/, ''));
      for (const e of events) {
        this.captures.push(e);
        if (this.file) appendFileSync(this.file, `${JSON.stringify(e)}\n`);
      }
      return json({ status: 1 });
    }
    if (path.startsWith('/ph/flags') || path.startsWith('/ph/decide')) {
      return json({
        flags: {},
        featureFlags: {},
        featureFlagPayloads: {},
        errorsWhileComputingFlags: false,
        quotaLimited: [],
      });
    }
    const config = /^\/ph\/array\/([^/]+)\/config(\.js)?$/.exec(path);
    if (config) {
      const remote = {
        token: decodeURIComponent(config[1]!),
        hasFeatureFlags: false,
        surveys: false,
        sessionRecording: false,
        heatmaps: false,
        autocaptureExceptions: false,
        siteApps: [],
      };
      if (!config[2]) return json(remote);
      const js = `(window._POSTHOG_REMOTE_CONFIG = window._POSTHOG_REMOTE_CONFIG || {})[${JSON.stringify(
        remote.token,
      )}] = { config: ${JSON.stringify(remote)}, siteApps: [] };`;
      return answer(200, 'application/javascript', js);
    }
    if (path.startsWith('/ph/static/')) {
      return answer(200, 'application/javascript', '/* the walk loads no PostHog extension */');
    }
    return answer(404, 'application/json', JSON.stringify({ error: `walk posthog: ${path}` }));
  }
}
