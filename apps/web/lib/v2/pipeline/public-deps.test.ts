/**
 * `requestAccess` as production builds it (CC-22b D3), with the two Supabase clients replaced at
 * the module boundary. The service-role client is the PostgREST stand-in over a migrated PGlite, so
 * each query the wiring builds runs against the schema. The session client answers `auth.getUser`
 * from the test and runs its `sites` read as the `authenticated` role with that user's id, so the
 * answer is the row-level policy's. Each client records the requests it was sent.
 */
import type { PGlite } from '@electric-sql/pglite';
import type { BuiltCheck } from '@crawlmouse/engine/v2/pipeline';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { recordedBuild } from '../../../../../packages/engine/fixtures/v2/build/recorded';
import { asRole } from '../../../__tests__/helpers/pglite-migrations';
import { postgrestOver, type Call } from '../../../__tests__/helpers/postgrest-pglite';
import { accountOf, doorDb, signUp } from '../../../__tests__/v2/_lib/door-pglite';
import { ACCOUNT_CLOCK_COLUMNS, loadCheckFor } from './load-for';
import { memoryEvidenceStore } from './test-support/memory-evidence';
import { pgliteCheckReader } from './test-support/pglite';
import { FIRST, keepSite, persistBuild } from './test-support/public-checks';

vi.mock('server-only', () => ({}));

/** Every request either client was sent, in order, as `[client, table, …]`. */
const sent: string[][] = [];
const clients: { admin: unknown; session: unknown } = { admin: null, session: null };
vi.mock('../../supabase/admin', () => ({ supabaseAdmin: () => clients.admin }));
vi.mock('../../supabase/server', () => ({ supabaseServer: async () => clients.session }));

const { requestAccess, sessionMembership } = await import('./public-deps');

let db: PGlite;
let first: BuiltCheck;
let owner: string;
let stranger: string;
let accountId: string;
let sessionError: { code: string } | null = null;

/** The session client of a request signed in as `userId` (null: a visitor). */
function sessionOf(userId: string | null) {
  return {
    auth: { getUser: async () => ({ data: { user: userId === null ? null : { id: userId } } }) },
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: async (column: string, value: string) => {
          sent.push(['session', table, columns, column, value]);
          if (sessionError) return { data: null, error: sessionError };
          if (table !== 'sites' || columns !== 'id' || column !== 'id')
            throw new Error(`the session client models the membership read only`);
          const role = userId === null ? 'anon' : 'authenticated';
          const { rows } = await asRole(db, role, userId, (tx) =>
            tx.query(`select id from public.sites where id = $1`, [value]),
          );
          return { data: rows, error: null };
        },
      }),
    }),
  };
}

/**
 * The service-role client. A request is noted by its table (and its column list) as it is sent.
 * `select('*').in(…).order(…).range(…)`, the check reader's chain, is answered from the same
 * database as the service role, a page at a time; the stand-in, which has no `range`, answers the
 * rest (the plan's read of `accounts`), so that read's column list meets the schema.
 */
function adminOver(pg: PGlite) {
  const standIn = postgrestOver(pg, {
    before: async (request: readonly Call[]) => {
      sent.push(['admin', ...request.slice(0, 2).map((call) => String(call[1]))]);
    },
  });
  const reader = pgliteCheckReader(pg);
  return {
    from: (table: string) => ({
      select: (columns: string) => {
        if (columns !== '*') return standIn.from(table).select(columns);
        let filter: [string, readonly string[]] | null = null;
        const chain = {
          in(column: string, values: readonly string[]) {
            filter = [column, values];
            return chain;
          },
          order: () => chain,
          async range(from: number, to: number) {
            if (!filter) throw new Error('the reader filters before it pages');
            if (from === 0) sent.push(['admin', table, columns]);
            const rows = await reader.rows(table as never, filter[0], filter[1]);
            return { data: rows.slice(from, to + 1), error: null };
          },
        };
        return chain;
      },
    }),
  };
}

const signedInAs = (userId: string | null) => {
  clients.session = sessionOf(userId);
  return requestAccess();
};
const tablesAsked = (client: 'admin' | 'session') =>
  sent.filter((r) => r[0] === client).map((r) => r[1]);

beforeAll(async () => {
  db = await doorDb();
  first = await persistBuild(db, memoryEvidenceStore(), recordedBuild());
  owner = await signUp(db, 'owner@example.com');
  stranger = await signUp(db, 'stranger@example.com');
  accountId = (await accountOf(db, owner)).id;
  await keepSite(db, first.check.site_id, accountId);
  clients.admin = adminOver(db);
}, 180_000);

afterEach(() => {
  sent.length = 0;
  sessionError = null;
});

describe('requestAccess: the viewer', () => {
  it('is the session’s own user, and nobody for a visitor', async () => {
    expect((await signedInAs(owner)).viewer).toEqual({ userId: owner });
    expect((await signedInAs(null)).viewer).toEqual({ userId: null });
  });
});

describe('requestAccess: isMember', () => {
  const site = () => first.check.site_id;

  it('asks through the session client, never the service role, and the policy answers', async () => {
    const asOwner = await signedInAs(owner);
    expect(await asOwner.deps.isMember(site(), owner)).toBe(true);
    const asStranger = await signedInAs(stranger);
    expect(await asStranger.deps.isMember(site(), stranger)).toBe(false);
    expect(sent).toEqual([
      ['session', 'sites', 'id', 'id', site()],
      ['session', 'sites', 'id', 'id', site()],
    ]);
    // Anti-vacuity: the service role, which the wiring must not ask, does read the row.
    const { data } = await (clients.admin as ReturnType<typeof postgrestOver>)
      .from('sites')
      .select('id')
      .eq('id', site());
    expect(data).toHaveLength(1);
  });

  it('refuses a user id other than the session’s own without asking the database', async () => {
    const asStranger = await signedInAs(stranger);
    expect(await asStranger.deps.isMember(site(), owner)).toBe(false);
    const asVisitor = await signedInAs(null);
    expect(await asVisitor.deps.isMember(site(), owner)).toBe(false);
    expect(sent).toEqual([]);
  });

  it('throws on a database error rather than answering', async () => {
    const asOwner = await signedInAs(owner);
    sessionError = { code: '57014' };
    await expect(asOwner.deps.isMember(site(), owner)).rejects.toThrow(/57014/);
  });

  it('is `sessionMembership`, the factory the check routes share', async () => {
    const isMember = sessionMembership(sessionOf(stranger) as never, stranger);
    expect(await isMember(site(), stranger)).toBe(false);
    expect(await sessionMembership(sessionOf(owner) as never, owner)(site(), owner)).toBe(true);
    expect(await sessionMembership(sessionOf(owner) as never, owner)(site(), stranger)).toBe(false);
  });
});

describe('requestAccess: planOf', () => {
  const trialUntil = (ends: string) =>
    db.query(
      `update public.accounts set state = 'pro_trial', tier = 'pro', trial_variant = 'no_card',
              trial_ends_at = $2, trial_used_at = '2020-01-01T00:00:00Z',
              state_history = state_history || jsonb_build_array(jsonb_build_object('state','pro_trial','since','2020-01-01T00:00:00.000Z'))
        where id = $1`,
      [accountId, ends],
    );

  it('reads the account’s entitlement columns through the service role, at the time of the request', async () => {
    const { deps } = await signedInAs(owner);
    expect((await accountOf(db, owner)).state).toBe('free');
    expect(await deps.planOf(accountId)).toBe('free');
    expect(sent).toEqual([['admin', 'accounts', ACCOUNT_CLOCK_COLUMNS]]);
    // A trial that ended before today opens the Free three; one that ends after today opens each fix.
    await trialUntil('2020-01-15T00:00:00Z');
    expect(await deps.planOf(accountId)).toBe('free');
    await db.query(
      `update public.accounts set trial_ends_at = '2999-01-01T00:00:00Z' where id = $1`,
      [accountId],
    );
    expect(await deps.planOf(accountId)).toBe('pro');
    await expect(deps.planOf('00000000-0000-4000-8000-000000000000')).rejects.toThrow(
      /account was not found/,
    );
    expect(tablesAsked('session')).toEqual([]);
  });
});

describe('loadCheckFor over requestAccess, for a kept check', () => {
  it('a member reads it, and the plan is read after the membership answer', async () => {
    const { deps, viewer } = await signedInAs(owner);
    const read = await loadCheckFor(deps, FIRST, viewer);
    expect(read).toMatchObject({ state: 'ready', kept: true, plan: 'pro' });
    const membership = sent.findIndex((r) => r[0] === 'session');
    const plan = sent.findIndex((r) => r[0] === 'admin' && r[1] === 'accounts');
    expect(membership).toBeGreaterThan(-1);
    expect(plan).toBeGreaterThan(membership);
    expect(tablesAsked('session')).toEqual(['sites']);
  });

  it('a stranger and a visitor read nothing of it: no plan, no page row', async () => {
    for (const userId of [stranger, null]) {
      sent.length = 0;
      const { deps, viewer } = await signedInAs(userId);
      expect(await loadCheckFor(deps, FIRST, viewer)).toBeNull();
      // The check's row and its site's, which decide the answer, and nothing after them.
      expect(tablesAsked('admin')).toEqual(['checks', 'sites']);
      expect(tablesAsked('session')).toEqual(userId === null ? [] : ['sites']);
    }
  });
});
