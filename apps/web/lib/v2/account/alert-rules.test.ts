/**
 * The account's alert rules and its Slack destination (CC-27b D7, `PUT /api/alert-rules`'s write):
 * what the body may say, the paid gate on Slack, and the service-role writes on PGlite with every
 * migration applied, through the PostgREST stand-in.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { GATES } from '../../entitlement-v2';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../../../__tests__/helpers/postgrest-pglite';
import { personalAccount, signUp } from '../../../__tests__/helpers/v2-check-tables';
import {
  applyAlertRules,
  decideAlertRules,
  SLACK_URL_MAX,
  supabaseAlertRulePorts,
  type AlertRulePorts,
} from './alert-rules';

const URL_A = 'https://hooks.slack.com/services/T0000/B0000/abcdWXYZ';

let db: PGlite;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 300_000);

const json = (fields: Record<string, unknown>) => ({ kind: 'json' as const, fields });
const form = (fields: Record<string, string>) => ({ kind: 'form' as const, fields });

async function paidAccount(tag: string) {
  const userId = await signUp(db, `${tag}-${randomUUID().slice(0, 8)}@example.com`);
  const { accountId } = await personalAccount(db, userId);
  await db.query(
    `update public.accounts
        set state = 'pro_trial', tier = 'pro', trial_variant = 'no_card',
            trial_ends_at = now() + interval '7 days', trial_used_at = now(),
            state_history = state_history || jsonb_build_array(
              jsonb_build_object('state', 'pro_trial', 'since', now()))
      where id = $1`,
    [accountId],
  );
  const { rows } = await db.query<{ id: string }>(
    `insert into public.alert_rules (account_id, site_id, kind, enabled) values ($1, null, 'crawler_blocked', true)
     returning id`,
    [accountId],
  );
  return { accountId, ruleId: rows[0]!.id };
}

const enabledOf = async (ruleId: string) =>
  (
    await db.query<{ enabled: boolean }>(`select enabled from public.alert_rules where id = $1`, [
      ruleId,
    ])
  ).rows[0]!.enabled;

describe('the body', () => {
  it('reads a switch’s form: the rule and the state it moves to', () => {
    const rule = randomUUID();
    expect(decideAlertRules(form({ rule, enabled: 'false' }), GATES.free)).toEqual({
      ok: true,
      plan: { rule: { id: rule, enabled: false }, slack: null },
    });
  });

  it('reads JSON with a Slack URL, and with a clear', () => {
    expect(decideAlertRules(json({ slackWebhookUrl: URL_A }), GATES.pro)).toEqual({
      ok: true,
      plan: { rule: null, slack: { set: URL_A } },
    });
    expect(decideAlertRules(json({ clearSlack: true }), GATES.free)).toEqual({
      ok: true,
      plan: { rule: null, slack: 'clear' },
    });
  });

  it.each([
    ['nothing', json({})],
    ['a rule with no state', json({ rule: randomUUID() })],
    ['a state with no rule', json({ enabled: true })],
    ['a rule id that is not one', json({ rule: 'r1', enabled: true })],
    ['an extra field', json({ clearSlack: true, accountId: randomUUID() })],
    ['a site id', form({ rule: randomUUID(), enabled: 'true', site_id: randomUUID() })],
    ['a URL and a clear together', json({ slackWebhookUrl: URL_A, clearSlack: true })],
    ['clearSlack false', json({ clearSlack: false })],
    ['http', json({ slackWebhookUrl: URL_A.replace('https', 'http') })],
    ['another host', json({ slackWebhookUrl: 'https://hooks.slack.com.example/services/T/B/x' })],
    ['a query', json({ slackWebhookUrl: `${URL_A}?x=1` })],
    [
      `over ${SLACK_URL_MAX} characters`,
      json({ slackWebhookUrl: `https://hooks.slack.com/services/${'a'.repeat(SLACK_URL_MAX)}` }),
    ],
  ])('refuses %s with 400', (_name, body) => {
    expect(decideAlertRules(body, GATES.pro)).toMatchObject({ ok: false, status: 400 });
  });

  it('refuses a Slack URL on Free with 402 and the gate, and lets Free clear one', () => {
    expect(GATES.free.slack).toBe(false);
    expect(decideAlertRules(json({ slackWebhookUrl: URL_A }), GATES.free)).toEqual({
      ok: false,
      status: 402,
      code: 'upgrade_required',
      gate: 'slack',
    });
    expect(decideAlertRules(form({ clearSlack: 'true' }), GATES.free)).toMatchObject({ ok: true });
  });
});

describe('the writes', () => {
  const ports = (): AlertRulePorts => supabaseAlertRulePorts(postgrestOver(db));

  it('switches the account’s own rule and answers the Slack state without the URL', async () => {
    const a = await paidAccount('own');
    const out = await applyAlertRules(ports(), a.accountId, {
      rule: { id: a.ruleId, enabled: false },
      slack: { set: URL_A },
    });
    expect(out).toEqual({ ok: true, slack: { set: true, last4: 'WXYZ' } });
    expect(JSON.stringify(out)).not.toContain('hooks.slack.com');
    expect(await enabledOf(a.ruleId)).toBe(false);
    const secret = await db.query<{ secret: string }>(
      `select secret from vault.secrets where name = $1`,
      [`slack_webhook:${a.accountId}`],
    );
    expect(secret.rows.map((r) => r.secret)).toEqual([URL_A]);
  });

  it('answers 404 for another account’s rule and writes neither it nor the Slack URL', async () => {
    const a = await paidAccount('caller');
    const b = await paidAccount('other');
    const out = await applyAlertRules(ports(), a.accountId, {
      rule: { id: b.ruleId, enabled: false },
      slack: { set: URL_A },
    });
    expect(out).toEqual({ ok: false, status: 404, code: 'not_found' });
    expect(await enabledOf(b.ruleId)).toBe(true);
    const secrets = await db.query<{ n: number }>(
      `select count(*)::int n from vault.secrets where name = $1`,
      [`slack_webhook:${a.accountId}`],
    );
    expect(secrets.rows[0]!.n).toBe(0);
  });

  it('answers 404 for a site rule of the caller’s own account', async () => {
    const a = await paidAccount('site-rule');
    const site = await db.query<{ id: string }>(
      `insert into public.sites (account_id, host) values ($1, $2) returning id`,
      [a.accountId, `site-rule-${randomUUID().slice(0, 6)}.example`],
    );
    const rule = await db.query<{ id: string }>(
      `insert into public.alert_rules (account_id, site_id, kind, enabled) values ($1, $2, 'any_change', true)
       returning id`,
      [a.accountId, site.rows[0]!.id],
    );
    const out = await applyAlertRules(ports(), a.accountId, {
      rule: { id: rule.rows[0]!.id, enabled: false },
      slack: null,
    });
    expect(out).toEqual({ ok: false, status: 404, code: 'not_found' });
    expect(await enabledOf(rule.rows[0]!.id)).toBe(true);
  });

  it('a clear removes the URL and answers that none is set', async () => {
    const a = await paidAccount('clear');
    await applyAlertRules(ports(), a.accountId, { rule: null, slack: { set: URL_A } });
    const out = await applyAlertRules(ports(), a.accountId, { rule: null, slack: 'clear' });
    expect(out).toEqual({ ok: true, slack: { set: false, last4: null } });
  });
});
