import { readFileSync } from 'node:fs';
import { expect, test } from './pw';
import { parseSteps, STEPS } from './lib/steps-md';

// expected-fail.json against STEPS.md. Pure: no browser, no server.
const EXPECTED: Record<string, string[]> = JSON.parse(
  readFileSync(new URL('./expected-fail.json', import.meta.url), 'utf8'),
);
const md = readFileSync(new URL('./STEPS.md', import.meta.url), 'utf8');
const dSteps = new Set([...md.matchAll(/\bD\.F-\d{3}\b/g)].map((m) => m[0]));
// Prettier pads table cells, so the pattern allows spaces around each id.
const index = new Set([...md.matchAll(/^\|\s*(F-\d{3})\s*\|/gm)].map((m) => m[1]));

test('STEPS.md parses into the journey and smoke steps', () => {
  expect(STEPS.size).toBeGreaterThan(80);
  expect(STEPS.get('J0.9c')?.devices).toEqual(['desktop']);
  expect(STEPS.get('J0.3')?.writes).toBe(true);
  expect(STEPS.get('SMOKE.8')?.writes).toBe(false);
});

test('expected-fail.json names only steps STEPS.md lists', () => {
  expect(Object.keys(EXPECTED).filter((k) => !STEPS.has(k) && !dSteps.has(k))).toEqual([]);
});

test('each step lists only ids its STEPS.md row names', () => {
  const stray = Object.entries(EXPECTED).flatMap(([k, ids]) => {
    const row = STEPS.get(k);
    if (!row) return [];
    return ids.filter((f) => !row.listed.includes(f)).map((f) => `${k}: ${f}`);
  });
  expect(stray).toEqual([]);
});

test('a defect-named step lists exactly its own defect', () => {
  const wrong = Object.entries(EXPECTED).filter(
    ([k, ids]) => k.startsWith('D.') && (ids.length !== 1 || ids[0] !== k.slice(2)),
  );
  expect(wrong).toEqual([]);
});

test('every step that is not plainly "no" writes, J4 included', () => {
  expect(STEPS.get('J4')?.writes).toBe(true);
  expect(STEPS.get('J4.6')?.writes).toBe(true);
  expect(STEPS.get('J4.1')?.writes).toBe(false);
  expect(STEPS.get('D.F-010')?.writes).toBe(true);
});

test('a D step writes unless it is declared with exactly "no"', () => {
  for (const id of ['D.F-045', 'D.F-048', 'D.F-049', 'D.F-067', 'D.F-088']) {
    expect(STEPS.get(id)?.writes, id).toBe(false);
  }
  const list = 'D.F-001, D.F-002';
  const writes = (row: string) => parseSteps(`${list}\n${row}\n`).get('D.F-001')?.writes;
  expect(writes('| D.F-002 | no |'), 'an undeclared step').toBe(true);
  expect(writes('| D.F-001 | no |')).toBe(false);
  expect(writes('| D.F-001 | yes |')).toBe(true);
  expect(writes('| D.F-001 | no, it reads |'), 'anything but exactly no').toBe(true);
  for (const bad of ['| D.F-001 | maybe |', '| D.F-001 |  |', '| D.F-001 | no | extra |']) {
    expect(() => writes(bad), bad).toThrow(/neither yes nor no/);
  }
  expect(() => parseSteps(`${list}\n| D.F-999 | no |\n`)).toThrow(/not a D step/);
});

test('expected-fail.json names only defects the index lists', () => {
  const ids = Object.values(EXPECTED).flat();
  expect(ids.length).toBeGreaterThan(0);
  expect(ids.filter((f) => !index.has(f))).toEqual([]);
});
