/**
 * IndexNow submission. Run this AFTER a production deploy, never during one.
 *
 *   pnpm indexnow                        # submits the production sitemap
 *   pnpm indexnow -- --dry-run           # prints what it would submit
 *   pnpm indexnow -- --sitemap=http://127.0.0.1:3000/sitemap.xml --dry-run
 *
 * IndexNow tells Bing, Yandex and the other participating engines that a set of URLs changed,
 * instead of waiting for them to come back and look. It matters here beyond Bing's own results:
 * ChatGPT and Copilot retrieval runs through Bing's index, so how fast a page lands there is how
 * fast an assistant can quote it.
 *
 * DELIBERATELY NOT WIRED INTO `pnpm build`. Vercel runs the build for every preview and every
 * branch, and a preview build pinging IndexNow would submit production URLs on the strength of
 * content that is not live — or worse, submit them dozens of times a day and get the host
 * rate-limited. This is a hand-run step after a production deploy, and it stays one.
 *
 * The key is public by design: ownership is proven by serving the same value at
 * https://<host>/<key>.txt, which is why that file is committed (apps/web/public/<key>.txt, served
 * at the site root by Next). The script cross-checks the two before submitting, because a key that
 * does not match its file is rejected by the API with a 403 that says nothing useful.
 *
 * Node stdlib only, like every other script here.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENDPOINT = 'https://api.indexnow.org/indexnow';
const DEFAULT_SITEMAP = 'https://crawlmouse.com/sitemap.xml';

// Resolved from this file, not from process.cwd(): `pnpm indexnow` runs at the repo root but a
// operator running `node scripts/indexnow-ping.mjs` from anywhere else must get the same answer.
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'public');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const sitemapUrl = args.find((a) => a.startsWith('--sitemap='))?.slice('--sitemap='.length) ?? DEFAULT_SITEMAP;

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

/**
 * The key, and the file that proves it.
 *
 * `INDEXNOW_KEY` wins when it is set. When it is not — a fresh shell, a machine with no
 * .env.local — the committed key file is the fallback rather than an error, because that file *is*
 * the public source of truth for this value and there is exactly one of it.
 */
function resolveKey() {
  const keyFiles = readdirSync(PUBLIC_DIR).filter((name) => /^[0-9a-f]{32,}\.txt$/.test(name));

  if (keyFiles.length !== 1) {
    fail(
      `Expected exactly one IndexNow key file in apps/web/public/, found ${keyFiles.length}` +
        (keyFiles.length ? `: ${keyFiles.join(', ')}` : ''),
    );
  }

  const fileName = keyFiles[0];
  const fromFile = readFileSync(path.join(PUBLIC_DIR, fileName), 'utf8').trim();
  const key = process.env.INDEXNOW_KEY?.trim() || fromFile;

  if (key !== fromFile) {
    fail(
      `INDEXNOW_KEY does not match apps/web/public/${fileName}.\n` +
        `  env:  ${key}\n  file: ${fromFile}\n` +
        `  IndexNow verifies ownership by fetching that file, so the two must agree.`,
    );
  }
  if (fileName !== `${key}.txt`) {
    fail(`Key file is named ${fileName} but contains ${key}; they must match.`);
  }

  return { key, keyFileName: fileName };
}

/** Every <loc> in the sitemap, in document order. */
async function readSitemap(url) {
  const response = await fetch(url, { headers: { accept: 'application/xml' } });
  if (!response.ok) {
    fail(`Sitemap fetch failed: ${response.status} ${response.statusText} — ${url}`);
  }
  const xml = await response.text();
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  if (urls.length === 0) fail(`No <loc> entries found in ${url}`);
  return urls;
}

const { key, keyFileName } = resolveKey();
const urlList = await readSitemap(sitemapUrl);

// IndexNow rejects a submission whose URLs are not all on the declared host, and it rejects the
// whole batch rather than the offending entry. Catching it here turns a 422 into a sentence.
const hosts = new Set(urlList.map((u) => new URL(u).host));
if (hosts.size !== 1) {
  fail(`Sitemap mixes hosts, which IndexNow rejects: ${[...hosts].join(', ')}`);
}
const host = [...hosts][0];

const payload = {
  host,
  key,
  keyLocation: `https://${host}/${keyFileName}`,
  urlList,
};

console.log(`\n  host          ${host}`);
console.log(`  key file      ${keyFileName}`);
console.log(`  key location  ${payload.keyLocation}`);
console.log(`  sitemap       ${sitemapUrl}`);
console.log(`  URLs          ${urlList.length}\n`);
for (const url of urlList) console.log(`    ${url}`);

if (dryRun) {
  console.log(`\n  DRY RUN — nothing submitted. Drop --dry-run to send.\n`);
  process.exit(0);
}

if (host !== new URL(DEFAULT_SITEMAP).host) {
  fail(
    `Refusing to submit ${host}. IndexNow is for the production host only;` +
      ` re-run with --dry-run to inspect a preview or a local build.`,
  );
}

const response = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(payload),
});

// 200 accepted, 202 accepted but the key is still being validated. Anything else is a real failure
// and the body usually says why.
if (response.status !== 200 && response.status !== 202) {
  fail(`IndexNow returned ${response.status} ${response.statusText}\n  ${await response.text()}`);
}

console.log(`  Submitted ${urlList.length} URLs — ${response.status} ${response.statusText}\n`);
