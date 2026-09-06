import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONCURRENCY,
  DOMAIN_DEADLINE_MS,
  ROBOTS_FETCH_MAX_BYTES,
  ROBOTS_STORE_MAX_BYTES,
  errorMessage,
  fetchHeaders,
  fetchText,
  pool,
  withDeadline,
  withRetry,
} from './fetcher.js';
import { SNAPSHOTS_DIR, argNumber, argValue, ensureDir, loadPanel, todayIso } from './paths.js';
import { accessMatrix, extractContentSignals, sha256 } from './robots-access.js';
import { evidenceChanged } from './probe.js';
import { ALL_TOKENS } from './tokens.js';
import type { DomainSnapshot, PanelEntry, RobotsCapture } from './types.js';

async function captureRobots(domain: string): Promise<RobotsCapture> {
  try {
    const res = await withRetry(() => fetchText(`https://${domain}/robots.txt`, ROBOTS_FETCH_MAX_BYTES));
    const full = Buffer.from(res.body, 'utf8');
    const truncated = full.byteLength > ROBOTS_STORE_MAX_BYTES;
    // Slice on the byte budget, then decode — so the stored text is never a torn code point.
    const stored = truncated
      ? new TextDecoder('utf-8').decode(full.subarray(0, ROBOTS_STORE_MAX_BYTES))
      : res.body;
    return {
      finalUrl: res.finalUrl,
      status: res.status,
      body: stored,
      sha256: sha256(stored),
      bytes: full.byteLength,
      truncated,
      error: null,
    };
  } catch (e) {
    return { finalUrl: null, status: null, body: null, sha256: null, bytes: null, truncated: false, error: errorMessage(e) };
  }
}

function snapshotDomain(entry: PanelEntry): Promise<DomainSnapshot> {
  // A domain that hangs must become a recorded error, never a run that exits silently. See
  // fetcher.ts `withDeadline` for why a request-level timeout is not enough on its own.
  return withDeadline(() => snapshotDomainInner(entry), DOMAIN_DEADLINE_MS, `snapshot ${entry.domain}`).catch(
    (e: unknown): DomainSnapshot => ({
      domain: entry.domain,
      group: entry.group,
      rank: entry.rank,
      fetchedAt: new Date().toISOString(),
      robots: { finalUrl: null, status: null, body: null, sha256: null, bytes: null, truncated: false, error: errorMessage(e) },
      access: [],
      contentSignals: [],
      homepage: { status: null, server: null, cfRay: false, error: errorMessage(e) },
      adsTxt: { status: null, error: null },
      groupMismatch: false,
    }),
  );
}

async function snapshotDomainInner(entry: PanelEntry): Promise<DomainSnapshot> {
  const fetchedAt = new Date().toISOString();
  const robots = await captureRobots(entry.domain);

  let homepage: DomainSnapshot['homepage'] = { status: null, server: null, cfRay: false, error: null };
  try {
    const head = await withRetry(() => fetchHeaders(`https://${entry.domain}/`));
    homepage = { status: head.status, server: head.server, cfRay: head.cfRay, error: null };
  } catch (e) {
    homepage = { status: null, server: null, cfRay: false, error: errorMessage(e) };
  }

  let adsTxt: DomainSnapshot['adsTxt'] = { status: null, error: null };
  try {
    // Presence re-check only. The body is never stored after the panel build.
    const head = await withRetry(() => fetchHeaders(`https://${entry.domain}/ads.txt`));
    adsTxt = { status: head.status, error: null };
  } catch (e) {
    adsTxt = { status: null, error: errorMessage(e) };
  }

  const body = robots.status === 200 && robots.body ? robots.body : '';

  return {
    domain: entry.domain,
    group: entry.group,
    rank: entry.rank,
    fetchedAt,
    robots,
    access: body ? accessMatrix(body, ALL_TOKENS) : [],
    contentSignals: body ? extractContentSignals(body) : [],
    homepage,
    adsTxt,
    groupMismatch:
      homepage.error === null &&
      evidenceChanged(entry.evidence, { server: homepage.server, cfRay: homepage.cfRay, adsTxtStatus: adsTxt.status }),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const panel = loadPanel();
  const limit = argNumber(argv, 'limit');
  const date = argValue(argv, 'date') ?? todayIso();
  const entries = limit === undefined ? panel.entries : panel.entries.slice(0, limit);

  const outDir = join(SNAPSHOTS_DIR, date);
  ensureDir(outDir);

  console.log(`Snapshot ${date}: ${entries.length} domains, concurrency ${CONCURRENCY}\n`);
  const started = Date.now();

  const results = await pool(
    entries,
    CONCURRENCY,
    (e) => snapshotDomain(e),
    (done, total) => {
      if (done % 25 === 0 || done === total) console.log(`  ${done}/${total}`);
    },
  );

  for (const r of results) {
    writeFileSync(join(outDir, `${r.domain}.json`), `${JSON.stringify(r, null, 2)}\n`, 'utf8');
  }

  // A domain whose robots.txt could not be read is RECORDED with its error, never dropped: a run
  // whose failures vanish silently reports a denominator it did not measure.
  const failed = results.filter((r) => r.robots.error !== null);
  const mismatched = results.filter((r) => r.groupMismatch);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\nSnapshot written: ${outDir}`);
  console.log(`  attempted  ${results.length}`);
  console.log(`  succeeded  ${results.length - failed.length}`);
  console.log(`  failed     ${failed.length}   (recorded with an error status, not dropped)`);
  console.log(`  group re-verification mismatches  ${mismatched.length}`);
  console.log(`  elapsed    ${elapsed}s`);
}

main().catch((e: unknown) => {
  console.error(`\n${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
