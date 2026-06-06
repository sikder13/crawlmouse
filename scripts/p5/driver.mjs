// P5 live driver — auth session cookie jar + audit start/stream/export + billing checkout.
// Usage: node driver.mjs <cmd> [...args]   (reads env from apps/web/.env.local)
// Cookie jars persist to /tmp/p5jar_<key>.json so a login is reusable across invocations.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const ROOT = '/home/udsik/nahl-clients-projects/crawlmouse-v1.0.0';
const require = createRequire(ROOT + '/apps/web/');
const { createClient } = require('@supabase/supabase-js');

const env = Object.fromEntries(
  readFileSync(ROOT + '/apps/web/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const BASE = 'http://localhost:3000';
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const out = (o) => console.log(JSON.stringify(o));
const jarPath = (key) => `/tmp/p5jar_${key.replace(/[^a-z0-9]/gi, '_')}.json`;
function loadJar(key) { const p = jarPath(key); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {}; }
function saveJar(key, jar) { writeFileSync(jarPath(key), JSON.stringify(jar)); }
function cookieHeader(jar) { return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '); }
function mergeSetCookies(jar, setCookies) {
  for (const sc of setCookies) {
    const first = sc.split(';')[0];
    const eq = first.indexOf('=');
    if (eq < 0) continue;
    const name = first.slice(0, eq).trim();
    const val = first.slice(eq + 1).trim();
    // a maxAge=0 / expired delete clears it
    if (/max-age=0|expires=thu, 01 jan 1970/i.test(sc)) delete jar[name];
    else jar[name] = val;
  }
}

const [cmd, ...args] = process.argv.slice(2);

async function login(email) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) { out({ error: 'genlink: ' + error.message }); process.exit(1); }
  const tokenHash = data.properties.hashed_token;
  const jar = {};
  const res = await fetch(`${BASE}/login/verify?token_hash=${tokenHash}&type=magiclink`, { redirect: 'manual' });
  mergeSetCookies(jar, res.headers.getSetCookie());
  saveJar(email, jar);
  // verify
  const st = await fetch(`${BASE}/api/billing/status`, { headers: { cookie: cookieHeader(jar) } });
  const body = await st.json().catch(() => ({}));
  out({ email, verify_status: res.status, location: res.headers.get('location'), cookies: Object.keys(jar), billing_status: st.status, pro: body.pro });
}

async function status(email) {
  const jar = loadJar(email);
  const st = await fetch(`${BASE}/api/billing/status`, { headers: { cookie: cookieHeader(jar) } });
  out({ status: st.status, body: await st.json().catch(() => null) });
}

async function start(who, url, xff) {
  const headers = { 'content-type': 'application/json' };
  if (who !== 'anon') headers.cookie = cookieHeader(loadJar(who));
  if (xff) { headers['x-forwarded-for'] = xff; headers['x-real-ip'] = xff; }
  const res = await fetch(`${BASE}/api/audits/start`, {
    method: 'POST', headers, body: JSON.stringify({ url }),
  });
  out({ http: res.status, body: await res.json().catch(() => null) });
}

async function streamCmd(who, id) {
  const headers = {};
  if (who !== 'anon') headers.cookie = cookieHeader(loadJar(who));
  const res = await fetch(`${BASE}/api/audits/${id}/stream`, { headers });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let done = null; let lastEvent = null;
  const events = [];
  const deadline = Date.now() + 60000;
  outer: while (Date.now() < deadline) {
    const { value, done: rdone } = await reader.read();
    if (rdone) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
      const ev = (chunk.match(/^event: (.*)$/m) || [])[1];
      const dl = (chunk.match(/^data: (.*)$/m) || [])[1];
      if (!ev) continue;
      lastEvent = ev;
      events.push(ev);
      if (ev === 'done' || ev === 'error') {
        done = dl ? JSON.parse(dl) : null;
        try { await reader.cancel(); } catch {}
        break outer;
      }
    }
  }
  const hasUserId = done ? JSON.stringify(done).includes('"user_id"') : null;
  out({ http: res.status, lastEvent, eventsSeen: events, hasUserIdKey: hasUserId, done });
}

async function exportCmd(who, id) {
  const headers = {};
  if (who !== 'anon') headers.cookie = cookieHeader(loadJar(who));
  const res = await fetch(`${BASE}/api/audits/${id}/export`, { headers });
  const ct = res.headers.get('content-type');
  let body = null;
  if (ct && ct.includes('json')) body = await res.json().catch(() => null);
  else body = `[${ct}] ${res.headers.get('content-length') || '?'} bytes`;
  out({ http: res.status, contentType: ct, body });
}

async function checkout(email, priceId) {
  const jar = loadJar(email);
  const res = await fetch(`${BASE}/api/billing/checkout`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: cookieHeader(jar) },
    body: JSON.stringify({ priceId }),
  });
  out({ http: res.status, body: await res.json().catch(() => null) });
}

try {
  if (cmd === 'login') await login(args[0]);
  else if (cmd === 'status') await status(args[0]);
  else if (cmd === 'start') await start(args[0], args[1], args[2]);
  else if (cmd === 'stream') await streamCmd(args[0], args[1]);
  else if (cmd === 'export') await exportCmd(args[0], args[1]);
  else if (cmd === 'checkout') await checkout(args[0], args[1]);
  else { out({ error: 'unknown cmd ' + cmd }); process.exit(1); }
} catch (e) {
  out({ error: String((e && e.message) || e), stack: e && e.stack });
  process.exit(1);
}
