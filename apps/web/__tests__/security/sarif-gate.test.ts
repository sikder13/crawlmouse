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
      expect(gate([codeqlSarif({ severity })])).toEqual({
        blocking: [`js/sql-injection (${Number(severity)}) apps/web/app/api/x/route.ts:12`],
        problems: [],
      });
    },
  );

  it.each(['6.9', '4.3', '0'])('passes a result of security-severity %s', (severity) => {
    expect(gate([codeqlSarif({ severity })])).toEqual({ blocking: [], problems: [] });
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
