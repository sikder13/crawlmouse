import { readFileSync } from 'node:fs';
import { expect, test } from './pw';

// expected-fail.json against STEPS.md: every key is a step the list names, and every id is a register
// row the defect index names. Pure: no browser, no server.
const steps = readFileSync(new URL('./STEPS.md', import.meta.url), 'utf8');
const EXPECTED: Record<string, string[]> = JSON.parse(
  readFileSync(new URL('./expected-fail.json', import.meta.url), 'utf8'),
);
const stepIds = new Set(
  [...steps.matchAll(/^\|\s*((?:J\d(?:\.\d+[a-z]?)?)|SMOKE\.\d+)\s*\|/gm)].map((m) => m[1]),
);
const dSteps = new Set([...steps.matchAll(/\bD\.F-\d{3}\b/g)].map((m) => m[0]));
// Prettier pads table cells, so the patterns allow spaces around each id.
const index = new Set([...steps.matchAll(/^\|\s*(F-\d{3})\s*\|/gm)].map((m) => m[1]));

test('expected-fail.json names only steps STEPS.md lists', () => {
  const unknown = Object.keys(EXPECTED).filter((k) => !stepIds.has(k) && !dSteps.has(k));
  expect(unknown).toEqual([]);
});

test('expected-fail.json names only defects the index lists', () => {
  const ids = Object.values(EXPECTED).flat();
  expect(ids.length).toBeGreaterThan(0);
  expect(ids.filter((f) => !index.has(f))).toEqual([]);
});
