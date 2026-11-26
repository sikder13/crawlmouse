/**
 * QA's F5 (#187 gate): a developer's rail linked Integrations, which answers that role with a 404
 * (`app/(account)/settings/integrations/page.tsx`). The rail now offers it only to the roles that
 * may edit the account's alerts, the page's own gate.
 */
import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures';
import { viewAt } from './account';
import { accountShellView } from './account-shell';

// A Pro account (bad-site's), with a manager's and a developer's seat added beside its owner's.
const base = fixture('bad-site');
const ACCOUNT = 'a0000000-0000-4000-8000-000000000001';
const OWNER = base.seats[0]!;
const SEATS = {
  owner: OWNER.id,
  account_manager: 'e0000000-0000-4000-8000-0000000000f1',
  developer: 'e0000000-0000-4000-8000-0000000000f2',
} as const;
const d = structuredClone(base);
d.seats.push(
  { ...structuredClone(OWNER), id: SEATS.account_manager, role: 'account_manager' },
  { ...structuredClone(OWNER), id: SEATS.developer, role: 'developer' },
);

const railOf = (role: keyof typeof SEATS) =>
  accountShellView(viewAt(d, { accountId: ACCOUNT, seatId: SEATS[role], now: d.as_of }), 'Sites', {
    role,
  }).nav.map((n) => n.label);

describe('the rail’s Integrations link follows the page’s role gate (F5)', () => {
  it('is offered to the owner and to an account manager', () => {
    expect(OWNER.role).toBe('owner');
    expect(railOf('owner')).toContain('Integrations');
    expect(railOf('account_manager')).toContain('Integrations');
  });

  it('is not offered to a developer, whom the page answers with a 404', () => {
    const rail = railOf('developer');
    expect(rail).not.toContain('Integrations');
    expect(rail).toContain('Settings');
  });
});
