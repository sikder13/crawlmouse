/**
 * The walk's stand-in for Supabase and Inngest (CC-38 D4), so the production build runs end to end
 * on this machine with no network service. NOT part of the product; run by ./run.sh.
 *
 * On 127.0.0.1:$STANDIN_PORT it serves what the app's clients call:
 *   /rest/v1/…            PostgREST, through the repo's stand-in over PGlite with every migration
 *                         (apps/web/__tests__/helpers/postgrest-pglite.ts), so the real policies,
 *                         grants and functions run: as the service role, or as the signed-in user;
 *                         resource embedding added by ./embed.ts;
 *   /auth/v1/…            the user of a token minted here; `otp` (a sign-in link is recorded, not
 *                         mailed) and `verify` (the link opened: a session, and the user made on first
 *                         use, so handle_new_user runs); `logout`; the admin `users` endpoints the app
 *                         and qa:seed call (create, list, read, update, delete);
 *   /storage/v1/object/…  the private buckets, in memory, with signed URLs;
 *   /e/<key>              Inngest's event intake: each event is recorded, nothing runs.
 * And the harness's controls, for the specs:
 *   GET  /__harness/link?email=…     the last sign-in link's token_hash for that address
 *   GET  /__harness/events?name=…    the events recorded so far, of that name when given
 *   POST /__harness/fail-once {path} the next /rest/v1/<path> request is answered 500
 *   POST /__harness/sql {sql,params} a query as postgres (the specs' fixtures and reads)
 *
 * The stand-in is the walk's ground: what it cannot show is the platform itself (GoTrue's own
 * rules, PostgREST's own parser, Storage). Those are the Supabase branch's and production's.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';
import { applyAllMigrations, freshDb } from '../../../apps/web/__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../../../apps/web/__tests__/helpers/postgrest-pglite';
import { embeddingClient } from './embed';

export const SERVICE_KEY = 'standin-service-role-key';
export const ANON_KEY = 'standin-anon-key';

type Row = Record<string, unknown>;
type Chain = ReturnType<SupabaseClient['from']> & Record<string, (...a: unknown[]) => Chain>;

const b64url = (s: string) => Buffer.from(s).toString('base64url');

/** An unsigned token naming the user; this stand-in is its only reader. */
export const tokenFor = (userId: string) =>
  `${b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${b64url(
    JSON.stringify({ sub: userId, role: 'authenticated', exp: 4102444800 }),
  )}.standin`;

function callerOf(req: IncomingMessage): string | 'service' | null {
  const auth = String(req.headers.authorization ?? '');
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (bearer === SERVICE_KEY) return 'service';
  const payload = bearer.split('.')[1];
  if (!payload) return null;
  try {
    const sub = (JSON.parse(Buffer.from(payload, 'base64url').toString()) as { sub?: unknown }).sub;
    return typeof sub === 'string' ? sub : null;
  } catch {
    return null;
  }
}

async function bodyOf(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

async function jsonOf(req: IncomingMessage): Promise<Row> {
  const raw = await bodyOf(req);
  return raw.length ? (JSON.parse(raw.toString()) as Row) : {};
}

function send(res: ServerResponse, status: number, body: unknown) {
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(text);
}

// ─── PostgREST ───────────────────────────────────────────────────────────────────────────────────

const listOf = (v: string) =>
  v
    .replace(/^\(|\)$/g, '')
    .split(',')
    .filter((x) => x !== '')
    .map((x) => x.replace(/^"|"$/g, ''));
const scalar = (v: string): unknown =>
  v === 'null' ? null : v === 'true' ? true : v === 'false' ? false : v;

function filter(chain: Chain, column: string, expr: string): Chain {
  const [op, ...rest] = expr.split('.');
  const value = rest.join('.');
  switch (op) {
    case 'eq':
    case 'neq':
    case 'gte':
    case 'lt':
      return chain[op](column, value);
    case 'is':
      return chain.is(column, scalar(value));
    case 'in':
      return chain.in(column, listOf(value));
    case 'not': {
      const [inner, ...v] = value.split('.');
      return chain.not(column, inner!, inner === 'is' ? scalar(v.join('.')) : v.join('.'));
    }
    default:
      throw new Error(`standin: filter ${column}=${expr} is not modelled`);
  }
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
const dateColumns = new Map<string, Set<string>>();

/** Rows as PostgREST sends them: a `date` column as its calendar day. */
function asPostgrest(table: string, data: unknown): unknown {
  const dates = dateColumns.get(table);
  if (!dates || data === null) return data;
  const day = (v: unknown) =>
    v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'string' ? v.slice(0, 10) : v;
  const fix = (row: Row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, dates.has(k) ? day(v) : v]));
  return Array.isArray(data) ? data.map((r) => fix(r as Row)) : fix(data as Row);
}

async function rest(client: SupabaseClient, req: IncomingMessage, res: ServerResponse, url: URL) {
  const path = url.pathname.replace('/rest/v1/', '');
  const json = await jsonOf(req).catch(() => ({}));
  if (path.startsWith('rpc/')) {
    const { data, error } = await client.rpc(path.slice(4), json);
    return error ? send(res, 400, error) : send(res, 200, JSON.stringify(data ?? null));
  }
  const wantsObject = String(req.headers.accept ?? '').includes('vnd.pgrst.object');
  const prefer = String(req.headers.prefer ?? '');
  const q = url.searchParams;
  let chain = client.from(path) as unknown as Chain;
  if (req.method === 'GET' || req.method === 'HEAD') {
    chain = chain.select(q.get('select') ?? '*');
  } else if (req.method === 'POST') {
    const row = (Array.isArray(json) ? json[0] : json) as Row;
    chain = (
      prefer.includes('resolution=')
        ? chain.upsert(row, {
            onConflict: q.get('on_conflict') ?? '',
            ignoreDuplicates: prefer.includes('ignore-duplicates'),
          })
        : chain.insert(row)
    ) as Chain;
    if (prefer.includes('return=representation')) chain = chain.select(q.get('select') ?? '*');
  } else if (req.method === 'PATCH') {
    chain = chain.update(json) as Chain;
    if (prefer.includes('return=representation')) chain = chain.select(q.get('select') ?? '*');
  } else {
    throw new Error(`standin: ${req.method} on ${path} is not modelled`);
  }
  for (const [key, value] of q) if (!RESERVED.has(key)) chain = filter(chain, key, value);
  for (const term of (q.get('order') ?? '').split(',').filter(Boolean)) {
    const [column, direction] = term.split('.');
    chain = chain.order(column!, { ascending: direction !== 'desc' });
  }
  const limit = q.has('limit') ? Number(q.get('limit')) : null;
  const offset = q.has('offset') ? Number(q.get('offset')) : null;
  const range = /^(\d+)-(\d+)$/.exec(String(req.headers.range ?? ''));
  if (offset !== null && limit !== null) chain = chain.range(offset, offset + limit - 1);
  else if (limit !== null) chain = chain.limit(limit);
  else if (range) chain = chain.range(Number(range[1]), Number(range[2]));
  if (wantsObject) chain = chain.maybeSingle();
  const { data, error } = (await (chain as unknown as PromiseLike<{
    data: unknown;
    error: { code?: string } | null;
  }>)) as { data: unknown; error: { code?: string } | null };
  if (error) return send(res, error.code === 'PGRST116' ? 406 : 400, error);
  if (wantsObject && data === null) {
    return send(res, 406, { code: 'PGRST116', message: 'no rows', details: null, hint: null });
  }
  return send(
    res,
    req.method === 'POST' ? 201 : 200,
    asPostgrest(path, data ?? (wantsObject ? null : [])),
  );
}

// ─── Auth ────────────────────────────────────────────────────────────────────────────────────────

interface AuthUser {
  id: string;
  email: string;
  app_metadata: Row;
  user_metadata: Row;
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
  banned_until: string | null;
  created_at: string;
}

class Auth {
  readonly users = new Map<string, AuthUser>();
  /** token_hash → the address a sign-in link was asked for. */
  readonly links = new Map<string, string>();
  readonly lastLink = new Map<string, string>();

  constructor(readonly db: PGlite) {}

  byEmail(email: string): AuthUser | undefined {
    const e = email.toLowerCase();
    return [...this.users.values()].find((u) => u.email === e);
  }

  /** As GoTrue does: the auth.users row first, so the sign-up trigger runs in its transaction. */
  async create(email: string, appMetadata: Row = {}, confirmed = true): Promise<AuthUser> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.db.query('insert into auth.users (id, email) values ($1, $2)', [
      id,
      email.toLowerCase(),
    ]);
    const user: AuthUser = {
      id,
      email: email.toLowerCase(),
      app_metadata: { provider: 'email', ...appMetadata },
      user_metadata: {},
      email_confirmed_at: confirmed ? now : null,
      last_sign_in_at: null,
      banned_until: null,
      created_at: now,
    };
    this.users.set(id, user);
    return user;
  }

  view(u: AuthUser) {
    return { ...u, aud: 'authenticated', role: 'authenticated' };
  }

  session(u: AuthUser) {
    return {
      access_token: tokenFor(u.id),
      refresh_token: `standin-refresh-${u.id}`,
      token_type: 'bearer',
      expires_in: 3600 * 24 * 365,
      expires_at: 4102444800,
      user: this.view(u),
    };
  }
}

async function auth(a: Auth, req: IncomingMessage, res: ServerResponse, url: URL) {
  const path = url.pathname.replace('/auth/v1/', '');
  const who = callerOf(req);
  if (path === 'user' && req.method === 'GET') {
    const u = typeof who === 'string' && who !== 'service' ? a.users.get(who) : undefined;
    return u && !u.banned_until
      ? send(res, 200, a.view(u))
      : send(res, 401, { msg: 'invalid token' });
  }
  if (path === 'otp' && req.method === 'POST') {
    const { email } = (await jsonOf(req)) as { email?: string };
    if (typeof email !== 'string') return send(res, 400, { msg: 'email' });
    const hash = randomBytes(20).toString('hex');
    a.links.set(hash, email.toLowerCase());
    a.lastLink.set(email.toLowerCase(), hash);
    return send(res, 200, {});
  }
  if (path === 'verify' && req.method === 'POST') {
    const { token_hash } = (await jsonOf(req)) as { token_hash?: string };
    const email = token_hash ? a.links.get(token_hash) : undefined;
    if (!email)
      return send(res, 403, { code: 'otp_expired', msg: 'Token has expired or is invalid' });
    a.links.delete(token_hash!);
    const u = a.byEmail(email) ?? (await a.create(email, {}, false));
    const now = new Date().toISOString();
    // GoTrue confirms the address on the first verify and stamps the sign-in in the same request, so
    // the user it returns carries both (the door's isFirstLogin compares them).
    if (u.email_confirmed_at === null) u.email_confirmed_at = now;
    u.last_sign_in_at = now;
    return send(res, 200, a.session(u));
  }
  if (path === 'logout') return send(res, 204, undefined);
  if (path.startsWith('admin/users')) {
    if (who !== 'service') return send(res, 403, { msg: 'service role only' });
    const id = path.split('/')[2];
    if (!id && req.method === 'POST') {
      const body = (await jsonOf(req)) as { email?: string; app_metadata?: Row };
      if (typeof body.email !== 'string') return send(res, 400, { msg: 'email' });
      if (a.byEmail(body.email)) {
        return send(res, 422, {
          code: 'email_exists',
          msg: 'A user with this email address has already been registered',
        });
      }
      return send(res, 200, a.view(await a.create(body.email, body.app_metadata ?? {})));
    }
    if (!id && req.method === 'GET') {
      const page = Number(url.searchParams.get('page') ?? 1);
      const per = Number(url.searchParams.get('per_page') ?? 50);
      const all = [...a.users.values()];
      return send(res, 200, {
        users: all.slice((page - 1) * per, page * per).map((u) => a.view(u)),
        aud: 'authenticated',
      });
    }
    const u = id ? a.users.get(id) : undefined;
    if (!u) return send(res, 404, { code: 'user_not_found', msg: 'User not found' });
    if (req.method === 'GET') return send(res, 200, a.view(u));
    if (req.method === 'PUT') {
      const body = (await jsonOf(req)) as { email?: string; ban_duration?: string };
      if (typeof body.email === 'string') {
        u.email = body.email.toLowerCase();
        await a.db.query('update auth.users set email = $1 where id = $2', [u.email, u.id]);
      }
      if (body.ban_duration === 'none') u.banned_until = null;
      else if (typeof body.ban_duration === 'string') u.banned_until = '2999-01-01T00:00:00Z';
      return send(res, 200, a.view(u));
    }
    if (req.method === 'DELETE') {
      a.users.delete(u.id);
      await a.db.query('delete from auth.users where id = $1', [u.id]);
      return send(res, 200, {});
    }
  }
  return send(res, 404, { msg: `standin: /auth/v1/${path} is not served` });
}

// ─── Storage ─────────────────────────────────────────────────────────────────────────────────────

/** Stored objects by `<bucket>/<path>`. */
export const files = new Map<string, { bytes: Buffer; type: string }>();
const signed = new Map<string, { key: string; until: number }>();

async function storage(req: IncomingMessage, res: ServerResponse, url: URL, who: string | null) {
  const path = decodeURIComponent(url.pathname.replace('/storage/v1/object/', ''));
  if (path.startsWith('sign/')) {
    const key = path.slice(5);
    if (req.method === 'POST') {
      if (who !== 'service') return send(res, 403, { message: 'service role only' });
      if (!files.has(key)) return send(res, 404, { message: 'Object not found' });
      const { expiresIn } = (await jsonOf(req)) as { expiresIn: number };
      const token = randomBytes(16).toString('hex');
      signed.set(token, { key, until: Date.now() + expiresIn * 1000 });
      return send(res, 200, { signedURL: `/object/sign/${key}?token=${token}` });
    }
    const grant = signed.get(url.searchParams.get('token') ?? '');
    const file =
      grant && grant.key === key && grant.until > Date.now() ? files.get(key) : undefined;
    if (!file) return send(res, 400, { message: 'signature expired or unknown' });
    res.writeHead(200, { 'content-type': file.type, 'content-length': String(file.bytes.length) });
    return res.end(file.bytes);
  }
  if (who !== 'service') return send(res, 403, { message: 'service role only' });
  if (req.method === 'POST' || req.method === 'PUT') {
    files.set(path, {
      bytes: await bodyOf(req),
      type: String(req.headers['content-type'] ?? 'application/octet-stream'),
    });
    return send(res, 200, { Key: path });
  }
  if (req.method === 'GET') {
    const file = files.get(path);
    if (!file) return send(res, 404, { message: 'Object not found' });
    res.writeHead(200, { 'content-type': file.type });
    return res.end(file.bytes);
  }
  if (req.method === 'DELETE') {
    const { prefixes } = (await jsonOf(req)) as { prefixes: string[] };
    const bucket = path.replace(/\/$/, '');
    for (const p of prefixes) files.delete(`${bucket}/${p}`);
    return send(
      res,
      200,
      prefixes.map((name) => ({ name })),
    );
  }
  return send(res, 405, { message: 'not modelled' });
}

// ─── the server ──────────────────────────────────────────────────────────────────────────────────

export interface Standin {
  db: PGlite;
  auth: Auth;
  events: { name: string; data: unknown }[];
  url: string;
  close(): Promise<void>;
}

/** The walk's own controls, served at POST /__harness/<name> with the JSON body. */
export type Controls = Record<string, (body: Row, db: PGlite) => Promise<unknown>>;

/** A route the walk adds under its own prefix (the Stripe stand-in's `/stripe/`). */
export type Route = {
  prefix: string;
  handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void>;
};

export async function startStandin(
  port: number,
  { controls = {}, routes = [] }: { controls?: Controls; routes?: Route[] } = {},
): Promise<Standin> {
  const db = await freshDb();
  await applyAllMigrations(db);
  const typed = await db.query<{ t: string; c: string }>(
    `select table_name t, column_name c from information_schema.columns
      where table_schema = 'public' and data_type = 'date'`,
  );
  for (const { t, c } of typed.rows) dateColumns.set(t, (dateColumns.get(t) ?? new Set()).add(c));
  const a = new Auth(db);
  const events: { name: string; data: unknown }[] = [];
  const failure: { armed: string | null } = { armed: null };

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      const who = callerOf(req);
      if (process.env.STANDIN_LOG) console.error(`standin: ${req.method} ${url.pathname}`);
      try {
        if (url.pathname === '/__harness/link') {
          const hash = a.lastLink.get((url.searchParams.get('email') ?? '').toLowerCase());
          return hash
            ? send(res, 200, { token_hash: hash })
            : send(res, 404, { message: 'no link' });
        }
        if (url.pathname === '/__harness/events') {
          const name = url.searchParams.get('name');
          return send(res, 200, name ? events.filter((e) => e.name === name) : events);
        }
        if (url.pathname === '/__harness/fail-once' && req.method === 'POST') {
          failure.armed = String((await jsonOf(req)).path ?? '') || null;
          return send(res, 200, failure);
        }
        if (url.pathname === '/__harness/sql' && req.method === 'POST') {
          const { sql, params } = (await jsonOf(req)) as { sql: string; params?: unknown[] };
          const r = await db.query(sql, params ?? []);
          return send(res, 200, r.rows);
        }
        const route = routes.find((r) => url.pathname.startsWith(r.prefix));
        if (route) return await route.handle(req, res, url);
        const control = url.pathname.startsWith('/__harness/')
          ? controls[url.pathname.slice('/__harness/'.length)]
          : undefined;
        if (control && req.method === 'POST')
          return send(res, 200, (await control(await jsonOf(req), db)) ?? {});
        if (url.pathname.startsWith('/e/') && req.method === 'POST') {
          const body = JSON.parse((await bodyOf(req)).toString()) as unknown;
          const list = (Array.isArray(body) ? body : [body]) as { name: string; data: unknown }[];
          for (const e of list) events.push({ name: e.name, data: e.data });
          return send(res, 200, { ids: list.map(() => randomUUID()), status: 200 });
        }
        if (failure.armed !== null && url.pathname === `/rest/v1/${failure.armed}`) {
          failure.armed = null;
          return send(res, 500, {
            code: 'XX000',
            message: 'standin: a one-shot failure',
            details: null,
            hint: null,
          });
        }
        if (url.pathname.startsWith('/auth/v1/')) return await auth(a, req, res, url);
        if (url.pathname.startsWith('/rest/v1/')) {
          const live = typeof who === 'string' && who !== 'service' ? a.users.get(who) : undefined;
          // The helper runs a request as the service role or as a signed-in user. An anonymous one
          // is refused rather than run with the service role's reach.
          if (who !== 'service' && !live) return send(res, 401, { message: 'standin: no role' });
          const client = embeddingClient(
            db,
            who === 'service' ? postgrestOver(db) : postgrestOver(db, { as: { userId: live!.id } }),
          );
          return await rest(client, req, res, url);
        }
        if (url.pathname.startsWith('/storage/v1/object/')) {
          return await storage(req, res, url, who === 'service' ? 'service' : null);
        }
        return send(res, 404, { message: `standin: ${url.pathname} is not served` });
      } catch (e) {
        console.error(`standin: ${req.method} ${url.pathname}: ${(e as Error).message}`);
        return send(res, 500, { message: (e as Error).message });
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    db,
    auth: a,
    events,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
