import { beforeAll, describe, expect } from 'vitest';
import { QA_ACCOUNTS } from './accounts';
import { createPhrase, exitCode, seed } from './seed';
import { rateLimitWindowStart } from '../../apps/web/lib/rate-limit-window';
import { hashLedgerValue } from '../../apps/web/lib/auth/ledger';
import { normalizeEmail } from '../../apps/web/lib/auth/normalize-email';
import type { PGlite } from '@electric-sql/pglite';
import {
  dump,
  HAS_INTERNAL_MARKER,
  migratedBase,
  PGLITE_TIMEOUT,
  SAMPLE_PEPPER,
  withMarker,
  world,
} from './test-support';

/**
 * CC-38 D1(a) on PGlite with every migration: the set through the real sign-up trigger, CC-29's
 * agency account, `add_site`, the seat invitation and the account door's trial decision.
 *   pnpm --filter @crawlmouse/scripts exec vitest run qa/seed.pglite.test.ts
 */

let base: PGlite;
beforeAll(async () => {
  if (HAS_INTERNAL_MARKER) base = await migratedBase();
}, 300_000);

describe('qa:seed part (a)', () => {
  withMarker(
    `makes the set: a user and an internal, marked account for each key`,
    async () => {
      const w = await world(base);
      const steps = await seed(w.deps);
      expect(exitCode(steps)).toBe(0);
      const marked = await w.db.query<{ qa_key: string; internal: boolean; kind: string }>(
        `select q.qa_key, a.internal, a.kind from public.qa_accounts q
         join public.accounts a on a.id = q.account_id order by q.qa_key`,
      );
      // Every key has its personal account, the developer's included (its work is a seat on another
      // account, but the account handle_new_user gave it is ours too); an agency key has its agency
      // account as well.
      const expected = QA_ACCOUNTS.flatMap((a) =>
        a.home.kind === 'agency' ? [a.key, a.key] : [a.key],
      ).sort();
      expect(expected).toContain('agency-dev');
      expect(marked.rows.map((r) => r.qa_key)).toEqual(expected);
      expect(marked.rows.every((r) => r.internal)).toBe(true);
      expect(
        marked.rows
          .filter((r) => r.kind === 'agency')
          .map((r) => r.qa_key)
          .sort(),
      ).toEqual(['agency', 'agencytrial', 'demo']);
    },
    PGLITE_TIMEOUT,
  );

  withMarker(
    `a second run changes no row and says every step is unchanged`,
    async () => {
      const w = await world(base);
      await seed(w.deps);
      const before = await dump(w.db);
      const sentBefore = w.sent.length;
      const again = await seed(w.deps);
      expect(await dump(w.db)).toBe(before);
      expect(w.sent.length).toBe(sentBefore);
      expect(again.filter((s) => s.outcome === 'done')).toEqual([]);
    },
    PGLITE_TIMEOUT,
  );

  withMarker(
    `starts qa+protrial's no-card Pro trial through the door's decision`,
    async () => {
      const w = await world(base);
      await seed(w.deps);
      const r = await w.db.query<{ state: string; trial_variant: string }>(
        `select a.state, a.trial_variant from public.accounts a
         join public.qa_accounts q on q.account_id = a.id where q.qa_key = 'protrial'`,
      );
      expect(r.rows).toEqual([{ state: 'pro_trial', trial_variant: 'no_card' }]);
      // The trial's effects went to the dispatcher, as the dashboard's offer sends them.
      expect(w.dispatched.length).toBeGreaterThan(0);
    },
    PGLITE_TIMEOUT,
  );

  withMarker(
    `a step the plan does not allow yet waits for it, and nothing else is refused`,
    async () => {
      const w = await world(base);
      const steps = await seed(w.deps);
      const waiting = steps.filter((s) => s.outcome === 'waits_for_plan').map((s) => s.key);
      // Free accounts hold one site: qa+pro's four others, qa+agency's five other clients, the
      // developer's seat, demo's two others.
      expect(new Set(waiting)).toEqual(new Set(['pro', 'agency', 'agency-dev', 'demo']));
      expect(steps.filter((s) => s.outcome === 'refused')).toEqual([]);
    },
    PGLITE_TIMEOUT,
  );

  withMarker(
    `refuses a QA address someone else signed up with, and touches its account not at all`,
    async () => {
      const w = await world(base);
      const theirs = await w.signUp('qa+free@example.test');
      const steps = await seed(w.deps);
      expect(steps).toContainEqual(
        expect.objectContaining({ key: 'free', step: 'stopped', outcome: 'refused' }),
      );
      expect(exitCode(steps)).toBe(1);
      const a = await w.db.query<{ internal: boolean; n: number }>(
        `select a.internal, (select count(*)::int from public.sites s where s.account_id = a.id) n,
              exists (select 1 from public.qa_accounts q where q.account_id = a.id) marked
         from public.users u join public.accounts a on a.id = u.default_account_id where u.id = $1`,
        [theirs],
      );
      expect(a.rows).toEqual([{ internal: false, n: 0, marked: false }]);
    },
    PGLITE_TIMEOUT,
  );

  withMarker(
    `refuses an account whose user it made but whose marker is missing`,
    async () => {
      const w = await world(base);
      await seed(w.deps);
      await w.db.query(`delete from public.qa_accounts where qa_key = 'free'`);
      const steps = await seed(w.deps);
      expect(steps).toContainEqual(
        expect.objectContaining({ key: 'free', step: 'stopped', outcome: 'refused' }),
      );
    },
    PGLITE_TIMEOUT,
  );

  withMarker(
    `refuses when ops:internal leaves accounts.internal false`,
    async () => {
      const w = await world(base);
      w.deps.markInternal = async () => {};
      const steps = await seed(w.deps);
      expect(
        steps
          .filter((s) => s.step === 'stopped')
          .map((s) => s.key)
          .sort(),
      ).toEqual(['agency', 'agency-dev', 'agencytrial', 'demo', 'free', 'pro', 'protrial']);
    },
    PGLITE_TIMEOUT,
  );

  withMarker(
    `the ledger's refusal of the trial is reported as refused, with its outcome named`,
    async () => {
      // F3: until CC-37 skips the plus-stripping for internal accounts, qa+protrial's address hashes as
      // the bare inbox does, so a trial the inbox's owner took refuses it.
      const w = await world(base);
      const hash = hashLedgerValue(
        SAMPLE_PEPPER,
        'email',
        normalizeEmail('qa+protrial@example.test'),
      );
      await w.db.query(
        `insert into public.trial_ledger (kind, value_hash, trial_kind) values ('email', $1, 'pro')`,
        [hash],
      );
      const steps = await seed(w.deps);
      const trial = steps.find((s) => s.key === 'protrial' && s.step === 'pro trial');
      expect(trial?.outcome).toBe('refused');
      expect(trial?.detail).toMatch(/^denied: /);
      expect(exitCode(steps)).toBe(1);
    },
    PGLITE_TIMEOUT,
  );

  withMarker(
    `a first audit whose send fails is reported with its site, and the run goes on`,
    async () => {
      const w = await world(base);
      w.sendFails.message = 'INNGEST_EVENT_KEY unset';
      const steps = await seed(w.deps);
      const site = steps.find((s) => s.key === 'free' && s.step === 'site');
      expect(site?.outcome).toBe('done');
      expect(site?.detail).toMatch(
        /nahltech\.com; its first audit was not sent \(INNGEST_EVENT_KEY unset\)/,
      );
      expect(exitCode(steps)).toBe(0);
      const queued = await w.db.query<{ host: string; status: string }>(
        `select s.host, c.status from public.sites s join public.checks c on c.site_id = s.id
           join public.qa_accounts q on q.account_id = s.account_id where q.qa_key = 'free'`,
      );
      expect(queued.rows).toEqual([{ host: 'nahltech.com', status: 'queued' }]);
    },
    PGLITE_TIMEOUT,
  );

  withMarker(
    `prints the addresses it will create, and creates none unless the phrase is typed`,
    async () => {
      for (const typed of [
        '',
        'yes',
        createPhrase(7, 'example.test') + ' ',
        createPhrase(6, 'example.test'),
      ]) {
        const w = await world(base);
        w.answer.typed = typed;
        const steps = await seed(w.deps);
        expect(steps).toEqual([
          expect.objectContaining({ key: 'run', step: 'stopped', outcome: 'refused' }),
        ]);
        expect(exitCode(steps)).toBe(1);
        expect(w.users.size).toBe(0);
        expect(w.asked).toEqual([
          `Type "${createPhrase(QA_ACCOUNTS.length, 'example.test')}" to go on: `,
        ]);
        const askedAt = w.lines.indexOf('<asked>');
        for (const a of QA_ACCOUNTS) {
          const at = w.lines.findIndex((l) => l.trim() === `qa+${a.key}@example.test`);
          expect(at).toBeGreaterThanOrEqual(0);
          expect(at).toBeLessThan(askedAt);
        }
      }
    },
    PGLITE_TIMEOUT,
  );

  withMarker(
    `asks for the users it is missing only, and asks nothing once every user exists`,
    async () => {
      const w = await world(base);
      await seed(w.deps);
      expect(w.asked).toHaveLength(1);
      w.users.delete('qa+demo@example.test');
      w.lines.length = 0;
      w.answer.typed = '';
      expect(exitCode(await seed(w.deps))).toBe(1);
      expect(w.asked.at(-1)).toBe(`Type "${createPhrase(1, 'example.test')}" to go on: `);
      expect(w.lines.filter((l) => l.startsWith('  qa+'))).toEqual(['  qa+demo@example.test']);

      const v = await world(base);
      await seed(v.deps);
      await seed(v.deps);
      expect(v.asked).toHaveLength(1);
    },
    PGLITE_TIMEOUT,
  );

  withMarker(
    `an agency account's first site gets its first audit and schedule, as add_site gives one`,
    async () => {
      const w = await world(base);
      await seed(w.deps);
      const r = await w.db.query<{
        qa_key: string;
        host: string;
        cadence: string | null;
        checks: string;
      }>(
        `select q.qa_key, s.host, s.schedule_cadence cadence,
                (select string_agg(c.trigger || ':' || c.status, ',') from public.checks c
                  where c.site_id = s.id) checks
           from public.qa_accounts q join public.accounts a on a.id = q.account_id
           join public.sites s on s.account_id = a.id
          where a.kind = 'agency' order by q.qa_key`,
      );
      expect(r.rows).toEqual([
        {
          qa_key: 'agency',
          host: 'client-1.lab.nahltech.com',
          cadence: 'monthly',
          checks: 'first_audit:queued',
        },
        {
          qa_key: 'agencytrial',
          host: 'trial-client-1.lab.nahltech.com',
          cadence: 'monthly',
          checks: 'first_audit:queued',
        },
        {
          qa_key: 'demo',
          host: 'demo-1.lab.nahltech.com',
          cadence: 'monthly',
          checks: 'first_audit:queued',
        },
      ]);
    },
    PGLITE_TIMEOUT,
  );

  withMarker(
    `a site add over the host's hourly bucket is refused with that reason and the time it fits`,
    async () => {
      const w = await world(base);
      const windowStart = rateLimitWindowStart(Date.now(), 60 * 60 * 1000).toISOString();
      for (let i = 0; i < 5; i++) {
        await w.db.query(`select public.increment_rate_limit($1, $2::timestamptz)`, [
          'domain:nahltech.com',
          windowStart,
        ]);
      }
      const steps = await seed(w.deps);
      const site = steps.find((s) => s.key === 'free' && s.step === 'site');
      expect(site?.outcome).toBe('refused');
      expect(site?.detail).toBe(
        `nahltech.com: the host's hourly first-audit bound is reached; run again after ${new Date(
          Date.parse(windowStart) + 60 * 60 * 1000,
        ).toISOString()}`,
      );
    },
    PGLITE_TIMEOUT,
  );

  withMarker(
    `refuses an account it marked earlier whose internal flag was turned off, and leaves it off`,
    async () => {
      const w = await world(base);
      await seed(w.deps);
      const free = (
        await w.db.query<{ id: string }>(
          `select account_id id from public.qa_accounts where qa_key = 'free'`,
        )
      ).rows[0]!.id;
      await w.db.query('update public.accounts set internal = false where id = $1', [free]);
      const called: string[] = [];
      const real = w.deps.markInternal;
      w.deps.markInternal = async (id) => {
        called.push(id);
        await real(id);
      };
      const steps = await seed(w.deps);
      expect(steps).toContainEqual(
        expect.objectContaining({ key: 'free', step: 'stopped', outcome: 'refused' }),
      );
      expect(called).toEqual([]);
      const r = await w.db.query('select internal from public.accounts where id = $1', [free]);
      expect(r.rows).toEqual([{ internal: false }]);
    },
    PGLITE_TIMEOUT,
  );

  withMarker(
    `a run stopped between the agency account and its marker is finished by the next run`,
    async () => {
      const w = await world(base);
      await seed(w.deps);
      // As a crash right after start_agency_trial_account leaves it: no marker, internal false.
      const gone = await w.db.query<{ account_id: string }>(
        `delete from public.qa_accounts q using public.accounts a
          where a.id = q.account_id and q.qa_key = 'agencytrial' and a.kind = 'agency'
          returning q.account_id`,
      );
      const id = gone.rows[0]!.account_id;
      await w.db.query('update public.accounts set internal = false where id = $1', [id]);
      const steps = await seed(w.deps);
      expect(exitCode(steps)).toBe(0);
      expect(
        steps.filter((s) => s.key === 'agencytrial' && s.outcome === 'done').map((s) => s.step),
      ).toEqual(['marker', 'internal']);
      const r = await w.db.query(
        `select a.internal, q.qa_key from public.accounts a join public.qa_accounts q
           on q.account_id = a.id where a.id = $1`,
        [id],
      );
      expect(r.rows).toEqual([{ internal: true, qa_key: 'agencytrial' }]);
    },
    PGLITE_TIMEOUT,
  );
});
