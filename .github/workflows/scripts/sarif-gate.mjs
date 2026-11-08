// Fails the CodeQL job on a high or critical result: security-severity 7.0 or more (GitHub's bands:
// 7.0–8.9 high, 9.0+ critical). CodeQL puts its query packs' rules under run.tool.extensions and points
// a result at one through result.rule.toolComponent, so both places are read. A SARIF directory with
// no run, or a run that extracted no file, fails too: a scan that read nothing cannot pass.
//
// A result listed in the reviewed baseline (codeql-baseline.json: rule, file and CodeQL's
// primaryLocationLineHash fingerprint, which follows the line's content, not its number) is accepted
// until the baseline expires; from the day after its `expires` date, every result fails again.
//
//   node .github/workflows/scripts/sarif-gate.mjs <directory of .sarif files> [baseline.json]

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BLOCKING_SEVERITY = 7.0;
const EXTRACTED = 'js/diagnostics/successfully-extracted-files';
const DAY_MS = 24 * 60 * 60 * 1000;

/** The rule a result names, from the driver or from the extension its toolComponent points at. */
function ruleOf(run, result) {
  const ref = result.rule;
  if (ref?.toolComponent?.index !== undefined) {
    const component = run.tool.extensions?.[ref.toolComponent.index];
    return component?.rules?.[ref.index] ?? component?.rules?.find((r) => r.id === ref.id);
  }
  const rules = run.tool.driver.rules ?? [];
  if (ref?.index !== undefined) return rules[ref.index];
  if (result.ruleIndex !== undefined) return rules[result.ruleIndex];
  const id = ref?.id ?? result.ruleId;
  return [...rules, ...(run.tool.extensions ?? []).flatMap((e) => e.rules ?? [])].find(
    (r) => r.id === id,
  );
}

function extractedFiles(run) {
  return (run.invocations ?? [])
    .flatMap((i) => i.toolExecutionNotifications ?? [])
    .filter((n) => n.descriptor?.id === EXTRACTED).length;
}

const keyOf = (rule, file, fingerprint) => `${rule} ${file} ${fingerprint}`;

/**
 * The baseline's allowance per key, or the problems that make it unusable. It is accepted through the
 * whole of its `expires` day (UTC) and not after.
 */
function readBaseline(baseline, now) {
  if (!baseline) return { allowance: new Map(), problems: [], expired: false };
  const problems = [];
  const end = Date.parse(`${baseline.expires}T00:00:00Z`) + DAY_MS;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(baseline.expires)) || Number.isNaN(end)) {
    problems.push(
      `baseline: expires must be a YYYY-MM-DD date, not ${JSON.stringify(baseline.expires)}`,
    );
  }
  const allowance = new Map();
  for (const e of baseline.entries ?? []) {
    if (!e.rule || !e.file || !e.fingerprint || !String(e.verdict ?? '').trim()) {
      problems.push(
        `baseline: an entry needs rule, file, fingerprint and verdict: ${JSON.stringify(e)}`,
      );
      continue;
    }
    const key = keyOf(e.rule, e.file, e.fingerprint);
    allowance.set(key, (allowance.get(key) ?? 0) + (e.count ?? 1));
  }
  return { allowance, problems, expired: !(now.getTime() < end) };
}

/**
 * @param {object[]} sarifs parsed SARIF logs
 * @param {{ baseline?: { expires: string, entries: object[] }, now?: Date }} [options]
 * @returns {{ blocking: string[], accepted: string[], stale: string[], problems: string[], expired: boolean }}
 */
export function gate(sarifs, { baseline, now = new Date() } = {}) {
  const runs = sarifs.flatMap((s) => s.runs ?? []);
  if (runs.length === 0) {
    return { blocking: [], accepted: [], stale: [], problems: ['no SARIF run'], expired: false };
  }
  const { allowance, problems, expired } = readBaseline(baseline, now);
  const blocking = [];
  const accepted = [];
  const used = new Map();
  for (const run of runs) {
    if (extractedFiles(run) === 0) problems.push(`${run.tool.driver.name}: extracted no file`);
    for (const result of run.results ?? []) {
      // A suppression written in the code is not a review: only the baseline accepts a result.
      if (result.baselineState === 'absent') continue;
      const rule = ruleOf(run, result);
      if (!rule) {
        problems.push(
          `a result names a rule the SARIF does not describe: ${result.ruleId ?? result.rule?.id}`,
        );
        continue;
      }
      const severity = Number(rule.properties?.['security-severity'] ?? 0);
      if (severity < BLOCKING_SEVERITY) continue;
      const where = result.locations?.[0]?.physicalLocation;
      const file = where?.artifactLocation?.uri ?? '(no location)';
      const line = `${rule.id} (${severity}) ${file}:${where?.region?.startLine ?? '?'}`;
      const key = keyOf(rule.id, file, result.partialFingerprints?.primaryLocationLineHash);
      const n = used.get(key) ?? 0;
      if (!expired && n < (allowance.get(key) ?? 0)) {
        used.set(key, n + 1);
        accepted.push(line);
      } else {
        blocking.push(line);
      }
    }
  }
  const stale = [...allowance.keys()].filter((k) => (used.get(k) ?? 0) < allowance.get(k));
  return {
    blocking,
    accepted,
    stale: expired ? [] : stale,
    problems,
    expired: Boolean(baseline) && expired,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [dir, baselinePath] = process.argv.slice(2);
  const files = dir ? readdirSync(dir).filter((f) => f.endsWith('.sarif')) : [];
  const baseline = baselinePath ? JSON.parse(readFileSync(baselinePath, 'utf8')) : undefined;
  const { blocking, accepted, stale, problems, expired } = gate(
    files.map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))),
    { baseline },
  );
  if (expired)
    console.log(`::warning::the baseline expired after ${baseline.expires}: no result is accepted`);
  for (const p of problems) console.log(`::error::${p}`);
  for (const b of blocking) console.log(`::error::high or critical: ${b}`);
  for (const s of stale) console.log(`::warning::baseline entry no longer found: ${s}`);
  console.log(
    `${files.length} SARIF file(s); ${blocking.length} high or critical result(s) failing, ${accepted.length} accepted by the baseline`,
  );
  process.exit(problems.length || blocking.length ? 1 : 0);
}
