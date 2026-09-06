import { writeFileSync } from 'node:fs';
import { CONCURRENCY, pool } from './fetcher.js';
import { PANEL_PATH, argNumber, argValue, assertPanelNotFrozen } from './paths.js';
import { groupFor, isCloudflare, probeDomain } from './probe.js';
import { fetchTrancoList, sampleUniform } from './tranco.js';
import { scaledTargets } from './build-panel-targets.js';
import type { PanelEntry, PanelFile, PanelGroup } from './types.js';

const RANK_MIN = 1_000;
const RANK_MAX = 100_000;
const TRANCO_PREFIX = 100_000;

/**
 * How many candidates to sample per target slot. Most land in no stratum at all.
 *
 * Sized from the rehearsal, not guessed: 9 of 91 probed candidates were Cloudflare-fronted AND
 * ad-supported, so filling 400 needs roughly 4,000 candidates and a multiple of 6 (3,600) would
 * come up short. Probing stops the moment every stratum is full, so a generous multiple costs
 * nothing when the yield is good — while too small a one costs a second pass over several thousand
 * third-party sites, which is the expensive mistake.
 */
const CANDIDATE_MULTIPLE = 12;
const BATCH = 120;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  assertPanelNotFrozen();

  const limit = argNumber(argv, 'limit');
  const targets = scaledTargets(limit);
  const wanted = Object.values(targets).reduce((a, b) => a + b, 0);
  const date = argValue(argv, 'tranco-date') ?? yesterdayIso();

  console.log(`Building panel: ${JSON.stringify(targets)} (${wanted} domains)`);
  console.log(`Tranco list for ${date}, ranks ${RANK_MIN}–${RANK_MAX}\n`);

  const list = await fetchTrancoList(date, TRANCO_PREFIX);
  const candidates = sampleUniform(list.rows, RANK_MIN, RANK_MAX, wanted * CANDIDATE_MULTIPLE);
  console.log(`Tranco ${list.listId}: ${list.rows.length} rows → ${candidates.length} candidates sampled\n`);

  const filled: Record<PanelGroup, PanelEntry[]> = { cf_ads: [], cf_no_ads: [], ads_no_cf: [] };
  const isFull = () => (Object.keys(targets) as PanelGroup[]).every((g) => filled[g].length >= targets[g]);

  let probed = 0;
  const started = Date.now();
  for (let i = 0; i < candidates.length && !isFull(); i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const probes = await pool(batch, CONCURRENCY, (c) => probeDomain(c.domain));
    probed += batch.length;

    for (let j = 0; j < probes.length; j++) {
      const p = probes[j]!;
      if (p.error || p.homepageStatus === 0) continue;
      // Unclassifiable: the ads.txt probe failed, so this domain has no ads signal either way.
      if (p.adsTxtError !== null) continue;
      const group = groupFor(isCloudflare(p.server, p.cfRay), p.adsTxtValid);
      if (!group || filled[group].length >= targets[group]) continue;
      filled[group].push({
        domain: p.domain,
        rank: batch[j]!.rank,
        group,
        evidence: {
          server: p.server,
          cfRay: p.cfRay,
          homepageStatus: p.homepageStatus,
          adsTxtStatus: p.adsTxtStatus,
          adsTxtValid: p.adsTxtValid,
        },
      });
    }
    const counts = (Object.keys(targets) as PanelGroup[])
      .map((g) => `${g} ${filled[g].length}/${targets[g]}`)
      .join('  ');
    console.log(`  probed ${probed}/${candidates.length} — ${counts}`);
  }

  const entries = [...filled.cf_ads, ...filled.cf_no_ads, ...filled.ads_no_cf].sort((a, b) => a.rank - b.rank);
  const panel: PanelFile = {
    builtAt: new Date().toISOString(),
    tranco: { listId: list.listId, date: list.date, url: list.url, prefix: list.prefix },
    rankRange: { min: RANK_MIN, max: RANK_MAX },
    targets,
    candidatesProbed: probed,
    entries,
  };
  writeFileSync(PANEL_PATH, `${JSON.stringify(panel, null, 2)}\n`, 'utf8');

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\nPanel written: ${PANEL_PATH}`);
  for (const g of Object.keys(targets) as PanelGroup[]) {
    const short = filled[g].length < targets[g] ? '  ← SHORT of target' : '';
    console.log(`  ${g.padEnd(10)} ${String(filled[g].length).padStart(4)} / ${targets[g]}${short}`);
  }
  console.log(`  total      ${String(entries.length).padStart(4)} / ${wanted}`);
  console.log(`  probed ${probed} candidates in ${elapsed}s`);
  if (entries.length < wanted) {
    console.log('\nA short group means the candidate pool ran out before the target was met.');
    console.log('Re-run with a wider rank range or a larger CANDIDATE_MULTIPLE to fill it.');
  }
}

/** Today's list is published late in the day; yesterday's is always available. */
function yesterdayIso(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

main().catch((e: unknown) => {
  console.error(`\n${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
