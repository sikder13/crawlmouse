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
    const smoke = id.startsWith('SMOKE.');
    const devices = smoke
      ? ['desktop', 'phone', 'firefox']
      : (cells[3] ?? '')
          .split(',')
          .map((d) => PROJECTS[d.trim().toLowerCase()])
          .filter((d): d is string => !!d);
    const writes = (smoke ? cells[3] : cells[4])?.startsWith('yes') ?? false;
    const listed = smoke ? [] : [...(cells[5] ?? '').matchAll(/F-\d{3}/g)].map((m) => m[0]);
    out.set(id, { id, devices, writes, listed });
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
