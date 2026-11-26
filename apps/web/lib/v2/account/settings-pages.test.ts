/**
 * The Settings pages' loader names the reader's seat in its viewer. Before, it named none ("a page
 * that needs it adds it"), and a viewer with no seat reads as the owner's: on Settings, Plan,
 * Delete, Integrations and Trial ending the frame took the owner's seat, so a member's own theme was
 * not used there (`accountShellView` reads `readerSeat(v)?.theme`). F-335 was the same root for the
 * rail. The page-level effect is pinned in `lib/v2/view/settings-seat-theme.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => ({
  role: 'developer' as string,
  seatId: 'e0000000-0000-4000-8000-0000000000f2',
}));

const session = {
  auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'dev@example.com' } } }) },
  rpc: async () => ({ data: h.role, error: null }),
};

vi.mock('../../supabase/server', () => ({ supabaseServer: async () => session }));
vi.mock('../../supabase/admin', () => ({ supabaseAdmin: () => ({ rpc: async () => ({}) }) }));
vi.mock('../../billing/owner', () => ({ ownPersonalAccountId: async () => null }));
vi.mock('../mail/address-hash', () => ({ hashMailAddress: () => 'h', mailPepper: () => null }));
vi.mock('../monitor/alert-defaults', () => ({ seedDefaultAlertRules: async () => undefined }));
vi.mock('../pipeline/load', () => ({ supabaseCheckReader: () => ({}) }));
vi.mock('./settings-dataset', () => ({
  loadSettingsDataset: async () => ({ d: {}, billingEnd: null, subscriptionStatus: null }),
  viewInput: (d: unknown) => d,
}));
vi.mock('./viewer', () => ({
  chosenFromRequest: async () => null,
  readViewer: async () => ({
    kind: 'viewer',
    viewer: {
      account: { id: 'a1', kind: 'team' },
      seat: { id: h.seatId },
      accounts: [],
    },
  }),
}));

import { readSettingsPage } from './settings-pages';

describe('readSettingsPage names the reader’s seat in its viewer', () => {
  beforeEach(() => {
    h.role = 'developer';
  });

  for (const role of ['owner', 'account_manager', 'developer']) {
    it(`for ${role}`, async () => {
      h.role = role;
      const page = await readSettingsPage(new Date('2026-11-26T09:00:00Z'));
      expect(page.kind).toBe('account');
      if (page.kind !== 'account') return;
      expect(page.viewer).toEqual({
        accountId: 'a1',
        seatId: h.seatId,
        now: '2026-11-26T09:00:00.000Z',
      });
      expect(page.seatId).toBe(h.seatId);
    });
  }
});
