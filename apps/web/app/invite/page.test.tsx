import type { PGlite } from '@electric-sql/pglite';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '@/__tests__/helpers/pglite-migrations';
import {
  addSeat,
  adminOver,
  makePaid,
  person,
  sessionOver,
  type Person,
} from '@/lib/v2/account/sites-test-support';
import { hashToken } from '@/lib/v2/account/tokens';

// The page an invitation's link lands on, and the Seats page, rendered from real rows: the session
// and service-role clients are the PostgREST stand-in over PGlite with every migration applied.

const h = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
  cookies: new Map<string, string>(),
}));

class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}
class NotFound extends Error {}

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      h.cookies.has(name) ? { name, value: h.cookies.get(name)! } : undefined,
  }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new NotFound();
  },
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => sessionOver(h.db, h.user) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => adminOver(h.db) }));

beforeAll(async () => {
  h.db = await freshDb();
  await applyAllMigrations(h.db);
}, 300_000);
afterAll(async () => h.db?.close());
beforeEach(() => {
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  vi.stubEnv('V2_BILLING', '1');
  h.cookies.clear();
  h.user = null;
});
afterEach(() => vi.unstubAllEnvs());

const as = (p: Pick<Person, 'id' | 'email'> | null) => {
  h.user = p && { id: p.id, email: p.email };
};

const invitePage = async (query: Record<string, string> = {}) =>
  renderToStaticMarkup(
    await (await import('./page')).default({ searchParams: Promise.resolve(query) }),
  );
const seatsPage = async (query: Record<string, string> = {}) =>
  renderToStaticMarkup(
    await (await import('../seats/page')).default({ searchParams: Promise.resolve(query) }),
  );

/** An invitation to `owner`'s account with its link issued: the token the mail would carry. */
async function invitation(owner: Person, email: string) {
  await h.db.query(`update public.accounts set name = 'Summit Digital' where id = $1`, [
    owner.accountId,
  ]);
  const {
    rows: [i],
  } = await h.db.query<{ r: { seat_id: string; seq: number } }>(
    `select public.invite_seat($1, $2, 'account_manager', null, 100, now()) r`,
    [owner.accountId, email],
  );
  const {
    rows: [link],
  } = await h.db.query<{ token: string }>(
    `select token from public.issue_seat_invite($1, $2, now())`,
    [i!.r.seat_id, i!.r.seq],
  );
  return link!.token;
}

async function paidOwner(tier: 'pro' | 'agency'): Promise<Person> {
  const owner = await person(h.db, 'owner');
  await makePaid(h.db, owner.accountId, tier);
  return owner;
}

describe('/invite', () => {
  it('is a 404 with V2_CHECKS_PUBLIC unset', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    await expect(invitePage()).rejects.toBeInstanceOf(NotFound);
  });

  it('signed in: says what the invitation is, with a form that posts no field, and neither the token nor an address', async () => {
    const owner = await paidOwner('agency');
    const guest = await person(h.db, 'guest');
    const token = await invitation(owner, guest.email);
    h.cookies.set('cm_link_invite', token);
    as(guest);
    const html = await invitePage();
    const card = /<section[\s\S]*<\/section>/.exec(html)![0];
    expect(card).toContain('You are invited to Summit Digital on Crawlmouse');
    expect(card).toContain('As an account manager');
    expect(card).toMatch(/<form[^>]* action="\/api\/seats\/accept"/);
    expect(card).not.toMatch(/<input/);
    expect(html).not.toContain(token);
    expect(html).not.toContain(hashToken(token));
    expect(card).not.toContain(guest.email);
    expect(card).not.toContain(owner.email);
  });

  it('signed out: a link to sign in and come back, and no form', async () => {
    const owner = await paidOwner('agency');
    h.cookies.set('cm_link_invite', await invitation(owner, 'guest@example.com'));
    const html = await invitePage();
    expect(html).toContain('href="/login?next=/invite"');
    expect(html).not.toMatch(/<form/);
  });

  it('with no cookie, or a value that is not a token, says the page holds no invitation and to open the mailed link again', async () => {
    const owner = await paidOwner('agency');
    const guest = await person(h.db, 'guest');
    // A live invitation the page's cookie no longer holds: none of the four causes below is true.
    await invitation(owner, guest.email);
    as(guest);
    for (const held of [null, 'short']) {
      if (held) h.cookies.set('cm_link_invite', held);
      const html = await invitePage();
      expect(html, String(held)).toContain('This page holds no invitation');
      expect(html, String(held)).toContain('Open the link in the invitation email again.');
      expect(html, String(held)).not.toContain('This invitation cannot be used');
      expect(html, String(held)).not.toContain('accepted, replaced');
      expect(html, String(held)).not.toMatch(/<form/);
    }
  });

  it('says the link cannot be used for a link re-sent since', async () => {
    const owner = await paidOwner('agency');
    const guest = await person(h.db, 'guest');
    as(guest);
    const token = await invitation(owner, guest.email);
    await h.db.query(
      `update public.seats set invite_token_hash = null, invite_expires_at = null, invite_seq = invite_seq + 1
        where account_id = $1 and status = 'invited'`,
      [owner.accountId],
    );
    h.cookies.set('cm_link_invite', token);
    const html = await invitePage();
    expect(html).toContain('This invitation cannot be used');
    expect(html).toContain('accepted, replaced by a newer one, removed, or it has expired');
    expect(html).not.toContain('This page holds no invitation');
    expect(html).not.toMatch(/<form/);
  });

  it('reads the token from the cookie alone: one in the address opens nothing', async () => {
    const owner = await paidOwner('agency');
    const guest = await person(h.db, 'guest');
    const token = await invitation(owner, guest.email);
    as(guest);
    const html = await invitePage({ token });
    expect(html).toContain('This page holds no invitation');
    expect(html).not.toMatch(/<form/);
  });

  it('shows the line of a refused acceptance', async () => {
    const owner = await paidOwner('agency');
    const guest = await person(h.db, 'guest');
    h.cookies.set('cm_link_invite', await invitation(owner, guest.email));
    as(await person(h.db, 'other'));
    expect(await invitePage({ notice: 'email_mismatch' })).toContain(
      'This invitation was sent to another address.',
    );
  });
});

describe('/seats', () => {
  it('has a document title of its own, and stays out of search results', async () => {
    const { metadata } = await import('../seats/page');
    expect(metadata).toEqual({
      title: 'Seats',
      robots: { index: false, follow: false },
      alternates: { canonical: null },
    });
  });

  it('is a 404 with V2_CHECKS_PUBLIC unset, and the sign-in page for a caller who is not signed in', async () => {
    await expect(seatsPage()).rejects.toMatchObject({ to: '/login' });
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    await expect(seatsPage()).rejects.toBeInstanceOf(NotFound);
  });

  it('the owner of an Agency account sees the people, the invite form and the plan’s extras', async () => {
    const owner = await paidOwner('agency');
    const member = await person(h.db, 'member');
    const seatId = await addSeat(h.db, owner.accountId, member, 'developer');
    await invitation(owner, 'pending@example.com');
    as(owner);
    const html = await seatsPage({ notice: 'seat_invited' });
    const main = html.replace(/^[\s\S]*<main/, '<main');
    expect(main).toContain('3 of 5 used · owner, 1 account manager, 1 developer');
    expect(main).toContain(member.email);
    expect(main).toContain('pending@example.com');
    expect(main).toContain('Invited, not yet accepted');
    expect(main).toContain(
      'Invited. The invitation will be emailed to that address from alerts@crawlmouse.com, and the seat is held for it',
    );
    expect(main).toMatch(/<form[^>]* action="\/api\/seats"/);
    expect(main).toMatch(/<form[^>]* action="\/api\/billing\/seats"/);
    expect(main).toContain(`action="/api/seats/id/${seatId}"`);
  });

  it('with V2_BILLING unset the plan’s extras are not offered', async () => {
    vi.stubEnv('V2_BILLING', '');
    as(await paidOwner('agency'));
    expect(await seatsPage()).not.toContain('/api/billing/seats');
  });

  it('a developer on the account sees the people and the role table, and no form', async () => {
    const owner = await paidOwner('agency');
    const dev = await person(h.db, 'dev');
    await addSeat(h.db, owner.accountId, dev, 'developer');
    await h.db.query(`update public.users set default_account_id = $2 where id = $1`, [
      dev.id,
      owner.accountId,
    ]);
    as(dev);
    const main = (await seatsPage()).replace(/^[\s\S]*<main/, '<main');
    expect(main).toContain('What each role can do');
    expect(main).toContain(owner.email);
    expect(main).not.toMatch(/<form/);
  });

  it('a Free account sees the gate message and no invite form', async () => {
    as(await person(h.db, 'free'));
    const main = (await seatsPage()).replace(/^[\s\S]*<main/, '<main');
    expect(main).toContain('Free has 1 seat. Pro has 2 seats: Pro is $19 a month.');
    expect(main).not.toMatch(/action="\/api\/seats"/);
  });
});
