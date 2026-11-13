/**
 * Test support: the walk the public report's packet tests share (build-snapshot.test.ts and the
 * page's test). It finds a fixture's packet text, to look for it in what a public report holds.
 */
import type { ViewDataset } from '../fixtures';

/** Every string value anywhere inside `value`. */
export function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

/**
 * A packet's own text: each value of at least 24 characters with a space in it (a step, a command,
 * what a check prints), less the fix's title, which the report shows by design. Shorter values are
 * crawler names, framework keys and the like, which the report shows in its own right.
 */
export function packetText(d: Pick<ViewDataset, 'fixes'>): string[] {
  return d.fixes.flatMap((f) =>
    strings(f.packet).filter((s) => s.length >= 24 && s.includes(' ') && s !== f.title),
  );
}
