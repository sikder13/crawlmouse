import { describe, it, expect, vi, beforeEach } from 'vitest';

// next/cache is mocked so we can assert exactly which caches a takedown purges.
const { revalidateTag, revalidatePath } = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('next/cache', () => ({
  revalidateTag,
  revalidatePath,
  // unstable_cache is unused by the purge path but imported at module top; stub it so the
  // module loads under Vitest (no `@/` alias resolution needed for it).
  unstable_cache: (fn: unknown) => fn,
}));
// The admin client import is never exercised by purgePublicReport; stub it so the module's
// top-level `@/lib/supabase/admin` import doesn't blow up under Vitest.
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));

import { purgePublicReport } from './reports';

describe('purgePublicReport', () => {
  beforeEach(() => {
    revalidateTag.mockClear();
    revalidatePath.mockClear();
  });

  it('purges the tagged data read, the report page, AND the OG image segment', () => {
    purgePublicReport('abc123');
    // The shared data layer (getPublicReport) is tag-invalidated.
    expect(revalidateTag).toHaveBeenCalledWith('public-report:abc123');
    // The report page full-route cache.
    expect(revalidatePath).toHaveBeenCalledWith('/r/abc123');
    // The OG image is a SEPARATE route segment with its own `revalidate = 3600` full-route
    // cache — revalidatePath('/r/<slug>') does NOT cascade to it, so it must be purged
    // explicitly or the pre-takedown viral card serves for up to an hour.
    expect(revalidatePath).toHaveBeenCalledWith('/r/abc123/opengraph-image');
  });
});
