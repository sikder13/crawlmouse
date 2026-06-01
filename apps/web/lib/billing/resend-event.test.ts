import { describe, it, expect } from 'vitest';
import { parseResendEvent } from './resend-event';

describe('parseResendEvent', () => {
  it('maps a hard bounce', () => {
    const e = parseResendEvent({ type: 'email.bounced', data: { email: 'x@y.com', bounce: { type: 'Permanent' } } });
    expect(e).toEqual({ eventType: 'bounced', email: 'x@y.com', bounceType: 'permanent' });
  });
  it('maps a delivery with no bounce', () => {
    const e = parseResendEvent({ type: 'email.delivered', data: { email: 'a@b.com' } });
    expect(e).toEqual({ eventType: 'delivered', email: 'a@b.com', bounceType: null });
  });
});
