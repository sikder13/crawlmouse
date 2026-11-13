import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * What a report's recipient refused, on a real Postgres with the product's own writers of a client's
 * rows (`add_site`, `remove_site`, `keep_check`), which the PGlite tests stand in for with an insert
 * and an update: migration 20261114000002, docs/specs/v2/31-agency.md §10. Run like
 * scripts/db/seats-race.test.ts: against TRIAL_RACE_DB_URL (a Postgres on this machine), required
 * when TRIAL_RACE_REQUIRED=1, skipped otherwise.
 *
 * A client is an account's host, whichever row holds it. The first two groups bring a client back
 * by each route and ask what a pause and a pause link then do. The third holds two of the
 * migration's calls open at once: PGlite has one backend and cannot. The same interleavings also run
 * against a database built from the migration with one line of each rule taken out, where the
 * fault each rule prevents must show: those are the mutation checks, run whenever the file runs.
 */

const URL_ENV = process.env.TRIAL_RACE_DB_URL;
if (!URL_ENV && process.env.TRIAL_RACE_REQUIRED === '1') {
  throw new Error('TRIAL_RACE_REQUIRED=1 but TRIAL_RACE_DB_URL is not set');
}
// It creates databases and cluster-wide roles, so it runs only against a Postgres on this machine.
if (URL_ENV && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(URL_ENV).hostname)) {
  throw new Error('TRIAL_RACE_DB_URL must name a local Postgres (localhost, 127.0.0.1 or [::1])');
}

const MIGRATION = '20261114000002_v2_031_agency.sql';

/** confirm_report_recipient's lock of the client's rows, and the one row it locked before. */
const CONFIRM_LOCK =
  '  perform public.lock_report_client(\n    (select rs.site_id from public.report_schedules rs\n      where rs.recipient_confirm_hash = p_token_hash));\n';
const CONFIRM_ONE_ROW =
  '  perform 1\n     from public.sites st\n    where st.id = (select rs.site_id from public.report_schedules rs\n                    where rs.recipient_confirm_hash = p_token_hash)\n      for update;\n';
/** decline_report_requests, the page's button: the link is read again after the wait. */
const PAGE_RECHECK =
  '       and exists (select 1\n                     from public.report_schedules rs\n                    where rs.site_id = st.id\n                      and (rs.recipient_confirm_hash = p_token_hash\n                           or rs.pause_token_hash = p_token_hash));\n';
/** decline_report_requests, the mail's own link: the entry is read after the wait. */
const MAIL_LOCK = '    perform public.lock_report_client(v_site);\n';
const MAIL_READ =
  "    -- Read after the wait: an entry the erasure took meanwhile is not written again.\n    select e.v ->> 'a' into v_key\n      from public.sites st\n     cross join lateral pg_catalog.jsonb_array_elements(st.report_refusals) as e(v)\n     where st.id = v_site and e.v ->> 'd' = p_token_hash\n     limit 1;\n";

const TEST_TIMEOUT_MS = 60_000;
const HOOK_TIMEOUT_MS = 300_000;
/** How long to watch for a call waiting on a lock. */
const WAIT_WATCH_MS = 4000;

type Sql = postgres.Sql;
type Out = { outcome: string; token?: string };

function urlFor(base: string, database: string): string {
  const u = new URL(base);
  u.pathname = `/${database}`;
  return u.toString();
}

/** A fresh database with the Supabase stand-ins and every migration, this one's text edited by `edit`. */
async function migrated(admin: Sql, name: string, edit: (sql: string) => string = (s) => s) {
  const { PLATFORM_SHIM, migrationFiles, readMigration } =
    await import('../../apps/web/__tests__/helpers/pglite-migrations');
  await admin.unsafe(`create database ${name}`);
  const sql = postgres(urlFor(URL_ENV!, name), { max: 8, onnotice: () => {} });
  // Roles are cluster-wide: the second database finds the first one's.
  const shim = PLATFORM_SHIM.replace(
    /create role (\w+)([^;]*);/g,
    (_m, role: string, opts: string) =>
      `do $r$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role}${opts}; end if; end $r$;`,
  );
  await sql.unsafe(shim).simple();
  for (const f of migrationFiles()) {
    const text = readMigration(f);
    await sql.unsafe(f === MIGRATION ? edit(text) : text).simple();
  }
  return sql;
}

/** `text` with `from` replaced by `to`, refusing unless `from` is there exactly once. */
function swap(text: string, from: string, to: string): string {
  if (text.split(from).length !== 2) {
    throw new Error(
      `the text to replace is not in ${MIGRATION} exactly once: ${from.slice(0, 60)}`,
    );
  }
  return text.replace(from, to);
}

/** The migration with each of the three rules taken out. */
const unruled = (text: string): string =>
  swap(
    swap(swap(text, CONFIRM_LOCK, CONFIRM_ONE_ROW), PAGE_RECHECK, ';\n'),
    MAIL_LOCK + MAIL_READ,
    MAIL_READ + MAIL_LOCK,
  );

const sha256 = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');
const WEEKLY = {
  cadence: 'weekly',
  iso_weekday: 1,
  time_local: '09:00',
  timezone: 'UTC',
  send_when_unchanged: true,
};
const T0 = Date.parse('2026-11-13T12:00:00.000Z');
const DAY = 24 * 60;
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();
const host = () => `${randomUUID().slice(0, 8)}.example`;
const address = () => `reader-${randomUUID().slice(0, 8)}@client.example`;
/** A site id that sorts before, or after, every random one beside it. */
const idThatSorts = (where: 'first' | 'last') =>
  `${where === 'first' ? '00000000' : 'ffffffff'}${randomUUID().slice(8)}`;

type Route = 'add_site' | 'keep_check';
const ROUTES: Route[] = ['add_site', 'keep_check'];

/** The product's own functions, called on one database. */
function on(sql: Sql) {
  type Owner = { accountId: string; seatId: string };

  async function owner(): Promise<Owner> {
    const email = `links-${randomUUID()}@example.com`;
    const [u] =
      await sql`insert into auth.users (id, email) values (gen_random_uuid(), ${email}) returning id`;
    const [a] =
      await sql`select default_account_id as account_id from public.users where id = ${u!.id}`;
    const accountId = a!.account_id as string;
    const [s] =
      await sql`select id from public.seats where account_id = ${accountId} and role = 'owner'`;
    return { accountId, seatId: s!.id as string };
  }

  /** `add_site`, the route a signed-in account adds a client by. */
  async function addSite(p: Owner, h: string, id: string = randomUUID()) {
    const now = new Date().toISOString();
    const site = {
      id,
      account_id: p.accountId,
      host: h,
      owner_seat_id: p.seatId,
      schedule_cadence: null,
      schedule_iso_weekday: null,
      schedule_hour_local: null,
    };
    const check = {
      id: randomUUID(),
      site_id: id,
      trigger: 'first_audit',
      grade_version: '2.0.0',
      queued_at: now,
      heartbeat_at: now,
      expires_at: null,
    };
    const slot = {
      bucket: `links:${randomUUID()}`,
      window_start: '2026-11-10T00:00:00.000Z',
      limit: 1000,
    };
    const [x] =
      await sql`select public.add_site(${sql.json(site as never)}, ${sql.json(check as never)}, 100,
                                       ${sql.json(slot as never)}, null) as r`;
    const r = x!.r as { outcome: string };
    if (r.outcome !== 'created') throw new Error(`add_site: ${JSON.stringify(r)}`);
    return id;
  }

  /** A row no account keeps, as a public check makes one, kept by the account through `keep_check`. */
  async function keepFromPublicCheck(p: Owner, h: string) {
    const site = randomUUID();
    const check = randomUUID();
    await sql`insert into public.sites (id, account_id, host) values (${site}, null, ${h})`;
    await sql`insert into public.checks (id, site_id, status, trigger, grade_version, queued_at,
                                         heartbeat_at, expires_at)
              values (${check}, ${site}, 'queued', 'first_audit', '2.0.0', now(), now(),
                      now() + interval '1 day')`;
    const [k] =
      await sql`select public.keep_check(${check}::uuid, ${p.accountId}::uuid, ${p.seatId}::uuid,
                                         'monthly', 1, 9, '[]'::jsonb) as r`;
    if (k!.r !== 'taken') throw new Error(`keep_check: ${String(k!.r)}`);
    return site;
  }

  const outcome = (rows: postgres.Row[]) => (rows[0]!.r as Out).outcome;
  const setClient = async (site: string, account: string, email: string | null) =>
    outcome(
      await sql`select public.set_client(${site}, ${account},
                                         ${sql.json({ client_contact_email: email })}) as r`,
    );
  const setSchedule = async (site: string, account: string, minutes: number) =>
    outcome(
      await sql`select public.set_report_schedule(${site}, ${account}, ${sql.json(WEEKLY)},
                                                  ${at(minutes)}) as r`,
    );
  /** The token the mailer derives for a site and an address: here any value the two decide. */
  const ownToken = (site: string, email: string) => `own:${site}:${email}`;
  /** As the mailer asks (report-mail-store.ts): the address it read, and its own token's hash. */
  async function issue(site: string, email: string, request: string, minutes: number, hash = true) {
    const own = ownToken(site, email);
    const [x] = hash
      ? await sql`select public.issue_recipient_confirmation(${site}, ${at(minutes)}, ${request},
                                                             ${email}, ${sha256(own)}) as r`
      : await sql`select public.issue_recipient_confirmation(${site}, ${at(minutes)},
                                                             ${request}) as r`;
    return { ...(x!.r as Out), own };
  }
  const confirm = async (token: string, minutes: number) =>
    outcome(
      await sql`select public.confirm_report_recipient(${sha256(token)}, ${at(minutes)}) as r`,
    );
  const issuePause = async (site: string, email: string, token: string, minutes: number) =>
    outcome(
      await sql`select public.issue_report_pause(${site}, ${email}, ${sha256(token)},
                                                 ${at(minutes)}) as r`,
    );
  const pause = async (token: string, minutes: number) =>
    outcome(await sql`select public.pause_report_schedule(${sha256(token)}, ${at(minutes)}) as r`);
  const refusals = async (site: string) =>
    (await sql`select report_refusals as r from public.sites where id = ${site}`)[0]!.r as Record<
      string,
      string
    >[];
  const scheduleOf = async (site: string) =>
    (
      await sql`select paused_by_recipient_at is not null as paused,
                       recipient_confirmed_at is not null as confirmed,
                       recipient_confirm_hash is not null as waiting
                  from public.report_schedules where site_id = ${site}`
    )[0] as { paused: boolean; confirmed: boolean; waiting: boolean };

  /** A client whose contact was mailed one request at minute 0. */
  async function asked(email = address(), id: string = randomUUID()) {
    const p = await owner();
    const h = host();
    const site = await addSite(p, h, id);
    await setClient(site, p.accountId, email);
    await setSchedule(site, p.accountId, 0);
    const i = await issue(site, email, 'ask-1', 0);
    expect(i.outcome).toBe('issued');
    return { p, h, site, email, confirmToken: i.token!, own: i.own };
  }

  /** The client's row removed, and the client brought back by `route` with the same contact. */
  async function broughtBack(
    c: { p: Owner; h: string; site: string; email: string },
    route: Route,
    minutes: number,
    id: string = randomUUID(),
  ) {
    const [gone] = await sql`select public.remove_site(${c.site}) as r`;
    expect((gone!.r as Out).outcome).toBe('removed');
    const site =
      route === 'add_site' ? await addSite(c.p, c.h, id) : await keepFromPublicCheck(c.p, c.h);
    await setClient(site, c.p.accountId, c.email);
    await setSchedule(site, c.p.accountId, minutes);
    return site;
  }

  /** Whether the backend `pid` comes to wait on a lock within the watch. */
  async function waits(pid: number) {
    for (const until = Date.now() + WAIT_WATCH_MS; Date.now() < until; ) {
      const [w] =
        await sql`select exists (select 1 from pg_locks where pid = ${pid} and not granted) as w`;
      if (w!.w) return true;
      await new Promise((r) => setTimeout(r, 20));
    }
    return false;
  }
  const pidOf = async (t: postgres.ReservedSql) =>
    ((await t`select pg_backend_pid() as pid`) as unknown as [{ pid: number }])[0].pid;
  const settled = (q: PromiseLike<postgres.Row[]>) =>
    Promise.resolve(q).then(
      (rows) => (rows[0]!.r as Out).outcome,
      (e: { code?: string }) => `error ${e.code}`,
    );
  async function done(...ts: postgres.ReservedSql[]) {
    for (const t of ts) {
      await t`rollback`.catch(() => {});
      t.release();
    }
  }

  /**
   * The contact is changed while the address the page was opened for presses its "Don't ask me
   * again". The press waits for the client's rows; the change commits; the press goes on.
   */
  async function contactChangedDuringThePress() {
    const c = await asked();
    const other = address();
    const ta = await sql.reserve();
    const tb = await sql.reserve();
    try {
      const pid = await pidOf(tb);
      await ta`begin`;
      await ta`select 1 from public.sites st where st.id = ${c.site} for update of st`;
      await tb`begin`;
      const press = settled(
        tb`select public.decline_report_requests(${sha256(c.confirmToken)}, ${at(1)}) as r`,
      );
      const waited = await waits(pid);
      await ta`select public.set_client(${c.site}, ${c.p.accountId},
                                        ${sql.json({ client_contact_email: other })})`;
      await ta`commit`;
      const pressed = await press;
      await tb`commit`.catch(() => {});
      const declinedFor = (await refusals(c.site))
        .filter((e) => 'declined_at' in e)
        .map((e) => (e.a === sha256(other) ? 'the new contact' : 'the address that pressed'));
      return { waited, pressed, declinedFor };
    } finally {
      await done(ta, tb);
    }
  }

  /** The erasure blanks the contact (CC-27b's rule 30) while that address presses its mail's link. */
  async function erasedDuringThePress() {
    const c = await asked();
    const ta = await sql.reserve();
    const tb = await sql.reserve();
    try {
      const pid = await pidOf(tb);
      await ta`begin`;
      await ta`update public.sites set client_contact_email = null where id = ${c.site}`;
      await tb`begin`;
      const press = settled(
        tb`select public.decline_report_requests(${sha256(c.own)}, ${at(7)}) as r`,
      );
      const waited = await waits(pid);
      await ta`commit`;
      const pressed = await press;
      await tb`commit`.catch(() => {});
      const held = (await refusals(c.site)).some((e) => e.a === sha256(c.email));
      return { waited, pressed, held };
    } finally {
      await done(ta, tb);
    }
  }

  /**
   * On a client with two rows, the removed one sorting `removed` among the two: the link of the
   * mail sent before the removal is pressed while the request sent about the live row is
   * confirmed. A third session holds the removed row until both are seen waiting.
   */
  async function oldLinkAgainstTheConfirmation(removed: 'first' | 'last') {
    const c = await asked(address(), idThatSorts(removed));
    const live = await broughtBack(
      c,
      'add_site',
      5,
      idThatSorts(removed === 'first' ? 'last' : 'first'),
    );
    const i = await issue(live, c.email, 'on-the-live-row', 6);
    expect(i.outcome).toBe('issued');
    const hold = await sql.reserve();
    const t1 = await sql.reserve();
    const t2 = await sql.reserve();
    try {
      const [p1, p2] = [await pidOf(t1), await pidOf(t2)];
      await hold`begin`;
      await hold`select 1 from public.sites st where st.id = ${c.site} for update of st`;
      await t2`begin`;
      const press = settled(
        t2`select public.decline_report_requests(${sha256(c.own)}, ${at(7)}) as r`,
      );
      const pressWaited = await waits(p2);
      await t1`begin`;
      const confirmation = settled(
        t1`select public.confirm_report_recipient(${sha256(i.token!)}, ${at(7)}) as r`,
      );
      const confirmationWaited = await waits(p1);
      await hold`commit`;
      const [pressed, confirmed] = await Promise.all([
        press.then(async (v) => {
          await t2`commit`.catch(() => {});
          return v;
        }),
        confirmation.then(async (v) => {
          await t1`commit`.catch(() => {});
          return v;
        }),
      ]);
      return { pressWaited, confirmationWaited, pressed, confirmed, live, site: c.site };
    } finally {
      await done(hold, t1, t2);
    }
  }

  return {
    asked,
    broughtBack,
    issue,
    confirm,
    issuePause,
    pause,
    refusals,
    scheduleOf,
    contactChangedDuringThePress,
    erasedDuringThePress,
    oldLinkAgainstTheConfirmation,
  };
}

describe.skipIf(!URL_ENV)('what a recipient refused, over the product’s own rows', () => {
  const suffix = `${process.pid}_${Date.now()}`;
  const names = { real: `cc31_links_${suffix}`, unruled: `cc31_links_unruled_${suffix}` };
  let admin: Sql;
  let realSql: Sql;
  let unruledSql: Sql;
  let real: ReturnType<typeof on>;
  let broken: ReturnType<typeof on>;

  beforeAll(async () => {
    admin = postgres(URL_ENV!, { max: 1, onnotice: () => {} });
    realSql = await migrated(admin, names.real);
    unruledSql = await migrated(admin, names.unruled, unruled);
    real = on(realSql);
    broken = on(unruledSql);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await realSql?.end();
    await unruledSql?.end();
    for (const name of Object.values(names)) await admin?.unsafe(`drop database if exists ${name}`);
    await admin?.end();
  }, HOOK_TIMEOUT_MS);

  describe('a recipient who paused, and a client brought back by either route', () => {
    for (const route of ROUTES) {
      for (const withHash of [true, false]) {
        it(
          `${route}, ${withHash ? 'asked as the mailer asks' : 'asked with no token'}: one request in the window, counted from the first`,
          async () => {
            const c = await real.asked();
            expect(await real.confirm(c.confirmToken, 1)).toBe('confirmed');
            const link = `pause:${c.site}`;
            expect(await real.issuePause(c.site, c.email, link, 1)).toBe('issued');
            expect(await real.pause(link, 2)).toBe('paused');
            const back = await real.broughtBack(c, route, 5);
            const asks: string[] = [];
            for (const n of [1, 2, 3, 4]) {
              asks.push((await real.issue(back, c.email, `again-${n}`, 10 + n, withHash)).outcome);
            }
            expect(asks).toEqual(['issued', 'none', 'none', 'none']);
            // And on the day the window has passed: one more, and no second.
            const later = [
              (await real.issue(back, c.email, 'later-1', 31 * DAY, withHash)).outcome,
              (await real.issue(back, c.email, 'later-2', 31 * DAY + 1, withHash)).outcome,
            ];
            expect(later).toEqual(['issued', 'none']);
          },
          TEST_TIMEOUT_MS,
        );
      }
    }
  });

  describe('the pause link of a report mailed before the client was removed', () => {
    for (const route of ROUTES) {
      it(
        `${route}: pressed after the recipient confirmed again on the row the client came back as, it stops that row’s reports`,
        async () => {
          const c = await real.asked();
          expect(await real.confirm(c.confirmToken, 1)).toBe('confirmed');
          const oldLink = `pause:${c.site}`;
          expect(await real.issuePause(c.site, c.email, oldLink, 1)).toBe('issued');
          const back = await real.broughtBack(c, route, 5);
          const again = await real.issue(back, c.email, 'on-the-live-row', 6);
          expect(await real.confirm(again.token!, 7)).toBe('confirmed');
          const newLink = `pause:${back}`;
          expect(await real.issuePause(back, c.email, newLink, 8)).toBe('issued');
          expect(await real.scheduleOf(back)).toMatchObject({ paused: false, confirmed: true });

          expect(await real.pause(oldLink, 9)).toBe('paused');
          expect(await real.scheduleOf(back)).toMatchObject({ paused: true });
          // The mailer's next report for the live row is issued no link, so it is not sent.
          expect(await real.issuePause(back, c.email, newLink, 10)).toBe('none');
        },
        TEST_TIMEOUT_MS,
      );
    }
  });

  describe('two calls on one client at once', () => {
    it(
      'a contact changed while the old address presses the page’s button: the press finds its link gone and records nothing',
      async () => {
        expect(await real.contactChangedDuringThePress()).toEqual({
          waited: true,
          pressed: 'gone',
          declinedFor: [],
        });
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'an address erased while its own link is pressed: the press finds its entry gone and writes no hash again',
      async () => {
        expect(await real.erasedDuringThePress()).toEqual({
          waited: true,
          pressed: 'gone',
          held: false,
        });
      },
      TEST_TIMEOUT_MS,
    );

    for (const removed of ['first', 'last'] as const) {
      it(
        `the old mail’s link against the new mail’s confirmation, the removed row sorting ${removed}: both end, and the refusal stands`,
        async () => {
          const r = await real.oldLinkAgainstTheConfirmation(removed);
          expect(r.pressWaited).toBe(true);
          expect(r.pressed).toBe('declined');
          expect(['confirmed', 'gone']).toContain(r.confirmed);
          const declined = [...(await real.refusals(r.site)), ...(await real.refusals(r.live))];
          expect(declined.some((e) => 'declined_at' in e)).toBe(true);
          // Whichever went first, the address is asked nothing more and sent nothing.
          const s = await real.scheduleOf(r.live);
          expect(s.waiting).toBe(false);
          expect(s.confirmed && !s.paused).toBe(false);
        },
        TEST_TIMEOUT_MS,
      );
    }
  });

  describe('with each rule taken out of the migration, the fault it prevents shows', () => {
    it(
      'no second read of the page’s link: the refusal is recorded for the contact that came after',
      async () => {
        expect(await broken.contactChangedDuringThePress()).toEqual({
          waited: true,
          pressed: 'declined',
          declinedFor: ['the new contact'],
        });
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'the entry read before the wait: the erased address’s hash is written again',
      async () => {
        expect(await broken.erasedDuringThePress()).toEqual({
          waited: true,
          pressed: 'declined',
          held: true,
        });
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'the confirmation locking its one row: with the removed row sorting first, Postgres ends one of the two calls as a deadlock',
      async () => {
        const r = await broken.oldLinkAgainstTheConfirmation('first');
        expect([r.pressed, r.confirmed]).toContain('error 40P01');
      },
      TEST_TIMEOUT_MS,
    );
  });
});
