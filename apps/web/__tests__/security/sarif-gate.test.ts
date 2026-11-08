import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gate } from '../../../../.github/workflows/scripts/sarif-gate.mjs';

// A SARIF log in the shape CodeQL writes: the query pack's rules under tool.extensions, each result
// pointing at its rule through rule.toolComponent, the extracted files as tool notifications.
function codeqlSarif({
  severity,
  extracted = 3,
  suppressed = false,
  baselineState,
}: {
  severity: string;
  extracted?: number;
  suppressed?: boolean;
  baselineState?: string;
}) {
  return {
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: { name: 'CodeQL', rules: [] },
          extensions: [
            { name: 'codeql/javascript-all', rules: [] },
            {
              name: 'codeql/javascript-queries',
              rules: [
                { id: 'js/log-injection', properties: { 'security-severity': '4.3' } },
                { id: 'js/sql-injection', properties: { 'security-severity': severity } },
              ],
            },
          ],
        },
        invocations: [
          {
            toolExecutionNotifications: Array.from({ length: extracted }, (_, i) => ({
              descriptor: { id: 'js/diagnostics/successfully-extracted-files' },
              locations: [{ physicalLocation: { artifactLocation: { uri: `apps/web/f${i}.ts` } } }],
            })),
          },
        ],
        results: [
          {
            ruleId: 'js/sql-injection',
            rule: { id: 'js/sql-injection', index: 1, toolComponent: { index: 1 } },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: 'apps/web/app/api/x/route.ts' },
                  region: { startLine: 12 },
                },
              },
            ],
            partialFingerprints: { primaryLocationLineHash: 'f00dfeedc0ffee01:1' },
            ...(suppressed ? { suppressions: [{ kind: 'inSource' }] } : {}),
            ...(baselineState ? { baselineState } : {}),
          },
        ],
      },
    ],
  };
}

describe('the CodeQL gate', () => {
  it.each(['7.0', '8.8', '9.8'])(
    'fails on a result whose rule has security-severity %s',
    (severity) => {
      expect(gate([codeqlSarif({ severity })])).toMatchObject({
        blocking: [`js/sql-injection (${Number(severity)}) apps/web/app/api/x/route.ts:12`],
        problems: [],
      });
    },
  );

  it.each(['6.9', '4.3', '0'])('passes a result of security-severity %s', (severity) => {
    expect(gate([codeqlSarif({ severity })])).toMatchObject({ blocking: [], problems: [] });
  });

  it('passes a suppressed result and one CodeQL marks absent', () => {
    expect(gate([codeqlSarif({ severity: '9.8', suppressed: true })]).blocking).toEqual([]);
    expect(gate([codeqlSarif({ severity: '9.8', baselineState: 'absent' })]).blocking).toEqual([]);
  });

  it('fails a scan that read nothing: no run, or no extracted file', () => {
    expect(gate([]).problems).toEqual(['no SARIF run']);
    expect(gate([{ version: '2.1.0', runs: [] }]).problems).toEqual(['no SARIF run']);
    expect(gate([codeqlSarif({ severity: '1.0', extracted: 0 })]).problems).toEqual([
      'CodeQL: extracted no file',
    ]);
  });

  it('finds a rule named by id alone, in the driver or an extension', () => {
    const sarif = codeqlSarif({ severity: '8.1' });
    const result = sarif.runs[0]!.results[0]! as Record<string, unknown>;
    delete result.rule;
    expect(gate([sarif]).blocking).toHaveLength(1);
  });
});

const ENTRY = {
  rule: 'js/sql-injection',
  file: 'apps/web/app/api/x/route.ts',
  fingerprint: 'f00dfeedc0ffee01:1',
  verdict: 'reviewed',
};
const baselineOf = (entries: object[], expires = '2026-12-08') => ({ expires, entries });
const at = (iso: string) => new Date(iso);

describe('the CodeQL baseline', () => {
  it('accepts a listed result before it expires, by rule, file and fingerprint', () => {
    const r = gate([codeqlSarif({ severity: '8.8' })], {
      baseline: baselineOf([ENTRY]),
      now: at('2026-11-20T12:00:00Z'),
    });
    expect(r.blocking).toEqual([]);
    expect(r.accepted).toEqual(['js/sql-injection (8.8) apps/web/app/api/x/route.ts:12']);
    expect(r.expired).toBe(false);
  });

  it('keys on the fingerprint, not the line: a result that moved is still accepted', () => {
    const moved = codeqlSarif({ severity: '8.8' });
    moved.runs[0]!.results[0]!.locations[0]!.physicalLocation.region.startLine = 99;
    expect(
      gate([moved], { baseline: baselineOf([ENTRY]), now: at('2026-11-20T00:00:00Z') }).blocking,
    ).toEqual([]);
    const changed = codeqlSarif({ severity: '8.8' });
    (changed.runs[0]!.results[0] as { partialFingerprints: object }).partialFingerprints = {
      primaryLocationLineHash: 'aaaaaaaaaaaaaaaa:1',
    };
    expect(
      gate([changed], { baseline: baselineOf([ENTRY]), now: at('2026-11-20T00:00:00Z') }).blocking,
    ).toHaveLength(1);
  });

  it('accepts through the whole of the expiry day, UTC, and nothing after it', () => {
    const run = (iso: string) =>
      gate([codeqlSarif({ severity: '8.8' })], { baseline: baselineOf([ENTRY]), now: at(iso) });
    expect(run('2026-12-08T23:59:59.999Z').blocking).toEqual([]);
    const after = run('2026-12-09T00:00:00.000Z');
    expect(after.expired).toBe(true);
    expect(after.blocking).toEqual(['js/sql-injection (8.8) apps/web/app/api/x/route.ts:12']);
    expect(after.accepted).toEqual([]);
    // After expiry the date alone fails nothing: a clean scan still passes.
    expect(
      gate([codeqlSarif({ severity: '4.0' })], {
        baseline: baselineOf([ENTRY]),
        now: at('2027-01-01T00:00:00Z'),
      }),
    ).toMatchObject({
      blocking: [],
      problems: [],
    });
  });

  it('a result not in the baseline fails, and an entry counts as many results as it says', () => {
    const two = codeqlSarif({ severity: '8.8' });
    two.runs[0]!.results.push(structuredClone(two.runs[0]!.results[0]!));
    const now = at('2026-11-20T00:00:00Z');
    expect(gate([two], { baseline: baselineOf([ENTRY]), now }).blocking).toHaveLength(1);
    expect(gate([two], { baseline: baselineOf([{ ...ENTRY, count: 2 }]), now }).blocking).toEqual(
      [],
    );
    expect(
      gate([two], { baseline: baselineOf([{ ...ENTRY, rule: 'js/other' }]), now }).blocking,
    ).toHaveLength(2);
  });

  it('refuses an entry without a verdict, and a malformed expiry date', () => {
    const now = at('2026-11-20T00:00:00Z');
    expect(
      gate([codeqlSarif({ severity: '1' })], {
        baseline: baselineOf([{ ...ENTRY, verdict: ' ' }]),
        now,
      }).problems,
    ).toHaveLength(1);
    expect(
      gate([codeqlSarif({ severity: '1' })], { baseline: baselineOf([ENTRY], '8 Dec 2026'), now })
        .problems,
    ).toHaveLength(1);
  });

  it('reports a listed result that is no longer found, without failing on it', () => {
    const r = gate([codeqlSarif({ severity: '4.0' })], {
      baseline: baselineOf([ENTRY]),
      now: at('2026-11-20T00:00:00Z'),
    });
    expect(r.stale).toHaveLength(1);
    expect(r.blocking).toEqual([]);
    expect(r.problems).toEqual([]);
  });
});

describe('the reviewed baseline against the results it was written from', () => {
  const read = (p: string) => JSON.parse(readFileSync(resolve(__dirname, p), 'utf8'));
  const baseline = read('../../../../.github/workflows/scripts/codeql-baseline.json');
  const sarif = read('codeql-2026-11-08.sarif.json');

  it('expires on 2026-12-08, and every entry carries a verdict', () => {
    expect(baseline.expires).toBe('2026-12-08');
    for (const e of baseline.entries)
      expect(String(e.verdict).trim().length, e.file).toBeGreaterThan(20);
  });

  it('accepts each of the 21 results, and lists nothing that is not among them', () => {
    const r = gate([sarif], { baseline, now: at('2026-11-08T21:00:00Z') });
    expect(r.blocking).toEqual([]);
    expect(r.accepted).toHaveLength(21);
    expect(r.stale).toEqual([]);
  });

  it('the day after it expires, all 21 fail', () => {
    expect(gate([sarif], { baseline, now: at('2026-12-09T00:00:00Z') }).blocking).toHaveLength(21);
  });
});
