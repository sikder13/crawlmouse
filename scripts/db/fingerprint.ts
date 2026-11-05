import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db';
import { CHECKS_DIR, FINGERPRINT_FILE } from './files';

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

export function formatFingerprint(fp: Fingerprint): string {
  return [...fp.entries()]
    .map(([s, v]) => `  ${s.padEnd(12)} ${v.md5}  ${v.items} items`)
    .join('\n');
}
