/**
 * The card's last four, role by role (CC-37 Q25), on PGlite with every migration applied. The account
 * pages' two loaders (`readAccount` for the account pages, `readSettingsPage`'s dataset for Settings,
 * Settings › Plan and Trial ending) read for each person of `scopeWorld`, plus a developer whose seat
 * covers the second client. The owner reads the digits; every other role reads that a card is on file
 * and no digit of it; the session is never asked for the column, which 20261117000001 revokes.
 */
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '../helpers/pglite-migrations';
import type { Call } from '../helpers/postgrest-pglite';
import {
  addSeat,
  adminOver,
  person,
  scopeWorld,
  sessionOver,
  type Person,
  type ScopeWorld,
} from '../../lib/v2/account/sites-test-support';

vi.mock('server-only', () => ({}));

import { loadAccountDataset } from '../../lib/v2/account/dataset';
import { loadSettingsDataset } from '../../lib/v2/account/settings-dataset';
import { supabaseCheckReader } from '../../lib/v2/pipeline/load';

const LAST4 = ['7', '3', '1', '9'].join('');
const NOW = new Date('2026-11-14T12:00:00.000Z');

let db: PGlite;
let w: ScopeWorld;
let developer2: Person;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  w = await scopeWorld(db);
  developer2 = await person(db, 'developer2');
  await addSeat(db, w.accountId, developer2, 'developer', [w.site2.id]);
  await db.query('update public.accounts set card_last4 = $2 where id = $1', [w.accountId, LAST4]);
}, 300_000);
afterAll(async () => {
  await db?.close();
});

type Who = 'owner' | 'manager' | 'developer' | 'developer2';
const personOf = (who: Who) => (who === 'developer2' ? developer2 : w[who]);
/** What each role is given for the card: the owner the digits, the others that one is on file. */
const EXPECTED: Record<Who, { card_last4: string | null; card_on_file: boolean }> = {
  owner: { card_last4: LAST4, card_on_file: true },
  manager: { card_last4: null, card_on_file: true },
  developer: { card_last4: null, card_on_file: true },
  developer2: { card_last4: null, card_on_file: true },
};
const LOADERS = {
  account: loadAccountDataset,
  settings: loadSettingsDataset,
} as const;

async function load(loader: keyof typeof LOADERS, who: Who) {
  const p = personOf(who);
  const asked: Call[][] = [];
  const session = sessionOver(db, { id: p.id, email: p.email }, asked);
  const admin = adminOver(db);
  const d = await LOADERS[loader](
    { session, admin, records: supabaseCheckReader(admin) },
    w.accountId,
    NOW,
  );
  // The settings loader wraps its records in `d`; the account loader returns them.
  const records = 'd' in d ? d.d : d;
  return {
    d,
    accounts: records.accounts,
    onFile: records.cardsOnFile ?? [],
    asked: JSON.stringify(asked),
  };
}

describe('the card’s last four on the account pages, as each role', () => {
  it.each(
    (['account', 'settings'] as const).flatMap((loader) =>
      (Object.keys(EXPECTED) as Who[]).map((who) => [loader, who, EXPECTED[who]] as const),
    ),
  )('the %s dataset as %s: %o', async (loader, who, expected) => {
    const { accounts, onFile } = await load(loader, who);
    const a = accounts.find((x) => x.id === w.accountId)!;
    expect({ card_last4: a.card_last4, card_on_file: onFile.includes(w.accountId) }).toEqual(
      expected,
    );
  });

  it('no role but the owner is given a digit of the card, at any depth of either dataset', async () => {
    for (const loader of ['account', 'settings'] as const) {
      for (const who of ['manager', 'developer', 'developer2'] as const) {
        expect(JSON.stringify((await load(loader, who)).d), `${loader} ${who}`).not.toContain(
          LAST4,
        );
      }
    }
  });

  it('the session is never asked for card_last4, by either dataset, for any role', async () => {
    for (const loader of ['account', 'settings'] as const) {
      for (const who of Object.keys(EXPECTED) as Who[]) {
        expect((await load(loader, who)).asked, `${loader} ${who}`).not.toContain('card_last4');
      }
    }
  });
});
