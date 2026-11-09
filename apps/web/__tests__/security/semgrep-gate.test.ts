import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { RULE_FLOOR, gate } from '../../../../.github/workflows/scripts/semgrep-gate.mjs';

const RULE = 'javascript.lang.security.audit.code-string-concat.code-string-concat';
const FILE = 'apps/web/lib/x.ts';

// A repository on disk: the gate reads the matched lines from the file, as it does in CI.
let root: string;
const write = (body: string) => writeFileSync(join(root, FILE), body);
const SOURCE = ['export function f(input: string) {', '  eval("1+" +   input);', '}', ''];

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'semgrep-gate-'));
  mkdirSync(join(root, 'apps/web/lib'), { recursive: true });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

// Semgrep's JSON in the shape 1.182.1 writes it (--json-output with --time): results with check_id,
// path, start/end and extra.severity ("requires login" in extra.lines and extra.fingerprint),
// paths.scanned as a list, time.rules as the list of rule ids that ran.
function semgrepJson({
  severity = 'ERROR',
  line = 2,
  results = 1,
  scanned = 3,
  rules = 74,
  errors = [] as object[],
} = {}) {
  return {
    version: '1.182.1',
    results: Array.from({ length: results }, () => ({
      check_id: RULE,
      path: FILE,
      start: { line, col: 3, offset: 0 },
      end: { line, col: 24, offset: 21 },
      extra: { severity, lines: 'requires login', fingerprint: 'requires login', message: 'm' },
    })),
    errors,
    paths: { scanned: Array.from({ length: scanned }, (_, i) => `apps/web/f${i}.ts`) },
    time: { rules: Array.from({ length: rules }, (_, i) => `rule.${i}`) },
    skipped_rules: [],
  };
}

// The fingerprint of SOURCE's line 2 for RULE, computed here by hand from literal text — the line
// with its whitespace collapsed and trimmed — not by calling the gate.
const FINGERPRINT = createHash('sha256')
  .update(`${RULE}\neval("1+" + input);`)
  .digest('hex')
  .slice(0, 16);

const ENTRY = { rule: RULE, file: FILE, fingerprint: FINGERPRINT, line: 2, verdict: 'reviewed' };
const baselineOf = (entries: object[], expires = '2026-12-08') => ({ expires, entries });
const NOW = new Date('2026-11-20T12:00:00Z');
const run = (report: object, entries?: object[], now = NOW, expires?: string) =>
  gate(report, {
    repoRoot: root,
    now,
    ...(entries ? { baseline: baselineOf(entries, expires) } : {}),
  });

describe('the Semgrep gate', () => {
  beforeAll(() => write(SOURCE.join('\n')));

  it('fails a new ERROR result', () => {
    expect(run(semgrepJson())).toMatchObject({
      blocking: [`${RULE} (ERROR) ${FILE}:2 [${FINGERPRINT}]`],
      problems: [],
    });
  });

  it.each(['WARNING', 'INFO'])('passes a %s result, and counts it', (severity) => {
    expect(run(semgrepJson({ severity }))).toMatchObject({ blocking: [], problems: [], below: 1 });
  });

  it('fails a result whose severity it does not know', () => {
    expect(run(semgrepJson({ severity: 'SEVERE' })).problems).toHaveLength(1);
  });

  it('pins the fingerprint against one computed by hand', () => {
    expect(FINGERPRINT).toMatch(/^[0-9a-f]{16}$/);
    expect(run(semgrepJson(), [ENTRY]).accepted).toEqual([`${RULE} (ERROR) ${FILE}:2`]);
  });

  it('fails a scan that exited non-zero, or whose exit was not recorded', () => {
    expect(
      gate(semgrepJson({ severity: 'INFO' }), { repoRoot: root, scanExit: 2 }).problems,
    ).toEqual(['semgrep exited 2']);
    expect(
      gate(semgrepJson({ severity: 'INFO' }), { repoRoot: root, scanExit: Number.NaN }).problems,
    ).toEqual(['no semgrep exit code was recorded']);
  });

  it('fails a scan that read no file', () => {
    expect(run(semgrepJson({ results: 0, scanned: 0 })).problems).toEqual([
      'semgrep scanned no file',
    ]);
    expect(run({ ...semgrepJson({ results: 0 }), paths: {} }).problems).toEqual([
      'semgrep scanned no file',
    ]);
  });

  it(`fails a scan that ran no rule, or fewer than ${RULE_FLOOR}`, () => {
    expect(run(semgrepJson({ results: 0, rules: 0 })).problems).toHaveLength(1);
    expect(run(semgrepJson({ results: 0, rules: RULE_FLOOR - 1 })).problems).toHaveLength(1);
    expect(run(semgrepJson({ results: 0, rules: RULE_FLOOR })).problems).toEqual([]);
    // Without --time Semgrep writes no rule list at all.
    expect(run({ ...semgrepJson({ results: 0 }), time: {} }).problems).toHaveLength(1);
  });

  it('fails on a scan error of level "error", and only warns on other levels', () => {
    const error = { code: 2, level: 'error', type: 'SemgrepError', message: 'HTTP 404' };
    const warn = { code: 3, level: 'warn', type: 'Syntax error', message: 'x' };
    expect(run(semgrepJson({ results: 0, errors: [error] })).problems).toEqual([
      'semgrep error: SemgrepError HTTP 404',
    ]);
    expect(run(semgrepJson({ results: 0, errors: [warn] }))).toMatchObject({
      problems: [],
      warnings: ['semgrep warn: Syntax error x'],
    });
  });

  it('fails an ERROR result whose lines cannot be read', () => {
    expect(run(semgrepJson({ line: 40 }), [ENTRY]).problems).toHaveLength(1);
  });
});

describe('the Semgrep baseline', () => {
  it('accepts a listed result by rule, file and content fingerprint', () => {
    write(SOURCE.join('\n'));
    const r = run(semgrepJson(), [ENTRY]);
    expect(r.blocking).toEqual([]);
    expect(r.accepted).toHaveLength(1);
    expect(r.stale).toEqual([]);
  });

  it('follows the content: the same line moved down is still accepted', () => {
    write(['// a comment above', '', ...SOURCE].join('\n'));
    expect(run(semgrepJson({ line: 4 }), [ENTRY])).toMatchObject({ blocking: [], problems: [] });
  });

  it('changed content on the matched line fails', () => {
    write(SOURCE.join('\n').replace('"1+"', '"2+"'));
    expect(run(semgrepJson(), [ENTRY]).blocking).toHaveLength(1);
  });

  it('a second identical match fails while the entry counts one, and passes at count 2', () => {
    write(SOURCE.join('\n'));
    expect(run(semgrepJson({ results: 2 }), [ENTRY]).blocking).toHaveLength(1);
    expect(run(semgrepJson({ results: 2 }), [{ ...ENTRY, count: 2 }]).blocking).toEqual([]);
  });

  it('accepts through the expiry day, UTC, and nothing after it', () => {
    write(SOURCE.join('\n'));
    expect(run(semgrepJson(), [ENTRY], new Date('2026-12-08T23:59:59.999Z')).blocking).toEqual([]);
    const after = run(semgrepJson(), [ENTRY], new Date('2026-12-09T00:00:00.000Z'));
    expect(after.expired).toBe(true);
    expect(after.blocking).toHaveLength(1);
    expect(after.accepted).toEqual([]);
  });

  it('refuses an entry without a verdict, a bad count, and a malformed expiry date', () => {
    const clean = semgrepJson({ results: 0 });
    expect(run(clean, [{ ...ENTRY, verdict: ' ' }]).problems).toHaveLength(1);
    expect(run(clean, [{ ...ENTRY, count: 0 }]).problems).toHaveLength(1);
    expect(run(clean, [ENTRY], NOW, '8 Dec 2026').problems).toHaveLength(1);
  });

  it('reports a listed result that is no longer found, without failing on it', () => {
    const r = run(semgrepJson({ results: 0 }), [ENTRY]);
    expect(r.stale).toHaveLength(1);
    expect(r).toMatchObject({ blocking: [], problems: [] });
  });
});

describe('the reviewed baseline and the semgrep job', () => {
  const repo = resolve(__dirname, '../../../..');
  const baseline = JSON.parse(
    readFileSync(join(repo, '.github/workflows/scripts/semgrep-baseline.json'), 'utf8'),
  );
  const job = parse(readFileSync(join(repo, '.github/workflows/ci.yml'), 'utf8')).jobs.semgrep;
  const script = job.steps.map((s: { run?: string }) => s.run ?? '').join('\n');

  it('expires on 2026-12-08, and every entry carries a verdict', () => {
    expect(baseline.expires).toBe('2026-12-08');
    for (const e of baseline.entries)
      expect(String(e.verdict).trim().length, e.file).toBeGreaterThan(20);
  });

  it('runs with --time (the rule list the floor reads) and hands its exit code to the gate', () => {
    expect(script).toMatch(/semgrep scan --metrics=off --time/);
    expect(script).not.toMatch(/--error\b/);
    expect(script).toMatch(/semgrep-gate\.mjs[\s\S]*--scan-exit "\$\{SCAN_EXIT:-missing\}"/);
    expect(job.permissions).toEqual({ contents: 'read' });
  });

  // Semgrep's built-in ignore list, used only when no .semgrepignore exists, skips `build/`
  // directories: on 2026-11-09 an ERROR planted in packages/engine/src/v2/build passed the gate
  // without this file and failed it with the file in place.
  it('writes a .semgrepignore with no pattern before the scan', () => {
    const write = script.match(/^\s*echo "([^"]*)" > \.semgrepignore$/m);
    expect(write, 'the step that writes .semgrepignore').not.toBeNull();
    expect(write![1]).toMatch(/^#/);
    expect(script.indexOf('> .semgrepignore')).toBeLessThan(script.indexOf('docker run'));
  });
});
