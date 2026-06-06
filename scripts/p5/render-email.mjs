// Render a Supabase email template (Go-template vars substituted) to a PNG + extract the verify href.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire('/home/udsik/nahl-clients-projects/crawlmouse-v1.0.0/apps/web/');
const { chromium } = require('@playwright/test');

const [tplPath, outPng] = process.argv.slice(2);
let html = readFileSync(tplPath, 'utf8')
  .replaceAll('{{ .SiteURL }}', 'http://localhost:3000')
  .replaceAll('{{ .TokenHash }}', 'SAMPLE_TOKEN_HASH_abc123')
  .replaceAll('{{ .Email }}', 'nahlai.tech+p5user@gmail.com')
  .replaceAll('{{ .ConfirmationURL }}', 'http://localhost:3000/login/verify?token_hash=SAMPLE_TOKEN_HASH_abc123&type=magiclink');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 680, height: 900 } });
await page.setContent(html, { waitUntil: 'networkidle' });
const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href*="verify"]')].map((a) => a.getAttribute('href')));
await page.screenshot({ path: outPng, fullPage: true });
await browser.close();
console.log('rendered ' + outPng + ' verify_hrefs=' + JSON.stringify(hrefs));
