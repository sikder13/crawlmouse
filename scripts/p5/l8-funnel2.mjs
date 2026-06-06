// TC-L8 (capture v2) — drive the funnel as AU1(Pro); capture funnel events by overriding the
// browser's outbound network primitives (sendBeacon/fetch/XHR) in an init script, scanning each
// payload for the funnel event names and reporting to a Node-side sink. Catches the send attempt
// regardless of endpoint/CORS/batching-target. No x-forwarded-for (it CORS-blocks posthog ingestion).
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const ROOT = '/home/udsik/nahl-clients-projects/crawlmouse-v1.0.0';
const require = createRequire(ROOT + '/apps/web/');
const { chromium } = require('@playwright/test');
const BASE = 'http://localhost:3000';
const [JAR_EMAIL, AUDIT_URL, EMAIL] = process.argv.slice(2);
const FUNNEL = ['landing-view','audit-submitted','audit-completed','email-captured','public-share-clicked','csv-download','pro-upgrade'];
const jarPath = `/tmp/p5jar_${JAR_EMAIL.replace(/[^a-z0-9]/gi, '_')}.json`;
const jar = existsSync(jarPath) ? JSON.parse(readFileSync(jarPath, 'utf8')) : {};
const cookies = Object.entries(jar).map(([name, value]) => ({ name, value, domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }));

const captured = [];   // {event}
const rawHits = [];    // urls that contained a funnel name (diagnostic)
const browser = await chromium.launch();
const context = await browser.newContext();
if (cookies.length) await context.addCookies(cookies);
await context.exposeFunction('__p5hit', (event, url) => { captured.push({ event }); rawHits.push((url||'').slice(0,60)); });
await context.addInitScript((FUNNEL) => {
  const scan = (where, payload) => {
    try {
      let s = '';
      if (typeof payload === 'string') s = payload;
      else if (payload && payload.toString && !(payload instanceof ArrayBuffer)) s = String(payload);
      // also try to decode base64 'data=' chunks
      const tryDecode = (str) => { try { return atob(decodeURIComponent((str.split('data=')[1]||'').split('&')[0])); } catch { return ''; } };
      const hay = s + ' ' + (s.includes('data=') ? tryDecode(s) : '') + ' ' + (where || '');
      for (const ev of FUNNEL) if (hay.includes('"' + ev + '"') || hay.includes(ev)) { if (window.__p5hit) window.__p5hit(ev, where); }
    } catch {}
  };
  const ob = navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null;
  if (ob) navigator.sendBeacon = function (url, data) { scan(url, data); return ob(url, data); };
  const of = window.fetch;
  window.fetch = function (input, init) { try { scan(typeof input === 'string' ? input : (input && input.url), init && init.body); } catch {} return of.apply(this, arguments); };
  const xo = XMLHttpRequest.prototype.open, xs = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; return xo.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (body) { try { scan(this.__u, body); } catch {} return xs.apply(this, arguments); };
}, FUNNEL);

const page = await context.newPage();
const log = [];
const note = (m) => log.push(`${new Date().toISOString()} ${m}`);
const seen = (ev) => captured.some((c) => c.event === ev);

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
note('/ landing-view=' + seen('landing-view'));
await page.fill('input[placeholder="https://your-store.com"]', AUDIT_URL);
await Promise.all([ page.waitForURL(/\/audit\//, { timeout: 30000 }).catch(() => note('no /audit nav')), page.click('button:has-text("Grade it")') ]);
note('submitted ' + page.url() + ' audit-submitted=' + seen('audit-submitted'));
for (let i = 0; i < 45; i++) { if (seen('audit-completed')) break; await page.waitForTimeout(2000); }
note('audit-completed=' + seen('audit-completed'));
await page.waitForTimeout(1500);
const csv = page.locator('a:has-text("Download CSV")');
if (await csv.count()) { await page.evaluate(() => document.querySelectorAll('a').forEach((a) => a.textContent && a.textContent.includes('Download CSV') && a.addEventListener('click', (e) => e.preventDefault(), { capture: true }))); await csv.first().click(); await page.waitForTimeout(1500); }
note('csv-download=' + seen('csv-download'));
await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
await page.fill('input[type="email"]', EMAIL);
await page.click('button[type="submit"]');
for (let i = 0; i < 12; i++) { if (seen('email-captured')) break; await page.waitForTimeout(1000); }
note('email-captured=' + seen('email-captured'));
await browser.close();

const counts = {};
for (const ev of FUNNEL) counts[ev] = captured.filter((c) => c.event === ev).length;
const result = { auditUrl: AUDIT_URL, counts, distinctEventsSeen: [...new Set(captured.map((c) => c.event))], rawHitSample: rawHits.slice(0, 8), log };
writeFileSync('/tmp/p5_l8_result.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
