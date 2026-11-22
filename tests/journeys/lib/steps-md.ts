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

function parse(md: string): Map<string, StepMeta> {
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
  // Defect-named steps (D.F-nnn) have no row: every device, and treated as writing until written.
  for (const m of md.matchAll(/\bD\.(F-\d{3})\b/g)) {
    out.set(m[0], {
      id: m[0],
      devices: ['desktop', 'phone', 'firefox'],
      writes: true,
      listed: [m[1]],
    });
  }
  return out;
}

export const STEPS: ReadonlyMap<string, StepMeta> = parse(
  readFileSync(new URL('../STEPS.md', import.meta.url), 'utf8'),
);

export function stepMeta(id: string): StepMeta {
  const m = STEPS.get(id);
  if (!m) throw new Error(`${id} is not a step in STEPS.md`);
  return m;
}
