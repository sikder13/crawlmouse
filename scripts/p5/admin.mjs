// P5 Supabase admin helper (service-role). Subcommands print JSON to stdout.
// Usage: node admin.mjs <cmd> [...args]   (reads URL + service key from apps/web/.env.local)
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire('/home/udsik/nahl-clients-projects/crawlmouse-v1.0.0/apps/web/');
const { createClient } = require('@supabase/supabase-js');

const env = Object.fromEntries(
  readFileSync('/home/udsik/nahl-clients-projects/crawlmouse-v1.0.0/apps/web/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
// Allow overriding the target (e.g. a branch) via env vars passed to the process.
const URL = process.env.SB_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SB_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const [cmd, ...args] = process.argv.slice(2);
const out = (o) => console.log(JSON.stringify(o));
try {
  if (cmd === 'createuser') {
    const { data, error } = await sb.auth.admin.createUser({ email: args[0], email_confirm: true });
    if (error) { out({ error: error.message }); process.exit(1); }
    out({ uid: data.user.id, email: data.user.email });
  } else if (cmd === 'genlink') {
    // args: <type magiclink|signup> <email>
    const { data, error } = await sb.auth.admin.generateLink({ type: args[0], email: args[1] });
    if (error) { out({ error: error.message }); process.exit(1); }
    out({ hashed_token: data.properties.hashed_token, action_link: data.properties.action_link,
          verification_type: data.properties.verification_type, uid: data.user?.id });
  } else if (cmd === 'getuser') {
    const { data, error } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) { out({ error: error.message }); process.exit(1); }
    const u = data.users.find((x) => x.email === args[0]);
    out({ uid: u?.id ?? null, email: u?.email ?? null });
  } else if (cmd === 'deluser') {
    const { error } = await sb.auth.admin.deleteUser(args[0]);
    out({ deleted: !error, error: error?.message });
  } else if (cmd === 'sql') {
    // run a read-only-ish SQL via PostgREST rpc is not available; use a direct select on a table:
    out({ error: 'sql not supported here; use MCP' });
  } else {
    out({ error: 'unknown cmd ' + cmd });
    process.exit(1);
  }
} catch (e) {
  out({ error: String(e && e.message || e) });
  process.exit(1);
}
