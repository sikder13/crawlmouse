import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// SharePanel is a client component (useRouter). Stub navigation + analytics for a static render.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock('@/lib/analytics', () => ({ track: () => {}, trackRaw: () => {} }));

import { SharePanel } from './SharePanel';

// U7 — SharePanel is the LEGACY (v1 / non-ENGINE_V2) result-page share surface (rendered by AuditView
// when `asClientAuditV2` is null). It is NOT dead code, so its stale "verify-to-mint" copy is fixed
// here (the verification branch itself is now unreachable — the mint route no longer 403s — and is
// commented as such, flagged for the PR, not deleted).
describe('SharePanel (legacy v1 result path) copy', () => {
  it('frames minting as free + instant with no false "verified owners only" gate', () => {
    const html = renderToStaticMarkup(<SharePanel auditId="aud-1" />);
    expect(html).toContain('Get your free report');
    expect(html).not.toContain('Only available if you'); // the false "verified ownership" precondition is gone
  });
});
