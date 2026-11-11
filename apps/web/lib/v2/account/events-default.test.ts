/**
 * The persist step's default sender (`sendWithoutRequest`): the product's one sender, with no cookie
 * header, since the step has no request. The routes' own path is in events.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock('../../analytics-server', () => ({
  captureServerEvent: async (...args: unknown[]) => {
    h.calls.push(args);
  },
}));

import { sendWithoutRequest } from './events';

describe('sendWithoutRequest', () => {
  it('hands the event to captureServerEvent with no cookie header', async () => {
    await sendWithoutRequest('fix_closed', 'account:acc-1', { type: 'robots', checksToClose: 2 });
    expect(h.calls).toEqual([
      [
        null,
        {
          event: 'fix_closed',
          distinctId: 'account:acc-1',
          properties: { type: 'robots', checksToClose: 2 },
        },
      ],
    ]);
  });
});
