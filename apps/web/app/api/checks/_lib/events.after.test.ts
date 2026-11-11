import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  tasks: [] as Array<() => unknown>,
  refuse: false,
  sent: [] as unknown[],
}));

vi.mock('next/server', () => ({
  after: (task: () => unknown) => {
    if (h.refuse) throw new Error('`after` was called outside a request scope');
    h.tasks.push(task);
  },
}));
vi.mock('../../../../lib/analytics-server', () => ({
  captureServerEvent: async (_cookie: string | null, event: unknown) => void h.sent.push(event),
}));

import { capturePublicEventAfterResponse } from './events';

const CHECK = '7b1f6c1e-8a53-4c0e-9d3a-2f6f1d0e4b11';
const request = () => new Request('https://crawlmouse.com/api/checks', { method: 'POST' });

beforeEach(() => {
  h.tasks.length = 0;
  h.sent.length = 0;
  h.refuse = false;
});

describe('capturePublicEventAfterResponse', () => {
  it('leaves the capture for `after`: nothing is sent until the platform runs it', async () => {
    await capturePublicEventAfterResponse(request(), 'check_started', CHECK, {
      trigger: 'first_audit',
    });
    expect(h.sent).toEqual([]);
    expect(h.tasks).toHaveLength(1);
    await h.tasks[0]!();
    expect(h.sent).toHaveLength(1);
  });

  it('when `after` refuses, sends the capture itself and does not throw', async () => {
    h.refuse = true;
    await expect(
      capturePublicEventAfterResponse(request(), 'check_started', CHECK, {
        trigger: 'first_audit',
      }),
    ).resolves.toBeUndefined();
    expect(h.sent).toHaveLength(1);
    expect(h.tasks).toEqual([]);
  });
});
