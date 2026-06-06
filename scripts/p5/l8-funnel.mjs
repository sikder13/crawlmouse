// TC-L8 — drive the funnel in a real browser as AU1 (Pro); count each PostHog funnel event
// exactly-once via the NETWORK sink (intercept every posthog.com capture request and decode the body).
// Events route directly to us.i.posthog.com (NEXT_PUBLIC_POSTHOG_HOST set), so we match *posthog.com*.
// Pro session (cookie-injected) lets us capture csv-download too; Pro also waives the per-domain cap.
// Usage: node l8-funnel.mjs <email_jar> <xff_ip> <audit_url> <email_for_email_captured>
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import zlib from 'node:zlib';
const ROOT = '/home/udsik/nahl-clients-projects/crawlmouse-v1.0.0';
const require = createRequire(ROOT + '/apps/web/');
const { chromium } = require('@playwright/test');
const BASE = 'http://localhost:3000';
const [JAR_EMAIL, XFF, AUDIT_URL, EMAIL] = process.argv.slice(2);
const FUNNEL = ['landing-view','audit-submitted','audit-completed','email-captured','public-share-clicked','csv-download','pro-upgrade'];

const jarPath = `/tmp/p5jar_${JAR_EMAIL.replace(/[^a-z0-9]/gi, '_')}.json`;
const jar = existsSync(jarPath) ? JSON.parse(readFileSync(jarPath, 'utf8')) : {};
const cookies = Object.entries(jar).map(([name, value]) => ({ name, value, domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }));

function decodeEvents(postData) {
  if (!postData) return [];
  const tryParse = (s) => { try { return JSON.parse(s); } catch { return null; } };
  const fromBytes = (buf) => {
    let j = tryParse(buf.toString('utf8'));
    if (!j) { try { j = tryParse(zlib.gunzipSync(buf).toString('utf8')); } catch {} }
    if (!j) { try { j = tryParse(zlib.inflateSync(buf).toString('utf8')); } catch {} }
    return j;
  };
  let parsed = tryParse(postData);                          // raw JSON
  if (!parsed && postData.includes('data=')) {              // form-encoded data=<base64>
    try {
      const params = new URLSearchParams(postData);
      const data = params.get('data');
      if (data) parsed = fromBytes(Buffer.from(decodeURIComponent(data), 'base64')) || tryParse(decodeURIComponent(data));
    } catch {}
  }
  if (!parsed) parsed = fromBytes(Buffer.from(postData, 'base64'));   // bare base64(+gzip)
  if (!parsed) return [];
  const arr = Array.isArray(parsed) ? parsed : (parsed.batch || [parsed]);
  return arr.filter((e) => e && e.event).map((e) => ({ event: e.event, distinct_id: e.properties?.distinct_id, url: e.properties?.['$current_url'] }));
}

const captured = [];
const phRequests = [];
const browser = await chromium.launch();
const context = await browser.newContext({ extraHTTPHeaders: XFF ? { 'x-forwarded-for': XFF, 'x-real-ip': XFF } : {} });
if (cookies.length) await context.addCookies(cookies);
context.on('request', (req) => {
  const u = req.url();
  // posthog sends captures as GET /e/?data=<base64> OR POST /e/ /batch/ /i/v0/e/ — capture BOTH.
  // (skip us-assets static module loads — they carry no event payload)
  if (/(us|eu|app)\.i\.posthog\.com|\/ingest\/(e|batch|i)\b/.test(u)) {
    phRequests.push(req.method() + ' ' + u.slice(0, 70));
    const evs = [];
    try { // GET capture: data param in the query string
      const qd = new URL(u).searchParams.get('data');
      if (qd) evs.push(...decodeEvents('data=' + encodeURIComponent(qd)));
    } catch {}
    try { if (req.postData()) evs.push(...decodeEvents(req.postData())); } catch {}
    for (const e of evs) captured.push(e);
  }
});
const page = await context.newPage();
const log = [];
const note = (m) => { log.push(`${new Date().toISOString()} ${m}`); };
const seen = (ev) => captured.some((c) => c.event === ev);

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000); // let posthog finish bootstrapping + flush landing-view
note('at ' + page.url() + ' landing-view=' + seen('landing-view') + ' phReqs=' + phRequests.length);

await page.fill('input[placeholder="https://your-store.com"]', AUDIT_URL);
await Promise.all([
  page.waitForURL(/\/audit\//, { timeout: 30000 }).catch(() => note('no /audit nav')),
  page.click('button:has-text("Grade it")'),
]);
note('submitted; at ' + page.url());

for (let i = 0; i < 45; i++) { if (seen('audit-completed')) break; await page.waitForTimeout(2000); }
note('audit-completed=' + seen('audit-completed'));

await page.waitForTimeout(1500);
const csvLink = page.locator('a:has-text("Download CSV")');
if (await csvLink.count()) {
  await page.evaluate(() => { document.querySelectorAll('a').forEach((a) => { if (a.textContent && a.textContent.includes('Download CSV')) a.addEventListener('click', (e) => e.preventDefault(), { capture: true }); }); });
  await csvLink.first().click();
  await page.waitForTimeout(2000);
}
note('csv-download=' + seen('csv-download') + ' (csvLinkPresent=' + (await csvLink.count() > 0) + ')');

await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
await page.fill('input[type="email"]', EMAIL);
await page.click('button[type="submit"]');
for (let i = 0; i < 15; i++) { if (seen('email-captured')) break; await page.waitForTimeout(1000); }
note('email-captured=' + seen('email-captured'));
await page.waitForTimeout(2500); // let final batches flush
await browser.close();

const counts = {};
for (const ev of FUNNEL) counts[ev] = captured.filter((c) => c.event === ev).length;
const funnelCaptures = captured.filter((c) => FUNNEL.includes(c.event));
const result = { auditUrl: AUDIT_URL, counts, funnelCaptures, phRequestCount: phRequests.length, samplePhReqs: phRequests.slice(0, 5), allEventNames: [...new Set(captured.map((c) => c.event))], log };
writeFileSync('/tmp/p5_l8_result.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
