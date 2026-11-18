/**
 * The site page's "Remove this site" row (CC-GL D2, owner ruling 2026-11-16) prints the purge's
 * window from RESTORE_DAYS, the constant the expiry's purge step reads (lib/v2/pipeline/expire.ts
 * purgeRemoved), so the sentence and the deletion cannot state two numbers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('../copy/restore-window');
  vi.resetModules();
});

async function noteWith(days: number): Promise<string> {
  vi.resetModules();
  vi.doMock('../copy/restore-window', () => ({ RESTORE_DAYS: days }));
  return (await import('./site')).SITE_COPY.removeNote;
}

describe('the Remove this site note', () => {
  it('reads as ruled with the window as it is', async () => {
    vi.resetModules();
    expect((await import('./site')).SITE_COPY.removeNote).toBe(
      'Its history is deleted 7 days after you remove it',
    );
  });

  it('prints another window from the constant, in the singular for one day', async () => {
    expect(await noteWith(11)).toBe('Its history is deleted 11 days after you remove it');
    expect(await noteWith(1)).toBe('Its history is deleted 1 day after you remove it');
  });
});
