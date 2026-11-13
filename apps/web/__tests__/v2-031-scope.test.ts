/**
 * CC-31 D2, at the library level: what each person reads of an Agency account's two client sites.
 * Run on PGlite with every migration applied. A caller's client is the PostgREST stand-in as that
 * user, so the row policies and `is_member_for_site` answer; the service role is the stand-in
 * without one. The routes over the same world: v2-031-scope-routes.test.ts.
 */
import type { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Capture } from '../lib/v2/account/events';
import { loadAccountDataset } from '../lib/v2/account/dataset';
import { packet } from '../lib/v2/account/fixes';
import { supabaseFixesStore } from '../lib/v2/account/fixes-store';
import { siteOfCaller } from '../lib/v2/account/pages';
import { loadSettingsDataset } from '../lib/v2/account/settings-dataset';
import {
  addSeat,
  adminOver,
  person,
  removeSeat,
  scopeWorld,
  sessionOver,
  type ClientSite,
  type Person,
  type ScopeWorld,
} from '../lib/v2/account/sites-test-support';
import { siteInScope, sitesInScope } from '../lib/v2/agency/guard';
import { supabaseCheckReader } from '../lib/v2/pipeline/load';
import { readableCheck } from '../lib/v2/pipeline/public';
import { sessionMembership } from '../lib/v2/pipeline/public-deps';
import { applyAllMigrations, freshDb } from './helpers/pglite-migrations';

vi.mock('server-only', () => ({}));

const PEOPLE = ['owner', 'manager', 'developer', 'removed', 'stranger'] as const;
type Who = (typeof PEOPLE)[number];
const SITES = ['site1', 'site2'] as const;
type SiteKey = (typeof SITES)[number];
type Covers = Record<SiteKey, boolean>;

/** Which client sites a person's seat covers, written by hand. The reads below are compared with it. */
const COVERS: Record<Who, Covers> = {
  owner: { site1: true, site2: true },
  manager: { site1: true, site2: true },
  developer: { site1: true, site2: false },
  removed: { site1: false, site2: false },
  stranger: { site1: false, site2: false },
};
/** Who reads the account's own row, which both datasets start from. */
const READS_ACCOUNT: Record<Who, boolean> = {
  owner: true,
  manager: true,
  developer: true,
  removed: false,
  stranger: false,
};
/** The world's two `seat_sites` rows: the developer's seat on site1, an invited seat on site2. */
type ScopeRow = 'developer→site1' | 'invited→site2';
/** The `seat_sites` rows each person reads. */
const SCOPE_ROWS: Record<Who, ScopeRow[]> = {
  owner: ['developer→site1', 'invited→site2'],
  manager: ['developer→site1', 'invited→site2'],
  developer: ['developer→site1'],
  removed: [],
  stranger: [],
};
const NOBODY: Covers = { site1: false, site2: false };

const CASES = PEOPLE.flatMap((who) => SITES.map((site) => [who, site, COVERS[who][site]] as const));

let db: PGlite;
let w: ScopeWorld;
let admin: SupabaseClient;
// After the rows the world writes: an account is read only from the moment it exists.
const NOW = new Date(Date.now() + 60_000);

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  w = await scopeWorld(db);
  admin = adminOver(db);
}, 300_000);
afterAll(async () => {
  await db?.close();
});

const sessionOf = (p: Person) => sessionOver(db, { id: p.id, email: p.email });
const sorted = (ids: string[]) => [...ids].sort();
const covered = (covers: Covers): ClientSite[] => SITES.filter((s) => covers[s]).map((s) => w[s]);

// ─── The reads, each as the plain value a test compares ────────────────────────────────────────────

const inScope = (p: Person, site: SiteKey) => siteInScope(sessionOf(p), w[site].id);
const scopedSites = async (p: Person) => sorted(await sitesInScope(sessionOf(p), w.accountId));
const sitePage = async (p: Person, site: SiteKey) =>
  (await siteOfCaller(sessionOf(p), p.id, w[site].id, NOW))?.accountId ?? null;

type Records = Pick<
  Awaited<ReturnType<typeof loadAccountDataset>>,
  'sites' | 'checks' | 'fixes' | 'fix_events' | 'changes' | 'reports' | 'alert_rules'
>;
const idsIn = (d: Records) => ({
  sites: sorted(d.sites.map((s) => s.id)),
  checks: sorted(d.checks.map((c) => c.id)),
  fixes: sorted(d.fixes.map((f) => f.id)),
  fixEvents: sorted(d.fix_events.map((e) => e.id)),
  changes: sorted(d.changes.map((c) => c.id)),
  reports: sorted(d.reports.map((r) => r.id)),
  siteRules: sorted(d.alert_rules.flatMap((r) => (r.site_id === null ? [] : [r.id]))),
});
const deps = (p: Person) => ({ session: sessionOf(p), admin, records: supabaseCheckReader(admin) });
const dashboard = (p: Person) => loadAccountDataset(deps(p), w.accountId, NOW);
const settings = async (p: Person) => (await loadSettingsDataset(deps(p), w.accountId, NOW)).d;
/** A dataset's ids, or 'refused' when the loader finds no account to read. */
async function idsOrRefused(load: Promise<Records>) {
  try {
    return idsIn(await load);
  } catch (e) {
    if (/no account/.test((e as Error).message)) return 'refused';
    throw e;
  }
}

const fixGate = async (p: Person, site: SiteKey) => {
  const { data, error } = await sessionOf(p).rpc('is_member_for_fix', { p_fix: w[site].fix });
  if (error) throw new Error(error.message);
  return data as boolean;
};
/** `packet()` past the route's own gate: what `reach` answers for the fix with the caller's session. */
const packetStatus = async (p: Person, site: SiteKey) =>
  (
    await packet(
      {
        session: sessionOf(p),
        store: supabaseFixesStore(admin),
        capture: (async () => undefined) as Capture,
        now: () => NOW,
      },
      { fixId: w[site].fix, userId: p.id },
    )
  ).status;
const checkGate = async (p: Person, site: SiteKey) =>
  (
    await readableCheck(
      { read: supabaseCheckReader(admin), isMember: sessionMembership(sessionOf(p), p.id) },
      w[site].check,
      { userId: p.id },
    )
  )?.siteId ?? null;

/** What a person pulls from PostgREST with their own token, by table. */
async function direct(p: Person) {
  const s = sessionOf(p);
  const ids = async (query: PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data as Record<string, string>[];
  };
  const column = async (table: string, key = 'id') =>
    sorted((await ids(s.from(table).select(key))).map((r) => r[key]!));
  return {
    sites: await column('sites'),
    checks: await column('checks'),
    changes: await column('changes'),
    reports: await column('reports'),
    report_schedules: await column('report_schedules', 'site_id'),
    alert_rules: sorted(
      (await ids(s.from('alert_rules').select('id').not('site_id', 'is', null))).map((r) => r.id!),
    ),
    alert_events: await column('alert_events'),
    seat_sites: sorted(
      (await ids(s.from('seat_sites').select('seat_id, site_id'))).map(
        (r) => `${r.seat_id}→${r.site_id}`,
      ),
    ),
  };
}

// ─── What the table says each read answers ─────────────────────────────────────────────────────────

const datasetIds = (covers: Covers) => {
  const sites = covered(covers);
  return {
    sites: sorted(sites.map((s) => s.id)),
    checks: sorted(sites.map((s) => s.check)),
    fixes: sorted(sites.map((s) => s.fix)),
    fixEvents: sorted(sites.map((s) => s.fixEvent)),
    changes: sorted(sites.map((s) => s.change)),
    reports: sorted(sites.map((s) => s.report)),
    siteRules: sorted(sites.map((s) => s.rule)),
  };
};
const scopeRow = (row: ScopeRow) =>
  row === 'developer→site1' ? `${w.developerSeat}→${w.site1.id}` : `${w.invitedSeat}→${w.site2.id}`;
const directIds = (covers: Covers, scopeRows: ScopeRow[]) => {
  const sites = covered(covers);
  return {
    sites: sorted(sites.map((s) => s.id)),
    checks: sorted(sites.map((s) => s.check)),
    changes: sorted(sites.map((s) => s.change)),
    reports: sorted(sites.map((s) => s.report)),
    report_schedules: sorted(sites.map((s) => s.id)),
    alert_rules: sorted(sites.map((s) => s.rule)),
    alert_events: sorted(sites.map((s) => s.alertEvent)),
    seat_sites: sorted(scopeRows.map(scopeRow)),
  };
};

/** Every string in `value`, at any depth, object keys included. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value !== null && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      strings(v, out);
    }
  return out;
}
/** The strings that name a site or a row of it. */
const namesOf = (s: ClientSite) => [
  s.id,
  s.host,
  s.check,
  s.fix,
  s.fixEvent,
  s.change,
  s.report,
  s.rule,
  ...s.slugs,
];
const found = (haystack: string[], needles: string[]) =>
  needles.filter((n) => haystack.some((h) => h.includes(n)));

// ─── The tests ─────────────────────────────────────────────────────────────────────────────────────

describe('siteInScope: is_member_for_site as the caller', () => {
  it.each(CASES)('%s, %s: %s', async (who, site, expected) => {
    expect(await inScope(w[who], site)).toBe(expected);
  });
});

describe('sitesInScope: the caller’s own read of the account’s live sites', () => {
  it.each(PEOPLE)('%s', async (who) => {
    expect(await scopedSites(w[who])).toEqual(datasetIds(COVERS[who]).sites);
  });
});

describe('siteOfCaller: the site page’s read, null where the page is a 404', () => {
  it.each(CASES)('%s, %s: %s', async (who, site, expected) => {
    expect(await sitePage(w[who], site)).toBe(expected ? w.accountId : null);
  });
});

describe.each([
  ['loadAccountDataset', dashboard],
  ['loadSettingsDataset', settings],
] as const)('%s', (_name, load) => {
  it.each(PEOPLE)(
    '%s reads the rows of the sites their seat covers, or no account',
    async (who) => {
      expect(await idsOrRefused(load(w[who]))).toEqual(
        READS_ACCOUNT[who] ? datasetIds(COVERS[who]) : 'refused',
      );
    },
  );

  it('the owner’s dataset names site2 by each of its strings, so the next test can fail', async () => {
    expect(found(strings(await load(w.owner)), namesOf(w.site2))).toEqual(namesOf(w.site2));
  });

  it('the developer’s dataset holds no string of site2 at any depth, and names site1', async () => {
    const all = strings(await load(w.developer));
    expect(found(all, namesOf(w.site2))).toEqual([]);
    expect(found(all, namesOf(w.site1))).toEqual(namesOf(w.site1));
  });
});

describe('the fix gate', () => {
  it.each(CASES)('is_member_for_fix as %s for the fix of %s: %s', async (who, site, expected) => {
    expect(await fixGate(w[who], site)).toBe(expected);
  });

  it.each(CASES)('packet() as %s for the fix of %s: in scope %s', async (who, site, expected) => {
    expect(await packetStatus(w[who], site)).toBe(expected ? 200 : 404);
  });
});

describe('the check gate: readableCheck with the session’s membership', () => {
  it.each(CASES)('%s, the check of %s: %s', async (who, site, expected) => {
    expect(await checkGate(w[who], site)).toBe(expected ? w[site].id : null);
  });
});

describe('direct reads with the person’s own token', () => {
  it.each(PEOPLE)('%s reads the rows of the sites their seat covers', async (who) => {
    expect(await direct(w[who])).toEqual(directIds(COVERS[who], SCOPE_ROWS[who]));
  });
});

// What D2 leaves as it is (docs/specs/v2/31-agency.md §4, security review r1 m1): rows of the account
// itself, which a seat reads whatever clients it covers. Pinned here so the spec's list is this test's.
describe('what a seat reads of the account itself, whatever its scope', () => {
  /** The rows a read returned; a read that fails is an error here, not "none". */
  const rowsOf = <T>(r: { data: T[] | null; error: { message: string } | null }, what: string) => {
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
    return r.data ?? [];
  };
  const reads = async (who: Who) => {
    const sb = sessionOf(w[who]);
    const [account, subscriptions, rules] = await Promise.all([
      sb
        .from('accounts')
        .select('card_last4, current_subscription_id, state_history')
        .eq('id', w.accountId),
      sb.from('subscriptions').select('id').eq('account_id', w.accountId),
      sb.from('alert_rules').select('id').eq('account_id', w.accountId).is('site_id', null),
    ]);
    return {
      account: rowsOf(account, 'accounts').length,
      subscriptions: rowsOf(subscriptions, 'subscriptions').length,
      accountRules: rowsOf(rules, 'alert_rules').length,
    };
  };

  beforeAll(async () => {
    await db.query(`select public.seed_default_alert_rules($1)`, [w.accountId]);
    // The account's subscription, as the billing mirror writes one (`makePaid` writes its id on
    // the account and no row).
    await db.query(
      `insert into public.subscriptions (id, account_id, status, plan, interval)
       select current_subscription_id, id, 'active', 'agency', 'month'
         from public.accounts where id = $1`,
      [w.accountId],
    );
  });

  it('the developer scoped to one client reads what the owner reads of them: the row, the subscription, the rules', async () => {
    const owner = await reads('owner');
    expect(owner.account).toBe(1);
    expect(owner.subscriptions).toBe(1);
    expect(owner.accountRules).toBeGreaterThan(0);
    expect(await reads('developer')).toEqual(owner);
    expect(await reads('manager')).toEqual(owner);
  });

  it.each(['removed', 'stranger'] as const)('%s reads none of them', async (who) => {
    expect(await reads(who)).toEqual({ account: 0, subscriptions: 0, accountRules: 0 });
  });
});

describe('a seat removed between two reads', () => {
  /** The reads above, for both sites, as one value. */
  const everyRead = async (p: Person) => ({
    inScope: [await inScope(p, 'site1'), await inScope(p, 'site2')],
    scopedSites: await scopedSites(p),
    sitePage: [await sitePage(p, 'site1'), await sitePage(p, 'site2')],
    dashboard: await idsOrRefused(dashboard(p)),
    settings: await idsOrRefused(settings(p)),
    fixGate: [await fixGate(p, 'site1'), await fixGate(p, 'site2')],
    packet: [await packetStatus(p, 'site1'), await packetStatus(p, 'site2')],
    checkGate: [await checkGate(p, 'site1'), await checkGate(p, 'site2')],
    direct: await direct(p),
  });

  it('an account manager reads both sites, and nothing once their seat is removed', async () => {
    const both: Covers = { site1: true, site2: true };
    expect(await everyRead(w.leaver)).toEqual({
      inScope: [true, true],
      scopedSites: datasetIds(both).sites,
      sitePage: [w.accountId, w.accountId],
      dashboard: datasetIds(both),
      settings: datasetIds(both),
      fixGate: [true, true],
      packet: [200, 200],
      checkGate: [w.site1.id, w.site2.id],
      direct: directIds(both, ['developer→site1', 'invited→site2']),
    });

    await removeSeat(db, w.leaverSeat);

    expect(await everyRead(w.leaver)).toEqual({
      inScope: [false, false],
      scopedSites: [],
      sitePage: [null, null],
      dashboard: 'refused',
      settings: 'refused',
      fixGate: [false, false],
      packet: [404, 404],
      checkGate: [null, null],
      direct: directIds(NOBODY, []),
    });
  });
});

// m1 of the test review: the personas above pair "unscoped" with manager and "scoped" with
// developer, so a rule that read the role would pass them. These two seats cross the pairing.
describe('scope, not role, decides which clients a seat reads', () => {
  let scopedManager: Person;
  let wideDeveloper: Person;
  /** The rows keyed by a site that a person reads directly; their own seat's scope rows left out. */
  const siteRows = async (p: Person) => {
    const rows = await direct(p);
    return { ...rows, seat_sites: undefined };
  };
  beforeAll(async () => {
    scopedManager = await person(db, 'scoped-manager');
    wideDeveloper = await person(db, 'wide-developer');
    await addSeat(db, w.accountId, scopedManager, 'account_manager', [w.site1.id]);
    await addSeat(db, w.accountId, wideDeveloper, 'developer');
  });

  it('an account manager whose seat covers site1 reads site1 and not site2, by each read', async () => {
    expect([await inScope(scopedManager, 'site1'), await inScope(scopedManager, 'site2')]).toEqual([
      true,
      false,
    ]);
    expect(await scopedSites(scopedManager)).toEqual([w.site1.id]);
    expect(await siteRows(scopedManager)).toEqual(await siteRows(w.developer));
  });

  it('a developer whose seat covers every client reads both', async () => {
    expect([await inScope(wideDeveloper, 'site1'), await inScope(wideDeveloper, 'site2')]).toEqual([
      true,
      true,
    ]);
    expect(await scopedSites(wideDeveloper)).toEqual(sorted([w.site1.id, w.site2.id]));
    expect(await siteRows(wideDeveloper)).toEqual(await siteRows(w.manager));
  });
});
