/**
 * A packet builder that throws, through the whole check builder: the fix keeps its place and its
 * effect and carries no packet, the check is built, and the grading summary counts the fault.
 */
import { describe, expect, it, vi } from 'vitest';
import { recordedBuild } from '../../../fixtures/v2/build/recorded.js';

vi.mock('../packets/registry.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../packets/registry.js')>();
  return {
    ...real,
    writePacket: ((type, record, facts) => {
      if (type === 'deep_pages') throw new Error('a builder fault');
      return real.writePacket(type, record, facts);
    }) as typeof real.writePacket,
  };
});

const { buildCheck } = await import('./build.js');

describe('a packet builder that throws on a record', () => {
  const built = buildCheck(recordedBuild());
  const deep = built.fixes.filter((f) => f.type === 'deep_pages');
  const grading = built.summaries.find((s) => s.phase === 'grading')!;

  it('leaves its fixes without a packet and every other fix with one', () => {
    expect(deep.length).toBeGreaterThan(0);
    for (const fix of deep) expect(fix.packet, fix.title).toBeNull();
    for (const fix of built.fixes.filter((f) => f.type !== 'deep_pages')) {
      expect(fix.packet, fix.title).not.toBeNull();
    }
  });

  it('keeps those fixes’ rank and effect: the fault costs the packet and nothing else', () => {
    for (const fix of deep) {
      expect(fix.rank).toBeGreaterThanOrEqual(1);
      expect(fix.effect.estimate).toBe(true);
    }
  });

  it('counts the faults in the grading summary', () => {
    expect(grading.packets_not_written).toBe(deep.length);
  });
});
