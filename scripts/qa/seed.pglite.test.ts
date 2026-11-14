import { describe, expect } from 'vitest';
import { QA_ACCOUNTS } from './accounts';
import { exitCode, seed } from './seed';
import { hashLedgerValue } from '../../apps/web/lib/auth/ledger';
import { normalizeEmail } from '../../apps/web/lib/auth/normalize-email';
import { dump, SAMPLE_PEPPER, withMarker, world } from './test-support';

/**
 * CC-38 D1(a) on PGlite with every migration: the set through the real sign-up trigger, CC-29's
 * agency account, `add_site`, the seat invitation and the account door's trial decision.
 *   pnpm --filter @crawlmouse/scripts exec vitest run qa/seed.pglite.test.ts
 */

describe('qa:seed part (a)', () => {
  withMarker(`makes the set: a user and an internal, marked account for each key`, async () => {
    const w = await world();
    const steps = await seed(w.deps);
    expect(exitCode(steps)).toBe(0);
    const marked = await w.db.query<{ qa_key: string; internal: boolean; kind: string }>(
      `select q.qa_key, a.internal, a.kind from public.qa_accounts q
         join public.accounts a on a.id = q.account_id order by q.qa_key`,
    );
    // Every key but the developer's (a seat, not an account of their own) has its personal account;
    // an agency key has its agency account as well.
    const expected = QA_ACCOUNTS.flatMap((a) =>
      a.home.kind === 'seat' ? [] : a.home.kind === 'agency' ? [a.key, a.key] : [a.key],
    ).sort();
    expect(marked.rows.map((r) => r.qa_key)).toEqual(expected);
    expect(marked.rows.every((r) => r.internal)).toBe(true);
    expect(
      marked.rows
        .filter((r) => r.kind === 'agency')
        .map((r) => r.qa_key)
        .sort(),
    ).toEqual(['agency', 'agencytrial', 'demo']);
  });

  withMarker(`a second run changes no row and says every step is unchanged`, async () => {
    const w = await world();
    await seed(w.deps);
    const before = await dump(w.db);
    const sentBefore = w.sent.length;
    const again = await seed(w.deps);
    expect(await dump(w.db)).toBe(before);
    expect(w.sent.length).toBe(sentBefore);
    expect(again.filter((s) => s.outcome === 'done')).toEqual([]);
  });

  withMarker(`starts qa+protrial's no-card Pro trial through the door's decision`, async () => {
    const w = await world();
    await seed(w.deps);
    const r = await w.db.query<{ state: string; trial_variant: string }>(
      `select a.state, a.trial_variant from public.accounts a
         join public.qa_accounts q on q.account_id = a.id where q.qa_key = 'protrial'`,
    );
    expect(r.rows).toEqual([{ state: 'pro_trial', trial_variant: 'no_card' }]);
    // The trial's effects went to the dispatcher, as the dashboard's offer sends them.
    expect(w.dispatched.length).toBeGreaterThan(0);
  });

  withMarker(
    `a step the plan does not allow yet waits for it, and nothing else is refused`,
    async () => {
      const w = await world();
      const steps = await seed(w.deps);
      const waiting = steps.filter((s) => s.outcome === 'waits_for_plan').map((s) => s.key);
      // Free accounts hold one site: qa+pro's four others, qa+agency's five other clients, the
      // developer's seat, demo's two others.
      expect(new Set(waiting)).toEqual(new Set(['pro', 'agency', 'agency-dev', 'demo']));
      expect(steps.filter((s) => s.outcome === 'refused')).toEqual([]);
    },
  );

  withMarker(
    `refuses a QA address someone else signed up with, and touches its account not at all`,
    async () => {
      const w = await world();
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
  );

  withMarker(`refuses an account whose user it made but whose marker is missing`, async () => {
    const w = await world();
    await seed(w.deps);
    await w.db.query(`delete from public.qa_accounts where qa_key = 'free'`);
    const steps = await seed(w.deps);
    expect(steps).toContainEqual(
      expect.objectContaining({ key: 'free', step: 'stopped', outcome: 'refused' }),
    );
  });

  withMarker(`refuses when ops:internal leaves accounts.internal false`, async () => {
    const w = await world();
    w.deps.markInternal = async () => {};
    const steps = await seed(w.deps);
    expect(
      steps
        .filter((s) => s.step === 'stopped')
        .map((s) => s.key)
        .sort(),
    ).toEqual(['agency', 'agency-dev', 'agencytrial', 'demo', 'free', 'pro', 'protrial']);
  });

  withMarker(
    `the ledger's refusal of the trial is reported as refused, with its outcome named`,
    async () => {
      // F3: until CC-37 skips the plus-stripping for internal accounts, qa+protrial's address hashes as
      // the bare inbox does, so a trial the inbox's owner took refuses it.
      const w = await world();
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
  );

  withMarker(
    `a first audit whose send fails is reported with its site, and the run goes on`,
    async () => {
      const w = await world();
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
  );
});
