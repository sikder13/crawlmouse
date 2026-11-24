// @vitest-environment jsdom
/**
 * `dropUnsent` (lib/analytics/consent-control.ts) relies on two methods of posthog-js that are not
 * public API. An upgrade that renames one would leave a decline with events still to send, so this
 * names each on the built package. What they do is proved in consent-no-tracking.dom.test.tsx.
 */
import { PostHog } from 'posthog-js';
import { describe, expect, it, vi } from 'vitest';
import { dropUnsent } from '../lib/analytics/consent-control';

describe('the SDK methods a decline drains its queues with', () => {
  it('exist on the built package', () => {
    const proto = PostHog.prototype as unknown as Record<string, unknown>;
    expect(typeof proto._send_request).toBe('function');
    expect(typeof proto._handle_unload).toBe('function');
  });

  it('nothing is sent while draining, and the sender is put back', () => {
    const send = vi.fn();
    const sdk = {
      _send_request: send,
      _handle_unload(this: { _send_request: (o: unknown) => void }) {
        this._send_request({ url: '/e/' });
      },
    };
    dropUnsent(sdk);
    expect(send).not.toHaveBeenCalled();
    expect(sdk._send_request).toBe(send);
  });
});
