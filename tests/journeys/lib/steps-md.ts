import { readFileSync } from 'node:fs';

/** One row of STEPS.md: what the suite reads from it, so the tests cannot disagree with the list. */
export interface StepMeta {
  id: string;
  devices: readonly string[];
  writes: boolean;
  /** The "Expected to fail today" cell, ids only (judged ones included). */
  listed: readonly string[];
}

const PROJECTS: Record<string, string> = {
  desktop: 'desktop',
  phone: 'phone',
  firefox: 'firefox',
  webkit: 'webkit',
};

export function parseSteps(md: string): Map<string, StepMeta> {
  const out = new Map<string, StepMeta>();
  for (const line of md.split('\n')) {
    // Journey tables: Step | customer | passes | devices | writes | expected. SMOKE: Step | what | passes | writes.
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    const id = cells[0];
    if (!id || !/^(J\d(\.\d+[a-z]?)?|SMOKE\.\d+)$/.test(id)) continue;
    // SMOKE rows have no devices column: the smoke set runs on every device.
    const smoke = id.startsWith('SMOKE.');
    const devices = smoke
      ? ['desktop', 'phone', 'firefox']
      : (cells[3] ?? '')
          .split(',')
          .map((d) => PROJECTS[d.trim().toLowerCase()])
          .filter((d): d is string => !!d);
    // Fails closed: the cell must start "yes" or "no", and anything but exactly "no" is a write.
    const cell = (smoke ? cells[3] : cells[4]) ?? '';
    if (!/^(yes|no)\b/.test(cell))
      throw new Error(`STEPS.md ${id}: Writes cell "${cell}" is neither yes nor no`);
    const writes = cell !== 'no';
    const listed = smoke ? [] : [...(cells[5] ?? '').matchAll(/F-\d{3}/g)].map((m) => m[0]);
    out.set(id, { id, devices, writes, listed });
  }
  // Defect-named steps (D.F-nnn) have no journey row: every device, and writing unless declared below.
  const declared = /^\|\s*D\.F-\d{3}\s*\|/;
  const named = md
    .split('\n')
    .filter((line) => !declared.test(line))
    .join('\n');
  for (const m of named.matchAll(/\bD\.(F-\d{3})\b/g)) {
    out.set(m[0], {
      id: m[0],
      devices: ['desktop', 'phone', 'firefox'],
      writes: true,
      listed: [m[1]!],
    });
  }
  // "D steps that write nothing". Fails closed, as the journey rows do: anything but exactly "no" writes.
  for (const line of md.split('\n').filter((l) => declared.test(l))) {
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    const step = out.get(cells[0]!);
    if (!step) throw new Error(`STEPS.md declares ${cells[0]}, which is not a D step`);
    if (cells.length !== 2 || !/^(yes|no)\b/.test(cells[1]!)) {
      throw new Error(
        `STEPS.md ${cells[0]}: Writes cell "${cells[1] ?? ''}" is neither yes nor no`,
      );
    }
    step.writes = cells[1] !== 'no';
  }
  return out;
}

export const STEPS: ReadonlyMap<string, StepMeta> = parseSteps(
  readFileSync(new URL('../STEPS.md', import.meta.url), 'utf8'),
);

export function stepMeta(id: string): StepMeta {
  const m = STEPS.get(id);
  if (!m) throw new Error(`${id} is not a step in STEPS.md`);
  return m;
}
