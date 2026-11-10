import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicReportRow } from '@/lib/reports';

// A-7: with the middleware no longer sending X-Robots-Tag on /r/ report pages (it still does on each
// report's opengraph-image), this metadata is the only robots signal a report page gives. Pinned
// here for the three states the brief names.
const store = vi.hoisted(() => ({ report: null as unknown }));
vi.mock('@/lib/reports', () => ({ getPublicReport: async () => store.report }));

const { generateMetadata } = await import('./page');

const base = {
  slug: 'acme',
  grade: 'B',
  takedown_requested_at: null,
  hidden_at: null,
} as unknown as PublicReportRow;

async function robots() {
  const meta = await generateMetadata({ params: Promise.resolve({ slug: 'acme' }) });
  return meta.robots;
}

describe('report page robots meta (A-7)', () => {
  beforeEach(() => {
    store.report = null;
  });

  it('a claimed, indexable report says index', async () => {
    store.report = { ...base, claimed_at: '2026-11-01T00:00:00Z', indexable: true };
    expect(await robots()).toEqual({ index: true, follow: true });
  });

  it('an unclaimed report says noindex', async () => {
    store.report = { ...base, claimed_at: null, indexable: false };
    expect(await robots()).toEqual({ index: false, follow: true });
  });

  it('a claimed report its owner turned off says noindex', async () => {
    store.report = { ...base, claimed_at: '2026-11-01T00:00:00Z', indexable: false };
    expect(await robots()).toEqual({ index: false, follow: true });
  });

  it('a missing or taken-down report says noindex', async () => {
    expect(await robots()).toEqual({ index: false, follow: true });
    store.report = {
      ...base,
      claimed_at: '2026-11-01T00:00:00Z',
      indexable: true,
      takedown_requested_at: '2026-11-02T00:00:00Z',
    };
    expect(await robots()).toEqual({ index: false, follow: true });
  });
});
