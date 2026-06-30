import { describe, it, expect } from 'vitest';
import { asClientAuditV2 } from './audit-v2';

// The catastrophic-bug guard: the SSE route sets `entitlement` on EVERY completed audit, so the v1/v2
// discriminator MUST key off crawlHealth (the server's isV2 mirror), never entitlement — otherwise a
// v1 audit (with ENGINE_V2 off in prod) renders the full ResultView and a false "clean bill of health".
describe('asClientAuditV2 — v1/v2 SSE discriminator', () => {
  it('treats a completed v2 payload (crawlHealth present) as ClientAuditV2', () => {
    const v2 = {
      id: 'a',
      status: 'completed',
      entitlement: { tier: 'free' },
      crawlHealth: { confidence: 'high', coveragePct: 1, blockRate: 0, partial: false },
    };
    expect(asClientAuditV2(v2 as never)).toBe(v2);
  });

  it('treats a completed v1 payload (crawlHealth null) as legacy → null, EVEN WITH entitlement present', () => {
    const v1 = { id: 'a', status: 'completed', entitlement: { tier: 'free' }, crawlHealth: null };
    expect(asClientAuditV2(v1 as never)).toBeNull();
  });

  it('treats a payload with no crawlHealth field as legacy → null', () => {
    expect(asClientAuditV2({ id: 'a', status: 'completed' } as never)).toBeNull();
  });

  it('null / undefined snapshot → null', () => {
    expect(asClientAuditV2(null)).toBeNull();
    expect(asClientAuditV2(undefined)).toBeNull();
  });
});
