// Fails the semgrep job on a blocking result: severity ERROR, or CRITICAL or HIGH (the levels of
// Semgrep's newer severity scale; the four packs the job runs used only ERROR and WARNING on
// 2026-11-09). A result whose severity is in neither BLOCKING nor NOT_BLOCKING fails too, so a renamed
// level cannot pass silently. NOT_BLOCKING results are counted, not gated.
//
// It also fails when the scan cannot be trusted: Semgrep exited non-zero (the job runs it without
// --error, so findings alone exit 0), the JSON holds an `errors` entry of level "error" (other levels
// are printed as warnings), no file was scanned (`paths.scanned` is empty), or fewer than RULE_FLOOR
// rules ran. The rules that ran are read from `time.rules`, which Semgrep writes only under --time.
//
// Semgrep CE writes `extra.fingerprint` and `extra.lines` as "requires login", so the fingerprint is
// computed here: sha256 over the rule id and the matched source lines read from the file (start.line
// to end.line), each line whitespace-collapsed and trimmed, cut to 16 hex characters. It follows the
// lines' content, not their number. A result listed in the reviewed baseline (semgrep-baseline.json:
// rule, file, fingerprint, verdict, and an optional count, default 1) is accepted until the baseline
// expires; an identical match beyond that count fails. From the day after `expires`, every
// result fails again.
//
//   node .github/workflows/scripts/semgrep-gate.mjs <semgrep.json> <baseline.json> \
//     [--repo-root <dir>] [--scan-exit <semgrep exit code>]

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BLOCKING = ['ERROR', 'CRITICAL', 'HIGH'];
const NOT_BLOCKING = ['WARNING', 'INFO', 'MEDIUM', 'LOW', 'INVENTORY', 'EXPERIMENT'];
// On 2026-11-09 the four packs held 74 distinct rules: p/typescript and p/javascript the same 74,
// p/nodejs and p/react subsets of them. So the floor catches a scan that loaded few or no rules; it
// does not notice one pack missing while p/typescript or p/javascript loaded.
export const RULE_FLOOR = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

const collapse = (line) => line.replace(/\s+/g, ' ').trim();

/** sha256 of `rule + "\n" + the collapsed lines joined by "\n"`, first 16 hex characters. */
export function fingerprintOf(rule, lines) {
  return createHash('sha256')
    .update(`${rule}\n${lines.map(collapse).join('\n')}`)
    .digest('hex')
    .slice(0, 16);
}

const keyOf = (rule, file, fingerprint) => `${rule} ${file} ${fingerprint}`;

/** The baseline's allowance per key, or the problems that make it unusable (as in sarif-gate.mjs). */
function readBaseline(baseline, now) {
  if (!baseline) return { allowance: new Map(), problems: [], expired: false };
  const problems = [];
  const end = Date.parse(`${baseline.expires}T00:00:00Z`) + DAY_MS;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(baseline.expires)) || Number.isNaN(end)) {
    problems.push(
      `baseline: expires must be a YYYY-MM-DD date, not ${JSON.stringify(baseline.expires)}`,
    );
  }
  if (!Array.isArray(baseline.entries)) problems.push('baseline: entries must be an array');
  const allowance = new Map();
  for (const e of Array.isArray(baseline.entries) ? baseline.entries : []) {
    const count = e.count ?? 1;
    if (!e.rule || !e.file || !e.fingerprint || !String(e.verdict ?? '').trim()) {
      problems.push(
        `baseline: an entry needs rule, file, fingerprint and verdict: ${JSON.stringify(e)}`,
      );
      continue;
    }
    if (!Number.isInteger(count) || count < 1) {
      problems.push(`baseline: count must be a positive integer: ${JSON.stringify(e)}`);
      continue;
    }
    const key = keyOf(e.rule, e.file, e.fingerprint);
    allowance.set(key, (allowance.get(key) ?? 0) + count);
  }
  return { allowance, problems, expired: !(now.getTime() < end) };
}

/**
 * @param {object} report Semgrep's JSON output (run with --json-output and --time)
 * @param {{ baseline?: object, now?: Date, repoRoot?: string, scanExit?: number,
 *           readFile?: (path: string) => string }} [options]
 * @returns {{ blocking: string[], accepted: string[], stale: string[], problems: string[],
 *             warnings: string[], expired: boolean, scanned: number, rules: number, below: number }}
 */
export function gate(
  report,
  {
    baseline,
    now = new Date(),
    repoRoot = '.',
    scanExit = 0,
    readFile = (p) => readFileSync(p, 'utf8'),
  } = {},
) {
  const { allowance, problems, expired } = readBaseline(baseline, now);
  const warnings = [];
  const blocking = [];
  const accepted = [];
  const used = new Map();
  let below = 0;

  if (scanExit !== 0) {
    problems.push(
      Number.isInteger(scanExit)
        ? `semgrep exited ${scanExit}`
        : 'no semgrep exit code was recorded',
    );
  }
  const scanned = Array.isArray(report?.paths?.scanned) ? report.paths.scanned.length : 0;
  if (scanned === 0) problems.push('semgrep scanned no file');
  const rules = Array.isArray(report?.time?.rules) ? report.time.rules.length : 0;
  if (rules < RULE_FLOOR) {
    problems.push(`semgrep ran ${rules} rule(s), fewer than ${RULE_FLOOR} (is --time passed?)`);
  }
  for (const e of Array.isArray(report?.errors) ? report.errors : []) {
    const text = `semgrep ${e.level ?? '(no level)'}: ${e.type ?? ''} ${e.message ?? ''}`.trim();
    if (e.level === 'error') problems.push(text);
    else warnings.push(text);
  }

  const fileLines = new Map();
  for (const result of Array.isArray(report?.results) ? report.results : []) {
    const rule = result.check_id;
    const severity = String(result.extra?.severity ?? '').toUpperCase();
    const file = result.path;
    const start = result.start?.line;
    const end = result.end?.line ?? start;
    if (NOT_BLOCKING.includes(severity)) {
      below += 1;
      continue;
    }
    const line = `${rule} (${severity || 'no severity'}) ${file}:${start ?? '?'}`;
    if (!BLOCKING.includes(severity)) {
      problems.push(`a result has a severity this gate does not know: ${line}`);
      continue;
    }
    if (!rule || !file || !Number.isInteger(start) || !Number.isInteger(end) || end < start) {
      problems.push(`a result has no usable rule, path or line range: ${line}`);
      continue;
    }
    if (!fileLines.has(file)) {
      try {
        fileLines.set(file, readFile(join(repoRoot, file)).split(/\r?\n/));
      } catch {
        fileLines.set(file, null);
      }
    }
    const source = fileLines.get(file);
    if (!source || end > source.length) {
      problems.push(`cannot read the matched lines of ${line}`);
      continue;
    }
    const key = keyOf(rule, file, fingerprintOf(rule, source.slice(start - 1, end)));
    const n = used.get(key) ?? 0;
    if (!expired && n < (allowance.get(key) ?? 0)) {
      used.set(key, n + 1);
      accepted.push(line);
    } else {
      blocking.push(`${line} [${key.split(' ').pop()}]`);
    }
  }
  const stale = [...allowance.keys()].filter((k) => (used.get(k) ?? 0) < allowance.get(k));
  return {
    blocking,
    accepted,
    stale: expired ? [] : stale,
    problems,
    warnings,
    expired: Boolean(baseline) && expired,
    scanned,
    rules,
    below,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const option = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args.splice(i, 2)[1];
  };
  const repoRoot = option('--repo-root') ?? '.';
  const exitArg = option('--scan-exit');
  const [reportPath, baselinePath] = args;
  const scanExit = exitArg === undefined ? 0 : /^\d+$/.test(exitArg) ? Number(exitArg) : NaN;
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch (err) {
    console.log(`::error::cannot read the Semgrep JSON ${reportPath}: ${err.message}`);
    process.exit(1);
  }
  const baseline = baselinePath ? JSON.parse(readFileSync(baselinePath, 'utf8')) : undefined;
  const r = gate(report, {
    baseline,
    repoRoot,
    scanExit,
  });
  if (r.expired)
    console.log(`::warning::the baseline expired after ${baseline.expires}: no result is accepted`);
  for (const w of r.warnings) console.log(`::warning::${w}`);
  for (const p of r.problems) console.log(`::error::${p}`);
  for (const b of r.blocking) console.log(`::error::semgrep ERROR: ${b}`);
  for (const s of r.stale) console.log(`::warning::baseline entry no longer found: ${s}`);
  console.log(
    `${r.scanned} file(s) scanned, ${r.rules} rule(s) run; ${r.blocking.length} ERROR result(s) failing, ${r.accepted.length} accepted by the baseline, ${r.below} below ERROR`,
  );
  process.exit(r.problems.length || r.blocking.length ? 1 : 0);
}
