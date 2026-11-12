import { describe, expect, it } from 'vitest';
import { fixture, FIXTURE_NAMES, findCheck, type FixtureName } from '../fixtures';
import { freeFixes } from '../view/free-fixes';
import { FIRST_AUDIT } from '../view/segment/test-helpers';
import { buildPublicSnapshot } from './build-snapshot';
import { isV2Snapshot, PublicSnapshotV2Schema } from './snapshot';

const MINTED = '2026-11-12T18:00:00.000Z';

/** Every string value anywhere inside `value`. */
function strings(value: unknown): string[] {
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
function packetText(d: ReturnType<typeof fixture>): string[] {
  return d.fixes.flatMap((f) =>
    strings(f.packet).filter((s) => s.length >= 24 && s.includes(' ') && s !== f.title),
  );
}

describe.each(FIXTURE_NAMES)('buildPublicSnapshot on %s', (name: FixtureName) => {
  const d = fixture(name);
  const checkId = FIRST_AUDIT[name];
  const snapshot = buildPublicSnapshot(d, checkId, MINTED);

  it('is a v2 snapshot the schema accepts, stamped with the check and the mint', () => {
    expect(isV2Snapshot(snapshot)).toBe(true);
    expect(snapshot.checkedAt).toBe(findCheck(d, checkId).finished_at);
    expect(snapshot.mintedAt).toBe(MINTED);
  });

  it('is a pure function of the check: the same input gives the same snapshot', () => {
    expect(buildPublicSnapshot(structuredClone(d), checkId, MINTED)).toEqual(snapshot);
  });

  it('lists every crawler the check measured, in its order', () => {
    expect(snapshot.crawlers.map((c) => c.ua)).toEqual(
      findCheck(d, checkId).crawlers.map((c) => c.ua),
    );
  });

  it('shows the titles of the fixes Free opens, in order, and no other fix', () => {
    const free = freeFixes(d, findCheck(d, checkId)).map((f) => f.title);
    expect(snapshot.topFixes.map((f) => f.title)).toEqual(free);
  });

  it('carries no part of any packet: no body, command or check text', () => {
    if (d.fixes.some((f) => f.packet !== null)) expect(packetText(d).length).toBeGreaterThan(0);
    const shown = strings(snapshot);
    for (const text of packetText(d))
      for (const s of shown) expect(s.includes(text), `"${text}" in "${s}"`).toBe(false);
  });
});

describe('the walk the packet test relies on', () => {
  it('finds a packet command planted in a snapshot', () => {
    const d = fixture('bad-site');
    const snapshot = buildPublicSnapshot(d, FIRST_AUDIT['bad-site'], MINTED);
    const command = packetText(d).find((s) => s.startsWith('curl'));
    expect(command).toBeDefined();
    const planted = { ...snapshot, headline: `${snapshot.headline} ${command}` };
    expect(strings(planted).some((s) => s.includes(command!))).toBe(true);
  });
});

describe('isV2Snapshot', () => {
  it('refuses a v1 snapshot, a v2 one with a field added, and nothing', () => {
    const v2 = buildPublicSnapshot(fixture('bad-site'), FIRST_AUDIT['bad-site'], MINTED);
    expect(isV2Snapshot({ ...v2, packet: 'x' })).toBe(false);
    expect(isV2Snapshot({ ...v2, version: 1 })).toBe(false);
    expect(isV2Snapshot({ grade: 'B', score: 79, sections: [] })).toBe(false);
    expect(isV2Snapshot(null)).toBe(false);
    expect(PublicSnapshotV2Schema.safeParse(v2).success).toBe(true);
  });
});
