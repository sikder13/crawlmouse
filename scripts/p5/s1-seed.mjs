// TC-S1 — seed the 10 reference benchmark audits via the real app path (POST /api/audits/start),
// as AU1, cycling x-forwarded-for across >=2 fresh IPs (per-IP user cap = 5/day). Prints id per url.
// Usage: node s1-seed.mjs   (logs in via the saved AU1 jar)
import { readFileSync, existsSync } from 'node:fs';
const BASE = 'http://localhost:3000';
// Run as AU1CLAIM (FREE) so crawls use pageCap 500 (not Pro's 2000, which would blow the Inngest step-output limit).
const AU1_EMAIL = 'nahlai.tech+p5claim-202606051141@gmail.com';
const jarPath = `/tmp/p5jar_${AU1_EMAIL.replace(/[^a-z0-9]/gi, '_')}.json`;
const jar = existsSync(jarPath) ? JSON.parse(readFileSync(jarPath, 'utf8')) : {};
const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

const SITES = [
  ['shopify', 'https://www.shopify.com'],
  ['wordpress', 'https://wordpress.org'],
  ['webflow', 'https://webflow.com'],
  ['squarespace', 'https://www.squarespace.com'],
  ['wix', 'https://www.wix.com'],
  ['ghost', 'https://ghost.org'],
  ['nextjs', 'https://nextjs.org'],
  ['drupal', 'https://www.drupal.org'],
  ['joomla', 'https://www.joomla.org'],
  ['gatsby', 'https://gatsby.dev'],
];
const IPS = ['203.0.113.81', '203.0.113.82']; // 5 per IP -> 10 within the per-IP user cap of 5

const results = [];
for (let i = 0; i < SITES.length; i++) {
  const [cms, url] = SITES[i];
  const ip = IPS[Math.floor(i / 5)];
  const res = await fetch(`${BASE}/api/audits/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'x-forwarded-for': ip, 'x-real-ip': ip },
    body: JSON.stringify({ url }),
  });
  const body = await res.json().catch(() => null);
  results.push({ cms, url, ip, http: res.status, auditId: body?.auditId ?? null, err: body?.error ?? null });
  console.log(JSON.stringify(results[results.length - 1]));
}
console.log('IDS=' + results.filter((r) => r.auditId).map((r) => r.auditId).join(','));
