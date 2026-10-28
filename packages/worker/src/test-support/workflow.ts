import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Runs a step of .github/workflows/worker-staging.yml the way the runner does (bash, errexit and
 * pipefail), against stand-ins for flyctl, jq, curl and sleep, so a test can check what the step does
 * when flyctl answers one way or another. The jq stand-in implements the filters the workflow uses and
 * fails on any other, so a changed filter fails the test rather than passing it untested.
 */

/** The `run: |` block of the step with this name, dedented. */
export function stepScript(workflow: string, name: string): string {
  const at = workflow.indexOf(`- name: ${name}\n`);
  if (at === -1) throw new Error(`no step named ${name}`);
  const run = workflow.indexOf('run: |\n', at);
  const lines: string[] = [];
  for (const line of workflow.slice(run + 'run: |\n'.length).split('\n')) {
    if (line.trim() !== '' && !line.startsWith(' '.repeat(10))) break;
    lines.push(line.slice(10));
  }
  return lines.join('\n');
}

export interface FlyctlAnswers {
  /** `flyctl ips list --json` prints this, or fails when it is null. */
  ips?: string | null;
  /** `flyctl secrets list --json` prints this, or fails when it is null. */
  secrets?: string | null;
  machines?: string;
  /** What each `flyctl ssh console` prints as its last line, in turn (the last repeats); `FAIL` fails it. */
  ssh?: string[];
}

export interface StepRun {
  code: number;
  /** stdout and stderr, interleaved as the runner logs them. */
  log: string;
  /** The arguments of each flyctl call, in order. */
  flyctl: string[];
}

const FLYCTL = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_DIR/flyctl.log"
answer() { if [ -f "$STUB_DIR/$1" ]; then cat "$STUB_DIR/$1"; else echo "Error: $1 failed" >&2; exit 1; fi; }
case "$1 $2" in
  "status --app") exit 0 ;;
  "apps create") exit 0 ;;
  "secrets list") answer secrets ;;
  "ips list") answer ips ;;
  "ips allocate-egress") echo "allocated" ;;
  "machines list") answer machines ;;
  "machine restart") exit 0 ;;
  "ssh console")
    n=$(cat "$STUB_DIR/ssh.n" 2>/dev/null || echo 0)
    echo $((n + 1)) > "$STUB_DIR/ssh.n"
    mapfile -t readings < "$STUB_DIR/ssh"
    reading=\${readings[$n]:-\${readings[-1]}}
    if [ "$reading" = FAIL ]; then echo "Error: ssh: could not open a tunnel" >&2; exit 1; fi
    printf 'Connecting to the machine...\\n%s' "$reading" ;;
  *) echo "flyctl stand-in: unexpected call: $*" >&2; exit 2 ;;
esac
`;

const JQ = `
const fs = require('node:fs');
const args = process.argv.slice(2);
let raw = false;
let exitStatus = false;
let filter = null;
const vars = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-r') raw = true;
  else if (args[i] === '-e') exitStatus = true;
  else if (args[i] === '--arg') { vars[args[i + 1]] = args[i + 2]; i += 2; }
  else filter = args[i];
}
const iterate = (v) => {
  if (Array.isArray(v)) return v;
  if (v !== null && typeof v === 'object') return Object.values(v);
  process.stderr.write('jq: error: Cannot iterate over ' + (v === null ? 'null' : typeof v) + '\\n');
  process.exit(5);
};
const FILTERS = {
  '(. // [])[] | (.name // .Name)': (v) => iterate(v ?? []).map((x) => x.name ?? x.Name),
  // The filter before an app with no secrets was handled: kept so a test can tell it apart.
  '.[] | (.name // .Name)': (v) => iterate(v).map((x) => x.name ?? x.Name),
  'any(.[]; .Type == "egress_v4" and .Region == $r)': (v) => [
    iterate(v).some((x) => x.Type === 'egress_v4' && x.Region === vars.r),
  ],
  '.[0].id': (v) => [v === null ? null : (iterate(v)[0] ?? null)?.id ?? null],
  '.[] | select(.Type == "egress_v4" and .Region == $r) | .Address': (v) =>
    iterate(v).filter((x) => x.Type === 'egress_v4' && x.Region === vars.r).map((x) => x.Address),
};
if (!(filter in FILTERS)) {
  process.stderr.write('jq stand-in: no such filter: ' + filter + '\\n');
  process.exit(3);
}
const input = fs.readFileSync(0, 'utf8');
if (input.trim() === '') process.exit(exitStatus ? 4 : 0);
let value;
try {
  value = JSON.parse(input);
} catch {
  process.stderr.write('jq: error: parse error\\n');
  process.exit(2);
}
const out = FILTERS[filter](value);
for (const x of out) process.stdout.write((raw && typeof x === 'string' ? x : JSON.stringify(x)) + '\\n');
if (exitStatus) process.exit(out.length === 0 ? 4 : out.at(-1) === false || out.at(-1) === null ? 1 : 0);
`;

export function runStep(
  script: string,
  answers: FlyctlAnswers,
  env: Record<string, string> = {},
): StepRun {
  const dir = mkdtempSync(join(tmpdir(), 'worker-step-'));
  try {
    const bin = join(dir, 'bin');
    const stub = (name: string, body: string) => {
      writeFileSync(join(bin, name), body);
      chmodSync(join(bin, name), 0o755);
    };
    mkdirSync(bin);
    stub('flyctl', FLYCTL);
    stub('jq', `#!${process.execPath}\n${JQ}`);
    stub('curl', '#!/usr/bin/env bash\nexit 0\n');
    stub('sleep', '#!/usr/bin/env bash\nexit 0\n');
    if (answers.ips != null) writeFileSync(join(dir, 'ips'), answers.ips);
    if (answers.secrets != null) writeFileSync(join(dir, 'secrets'), answers.secrets);
    writeFileSync(join(dir, 'machines'), answers.machines ?? '[{"id":"m1"}]');
    writeFileSync(join(dir, 'ssh'), (answers.ssh ?? ['FAIL']).join('\n'));
    writeFileSync(join(dir, 'flyctl.log'), '');
    writeFileSync(join(dir, 'step.sh'), `exec 2>&1\n${script}`);
    const r = spawnSync(
      'bash',
      ['--noprofile', '--norc', '-eo', 'pipefail', join(dir, 'step.sh')],
      {
        env: {
          PATH: `${bin}:/usr/bin:/bin`,
          STUB_DIR: dir,
          FLY_APP: 'crawlmouse-worker-staging',
          FLY_REGION: 'iad',
          FLY_API_TOKEN: 'test-token',
          FLY_ORG: 'test-org',
          ...env,
        },
        encoding: 'utf8',
        timeout: 30_000,
      },
    );
    const flyctl = readFileSync(join(dir, 'flyctl.log'), 'utf8').split('\n').filter(Boolean);
    return { code: r.status ?? -1, log: r.stdout, flyctl };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The addresses the log shows unmasked, read as the runner reads it: a line `::add-mask::X` masks X
 * in every line after it, and a value printed before its mask is in the log as it is.
 */
export function unmasked(log: string, addresses: readonly string[]): string[] {
  const masked = new Set<string>();
  const shown = new Set<string>();
  for (const line of log.split('\n')) {
    const mask = /^::add-mask::(.*)$/.exec(line);
    if (mask) {
      masked.add(mask[1]!);
      continue;
    }
    for (const a of addresses) if (!masked.has(a) && line.includes(a)) shown.add(a);
  }
  return [...shown];
}
