import type { WhiteLabelConfig } from '@crawlmouse/types';

// SPEC 04.1 §2/R2 — the client-side view of the ownership probe. This shape is the ONLY thing the /r/
// owner island trusts for control visibility/state. `owned` is always present; the rest are present
// only for the verified owner (the route returns `{owned:false}` for anon / non-owner).
export interface OwnershipProbe {
  owned: boolean;
  claimed?: boolean;
  canWhiteLabel?: boolean;
  listed?: boolean;
  indexable?: boolean;
  whiteLabel?: WhiteLabelConfig | null;
}

/**
 * Fetch the ownership probe for a report slug. FAILS CLOSED: any non-200, parse error, or network
 * failure yields `{owned:false}` so a transient failure can never surface owner controls to a
 * non-owner. The injected `fetchImpl` keeps it unit-testable; `no-store` matches the route.
 */
export async function fetchOwnership(slug: string, fetchImpl: typeof fetch): Promise<OwnershipProbe> {
  try {
    const res = await fetchImpl(`/api/reports/${encodeURIComponent(slug)}/mine`, { cache: 'no-store' });
    if (!res.ok) return { owned: false };
    const data = (await res.json()) as Record<string, unknown> | null;
    if (!data || data.owned !== true) return { owned: false };
    return {
      owned: true,
      claimed: data.claimed === true,
      canWhiteLabel: data.canWhiteLabel === true,
      listed: data.listed === true,
      indexable: data.indexable === true,
      whiteLabel: (data.whiteLabel as WhiteLabelConfig | null) ?? null,
    };
  } catch {
    return { owned: false };
  }
}
