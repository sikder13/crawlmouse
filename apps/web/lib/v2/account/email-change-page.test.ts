import { describe, expect, it } from 'vitest';
import { emailLinkPage, type LinkRow } from './email-change-page';
import { hashToken } from './tokens';

const TOKEN = 'T'.repeat(43);
const NOW = new Date('2026-11-10T12:00:00Z');
const row = (over: Partial<LinkRow> = {}): LinkRow => ({
  new_email: 'nina@new.example',
  old_email: 'olga@old.example',
  used_at: null,
  revoked_at: null,
  expires_at: '2026-11-10T12:30:00Z',
  ...over,
});

/** A reader that answers `found` for the token's hash and the flow's kind, and records the lookup. */
function reader(found: LinkRow | null) {
  const asked: [string, string][] = [];
  return {
    asked,
    read: async (hash: string, kind: string) => {
      asked.push([hash, kind]);
      return found;
    },
  };
}

describe('emailLinkPage', () => {
  it('shows what the button does, with the address masked, for a live link', async () => {
    const r = reader(row());
    expect(await emailLinkPage(r.read, 'emailChange', TOKEN, {}, NOW)).toEqual({
      state: 'ready',
      address: 'n…@new.example',
    });
    expect(r.asked).toEqual([[hashToken(TOKEN), 'email_change']]);
    const u = reader(row());
    expect(await emailLinkPage(u.read, 'emailUndo', TOKEN, {}, NOW)).toEqual({
      state: 'ready',
      address: 'o…@old.example',
    });
    expect(u.asked).toEqual([[hashToken(TOKEN), 'email_change_undo']]);
  });

  it('calls a missing, used, revoked or expired link unusable', async () => {
    for (const found of [
      null,
      row({ used_at: '2026-11-10T11:00:00Z' }),
      row({ revoked_at: '2026-11-10T11:00:00Z' }),
      row({ expires_at: '2026-11-10T12:00:00Z' }),
    ]) {
      expect(await emailLinkPage(reader(found).read, 'emailChange', TOKEN, {}, NOW)).toEqual({
        state: 'unusable',
      });
    }
    const none = reader(row());
    expect(await emailLinkPage(none.read, 'emailChange', null, {}, NOW)).toEqual({
      state: 'unusable',
    });
    expect(none.asked).toEqual([]);
  });

  it('shows the answer the POST sent back, before reading any link', async () => {
    const r = reader(row());
    expect(await emailLinkPage(r.read, 'emailChange', null, { done: '1' }, NOW)).toEqual({
      state: 'done',
    });
    expect(
      await emailLinkPage(r.read, 'emailChange', TOKEN, { error: 'address_taken' }, NOW),
    ).toEqual({ state: 'refused', code: 'address_taken' });
    expect(await emailLinkPage(r.read, 'emailChange', null, { error: '<script>' }, NOW)).toEqual({
      state: 'refused',
      code: 'other',
    });
    expect(r.asked).toEqual([]);
  });
});
