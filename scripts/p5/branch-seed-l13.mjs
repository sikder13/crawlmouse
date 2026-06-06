// Branch-window L13 seed: on the disposable BRANCH only, create a FREE user + a PRO user and two
// completed findings-rich audits (>5 'deep_page' findings each) so the free/Pro/cross-tenant/anon
// cap split is observable on the live SSE. Reads branch creds from env: SB_URL, SB_SERVICE.
// (id-scoped inserts on a disposable branch are explicitly allowed by the plan.)
// Usage: SB_URL=... SB_SERVICE=... node branch-seed-l13.mjs <RUN>
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire('/home/udsik/nahl-clients-projects/crawlmouse-v1.0.0/apps/web/');
const { createClient } = require('@supabase/supabase-js');
const URL = process.env.SB_URL, KEY = process.env.SB_SERVICE;
const RUN = process.argv[2] || 'branch';
const sb = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const out = (o) => console.log(JSON.stringify(o));
const N = 7; // >5 deep_page findings per audit

async function mkUser(tag) {
  const email = `nahlai.tech+p5branch-${tag}-${RUN}@gmail.com`;
  const { data, error } = await sb.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw new Error(`createUser ${tag}: ${error.message}`);
  return { uid: data.user.id, email };
}

async function seedAudit(ownerUid, domain) {
  const auditId = randomUUID();
  const { error: aerr } = await sb.from('audits').insert({
    id: auditId, user_id: ownerUid, url: `https://${domain}`, status: 'completed',
    cms_detected: 'custom', page_count: N + 2, link_count: (N + 2) * 3, score: 55, grade: 'D',
    settings: { pageCap: 500 }, started_at: new Date().toISOString(), completed_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 30 * 864e5).toISOString(),
  });
  if (aerr) throw new Error(`insert audit: ${aerr.message}`);
  // pages: home (depth 0) + N deep pages (depth 4+) so deep_page findings reference real page urls
  const pages = [{ id: randomUUID(), audit_id: auditId, url: `https://${domain}`, url_hash: randomUUID().replace(/-/g, ''), title: 'Home', status_code: 200, depth: 0, in_degree: 1, out_degree: N, is_orphan: false }];
  for (let i = 1; i <= N; i++) pages.push({ id: randomUUID(), audit_id: auditId, url: `https://${domain}/deep/level/${i}`, url_hash: randomUUID().replace(/-/g, ''), title: `Deep ${i}`, status_code: 200, depth: 3 + i, in_degree: 1, out_degree: 1, is_orphan: false });
  const { error: perr } = await sb.from('pages').insert(pages);
  if (perr) throw new Error(`insert pages: ${perr.message}`);
  const findings = pages.slice(1).map((p) => ({ id: randomUUID(), audit_id: auditId, category: 'deep_page', severity: 'medium', page_id: p.id, payload: { depth: p.depth } }));
  const { error: ferr } = await sb.from('findings').insert(findings);
  if (ferr) throw new Error(`insert findings: ${ferr.message}`);
  return auditId;
}

try {
  const free = await mkUser('free');
  const pro = await mkUser('pro');
  // grant Pro via id-scoped UPDATE (disposable branch only; never prod)
  const proUntil = new Date(Date.now() + 30 * 864e5).toISOString();
  const { error: uerr } = await sb.from('users').update({ pro_until: proUntil }).eq('id', pro.uid);
  if (uerr) throw new Error(`pro update: ${uerr.message}`);
  const auditFree = await seedAudit(free.uid, 'branch-free.example');
  const auditPro = await seedAudit(pro.uid, 'branch-pro.example');
  // verify finding counts
  const { count: cf } = await sb.from('findings').select('*', { count: 'exact', head: true }).eq('audit_id', auditFree);
  const { count: cp } = await sb.from('findings').select('*', { count: 'exact', head: true }).eq('audit_id', auditPro);
  out({ free, pro, proUntil, auditFree, auditPro, findingsFree: cf, findingsPro: cp });
} catch (e) {
  out({ error: String(e.message || e) });
  process.exit(1);
}
