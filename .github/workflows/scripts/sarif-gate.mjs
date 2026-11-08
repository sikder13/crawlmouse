// Fails the CodeQL job on a high or critical result: security-severity 7.0 or more (GitHub's bands:
// 7.0–8.9 high, 9.0+ critical). CodeQL puts its query packs' rules under run.tool.extensions and points
// a result at one through result.rule.toolComponent, so both places are read. A SARIF directory with
// no run, or a run that extracted no file, fails too: a scan that read nothing cannot pass.
//
//   node .github/workflows/scripts/sarif-gate.mjs <directory of .sarif files>

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BLOCKING_SEVERITY = 7.0;
const EXTRACTED = 'js/diagnostics/successfully-extracted-files';

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

/**
 * @param {object[]} sarifs parsed SARIF logs
 * @returns {{ blocking: string[], problems: string[] }}
 */
export function gate(sarifs) {
  const runs = sarifs.flatMap((s) => s.runs ?? []);
  if (runs.length === 0) return { blocking: [], problems: ['no SARIF run'] };
  const problems = [];
  const blocking = [];
  for (const run of runs) {
    if (extractedFiles(run) === 0) problems.push(`${run.tool.driver.name}: extracted no file`);
    for (const result of run.results ?? []) {
      if ((result.suppressions ?? []).length > 0 || result.baselineState === 'absent') continue;
      const rule = ruleOf(run, result);
      const severity = Number(rule?.properties?.['security-severity'] ?? 0);
      if (severity >= BLOCKING_SEVERITY) {
        const where = result.locations?.[0]?.physicalLocation;
        const file = where?.artifactLocation?.uri ?? '(no location)';
        blocking.push(`${rule.id} (${severity}) ${file}:${where?.region?.startLine ?? '?'}`);
      }
    }
  }
  return { blocking, problems };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = process.argv[2];
  const files = dir ? readdirSync(dir).filter((f) => f.endsWith('.sarif')) : [];
  const { blocking, problems } = gate(
    files.map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))),
  );
  for (const p of problems) console.log(`::error::${p}`);
  for (const b of blocking) console.log(`::error::high or critical: ${b}`);
  console.log(`${files.length} SARIF file(s); ${blocking.length} high or critical result(s)`);
  process.exit(problems.length || blocking.length ? 1 : 0);
}
