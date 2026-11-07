import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import type { Db } from './db';
import { CHECKS_DIR, FINGERPRINT_FILE } from './files';
import { openTarget } from './target';

/** One section of infra/supabase/checks/fingerprint.sql's result. */
export interface Section {
  md5: string;
  items: number;
  lines: string[];
}

export type Fingerprint = Map<string, Section>;

export function fingerprintSql(dir = CHECKS_DIR): string {
  return readFileSync(join(dir, FINGERPRINT_FILE), 'utf8');
}

export async function readFingerprint(db: Db, sql = fingerprintSql()): Promise<Fingerprint> {
  const rows = await db.query<{ section: string; md5: string; items: number; lines: string[] }>(
    sql,
  );
  return new Map(rows.map((r) => [r.section, { md5: r.md5, items: r.items, lines: r.lines }]));
}

export interface SectionDifference {
  section: string;
  /** Lines in `actual` and not in `expected`. */
  added: string[];
  /** Lines in `expected` and not in `actual`. */
  removed: string[];
}

export function compareFingerprints(
  expected: Fingerprint,
  actual: Fingerprint,
): SectionDifference[] {
  const sections = [...new Set([...expected.keys(), ...actual.keys()])].sort();
  const differences: SectionDifference[] = [];
  for (const section of sections) {
    const e = expected.get(section);
    const a = actual.get(section);
    if (e && a && e.md5 === a.md5) continue;
    const eLines = new Set(e?.lines ?? []);
    const aLines = new Set(a?.lines ?? []);
    differences.push({
      section,
      added: [...aLines].filter((l) => !eLines.has(l)),
      removed: [...eLines].filter((l) => !aLines.has(l)),
    });
  }
  return differences;
}

/**
 * Names every differing section and lists its differing lines, up to `limit` per direction per
 * section. When lines are withheld the output says how many.
 */
export function formatDifferences(
  differences: SectionDifference[],
  labels: { expected: string; actual: string },
  limit = 20,
): string {
  const list = (lines: string[], sign: string) => [
    ...lines.slice(0, limit).map((l) => `    ${sign} ${l}`),
    ...(lines.length > limit ? [`    ${sign} ... ${lines.length - limit} more not shown`] : []),
  ];
  return differences
    .flatMap((d) => [
      `  section ${d.section}: ${d.added.length} only on ${labels.actual}, ${d.removed.length} only on ${labels.expected}`,
      ...list(d.added, '+'),
      ...list(d.removed, '-'),
    ])
    .join('\n');
}

/** Section names and counts only: what a public pull request comment may carry. */
export function formatDifferenceCounts(
  differences: SectionDifference[],
  labels: { expected: string; actual: string },
): string {
  return differences
    .map(
      (d) =>
        `${d.section} (${d.added.length} only on ${labels.actual}, ${d.removed.length} only on ${labels.expected})`,
    )
    .join(', ');
}

export function formatFingerprint(fp: Fingerprint): string {
  return [...fp.entries()]
    .map(([s, v]) => `  ${s.padEnd(12)} ${v.md5}  ${v.items} items`)
    .join('\n');
}

/** A fingerprint as a file: `fingerprint.ts --out` writes it, `--before`/`--after` read it. */
export function fingerprintToJson(fp: Fingerprint): string {
  return JSON.stringify(Object.fromEntries(fp), null, 1) + '\n';
}

export function fingerprintFromJson(text: string): Fingerprint {
  const parsed = JSON.parse(text) as Record<string, Section>;
  return new Map(Object.entries(parsed));
}

/** The lines a change is expected to add and remove, by section. A section left out expects none. */
export interface ExpectedChange {
  added?: Record<string, string[]>;
  removed?: Record<string, string[]>;
}

/**
 * Compares what changed between two fingerprints with what was expected to change, line by line in
 * both directions, and returns one problem per line that differs from the expectation. An empty
 * expectation means nothing may change.
 */
export function changeProblems(
  before: Fingerprint,
  after: Fingerprint,
  expected: ExpectedChange = {},
): string[] {
  const actual = compareFingerprints(before, after);
  const sections = new Set([
    ...actual.map((d) => d.section),
    ...Object.keys(expected.added ?? {}),
    ...Object.keys(expected.removed ?? {}),
  ]);
  const problems: string[] = [];
  for (const section of [...sections].sort()) {
    const d = actual.find((x) => x.section === section) ?? { section, added: [], removed: [] };
    for (const [direction, got, want] of [
      ['added', d.added, expected.added?.[section] ?? []],
      ['removed', d.removed, expected.removed?.[section] ?? []],
    ] as const) {
      const gotSet = new Set(got);
      const wantSet = new Set(want);
      for (const l of got)
        if (!wantSet.has(l)) problems.push(`${section}: ${direction} unexpectedly: ${l}`);
      for (const l of want)
        if (!gotSet.has(l))
          problems.push(`${section}: expected to be ${direction} but was not: ${l}`);
    }
  }
  return problems;
}

/**
 *   tsx scripts/db/fingerprint.ts (--db-url-env NAME | --project-ref REF) [--yes-production] --out FILE
 *   tsx scripts/db/fingerprint.ts --before FILE --after FILE [--expect FILE]
 *
 * The first form reads a target's fingerprint into a file. The second compares two such files and
 * fails unless what changed is exactly what --expect lists; without --expect, nothing may change.
 * Every unexpected line is printed: nothing is withheld.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'db-url-env': { type: 'string' },
      'project-ref': { type: 'string' },
      'yes-production': { type: 'boolean', default: false },
      out: { type: 'string' },
      before: { type: 'string' },
      after: { type: 'string' },
      expect: { type: 'string' },
    },
  });
  if (values.before || values.after) {
    if (!values.before || !values.after) throw new Error('--before and --after go together');
    const before = fingerprintFromJson(readFileSync(values.before, 'utf8'));
    const after = fingerprintFromJson(readFileSync(values.after, 'utf8'));
    const expected = values.expect
      ? (JSON.parse(readFileSync(values.expect, 'utf8')) as ExpectedChange)
      : {};
    const problems = changeProblems(before, after, expected);
    const changed = compareFingerprints(before, after);
    const count = (k: 'added' | 'removed') => changed.reduce((n, d) => n + d[k].length, 0);
    console.log(`${count('added')} line(s) added, ${count('removed')} removed`);
    if (problems.length > 0) {
      console.log(`not what was expected (${problems.length}):\n${problems.join('\n')}`);
      process.exitCode = 1;
    } else {
      console.log(values.expect ? `exactly as ${values.expect} lists` : 'no change, as expected');
    }
    return;
  }
  if (!values.out) throw new Error('--out FILE, or --before FILE --after FILE');
  const target = openTarget({
    dbUrlEnv: values['db-url-env'],
    projectRef: values['project-ref'],
    yesProduction: values['yes-production'],
  });
  try {
    const fp = await readFingerprint(target.db);
    writeFileSync(values.out, fingerprintToJson(fp));
    console.log(`fingerprint of ${target.label}: ${fp.size} sections written to ${values.out}`);
  } finally {
    await target.db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
